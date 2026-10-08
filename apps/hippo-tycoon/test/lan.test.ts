// The real thing, end to end: the generated Rusty Buns desktop host running this
// app's own world in-process, with the host's page and two LAN guests on real
// sockets. This is where "a ticking world under the in-process Durable Object"
// and "guests" get exercised together.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spaEntry } from "../../../packages/cli/src/build.ts";
import config from "../rustybuns.config.ts";
import { CLOSE_VERSION, LAN_VERSION, PROTO_VERSION, type ServerMsg } from "../src/engine/wire.ts";

const app = join(import.meta.dir, "..");
const dir = join(app, ".rustybuns");
const dataDir = join(app, ".e2e-lan-data");
afterAll(() => { rmSync(dataDir, { recursive: true, force: true }); rmSync(join(dir, "e2e-desktop.ts"), { force: true }); });

async function launch() {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, "actions.ts"))) writeFileSync(join(dir, "actions.ts"), "export const actions: Record<string, Record<string, Function>> = {};\n");
  const cfg = structuredClone(config) as typeof config;
  cfg.targets.desktop!.dataDir = dataDir;
  writeFileSync(join(dir, "e2e-desktop.ts"), spaEntry(cfg));
  const p = Bun.spawn(["bun", ".rustybuns/e2e-desktop.ts"], { cwd: app, env: { ...process.env, RB_NO_BROWSER: "1" }, stdout: "pipe", stderr: "pipe" });
  let out = "";
  const reader = p.stdout.getReader();
  const deadline = Date.now() + 15000;
  while (!/open http/.test(out) && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
  const m = out.match(/open (http:\/\/[^/]+)\/\?token=(\S+)/);
  if (!m) throw new Error("host did not start:\n" + out + (await new Response(p.stderr).text()));
  return { p, url: m[1]!, token: m[2]! };
}

class Client {
  msgs: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  private ws: WebSocket;
  constructor(url: string, headers: Record<string, string> = {}, hello = PROTO_VERSION) {
    this.ws = new WebSocket(url.replace("http", "ws"), { headers } as never);
    this.ws.onopen = () => this.send({ t: "hello", v: hello });
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(String(e.data)));
    this.ws.onclose = (e) => { this.closed = { code: e.code, reason: e.reason }; };
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  of<T extends ServerMsg["t"]>(t: T) { return this.msgs.filter((m) => m.t === t) as Extract<ServerMsg, { t: T }>[]; }
  async until(f: () => unknown, ms = 8000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out; rooms " + JSON.stringify(this.of("room").map((r) => [r.seq, r.ph, r.seats.filter((s) => s.h).map((s) => s.n).join("+")])) + " host " + JSON.stringify(this.of("room").at(-1)?.host) + " closed " + JSON.stringify(this.closed)); await Bun.sleep(20); } }
  close() { this.ws.close(); }
}

test("LAN party: host and guests share one ticking world", async () => {
  const { p, url, token } = await launch();
  try {
    const cookie = (await fetch(`${url}/?token=${token}`, { redirect: "manual" })).headers.get("set-cookie")!;
    const post = (body: object) => fetch(`${url}/__rb/host`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()) as Promise<any>;

    // the host's own page: local identity, seat 0
    const host = new Client(`${url}/ws`, { cookie });
    await host.until(() => host.of("hello").length);
    expect(host.of("hello")[0]).toMatchObject({ you: 0 });

    // closed until the host opens it, then guests are let in on the app's wire version
    const early = new Client(`${url}/ws?join=pw&uid=g0&name=Early&v=${LAN_VERSION}`);
    await early.until(() => early.closed);                  // refused: the world is closed to guests
    expect(early.of("hello").length).toBe(0);
    const info = await post({ listen: { hostname: "0.0.0.0" }, join: "pw" });
    expect(info.guests.open).toBe(true);
    const status = async (q: string) => (await fetch(`${url}/ws?${q}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "x", "sec-websocket-version": "13" } })).status;
    expect(await status("join=pw&uid=g9&v=wrong")).toBe(409);

    // a guest whose game speaks another protocol is told so, and the DO's close code survives the bridge
    const old = new Client(`${url}/ws?join=pw&uid=g8&name=Old&v=${LAN_VERSION}`, {}, PROTO_VERSION + 1);
    await old.until(() => old.closed);
    expect(old.closed!.code).toBe(CLOSE_VERSION);
    expect(old.of("err")[0]!.msg).toMatch(/protocol/);

    const g1 = new Client(`${url}/ws?join=pw&uid=g1&name=Guest%20One&v=${LAN_VERSION}`);
    const g2 = new Client(`${url}/ws?join=pw&uid=g2&name=Guest%20Two&v=${LAN_VERSION}`);
    await g1.until(() => g1.of("hello").length); await g2.until(() => g2.of("hello").length);
    expect(new Set([g1.of("hello")[0]!.you, g2.of("hello")[0]!.you, 0]).size).toBe(3);   // three humans, three seats
    await host.until(() => host.of("room").at(-1)?.seats.filter((s) => s.h).length === 3);
    expect(host.of("room").at(-1)!.seats.map((s) => s.n)).toContain("Guest One");

    // the host (first human) starts a short round; every client sees it tick
    host.send({ t: "cfg", secs: 30 });
    host.send({ t: "start" });
    await g1.until(() => g1.of("room").at(-1)?.ph === "playing", 10000);
    const t0 = g1.of("snap").length;
    g1.send({ t: "in", m: 100, g: 1, h: 0 });
    await Bun.sleep(1000);
    const perSec = g1.of("snap").length - t0;
    expect(perSec).toBeGreaterThanOrEqual(10);       // ~15 Hz over a real in-process socket
    expect(perSec).toBeLessThanOrEqual(20);
    const ticks = g1.of("snap").map((s) => s.tick);
    // the sim tick never runs backwards within a round (it holds still through the countdown)
    expect(ticks.every((t, i) => i === 0 || t >= ticks[i - 1]! || g1.of("snap")[i]!.round !== g1.of("snap")[i - 1]!.round)).toBe(true);
    const last = g1.of("snap").at(-1)!;
    expect(last.hp[1]![0]).toBeGreaterThan(0);        // guest one slid right: input crossed the LAN
    expect(last.dr.length).toBeGreaterThan(0);        // and the drops are dripping

    // a guest leaves: the seat goes back to a bot, the others are told
    g2.close();
    await host.until(() => host.of("room").at(-1)?.seats.filter((s) => s.h).length === 2);
    expect((await (await fetch(`${url}/__rb/info`, { headers: { cookie } })).json() as any).guests.connected).toBe(1);

    // stop hosting closes the door to new guests; the connected one keeps playing
    await post({ join: null, listen: { hostname: "127.0.0.1" } });
    const n = g1.of("snap").length;
    await Bun.sleep(400);
    expect(g1.of("snap").length).toBeGreaterThan(n);
    host.close(); g1.close();
  } finally { p.kill(); }
}, 40000);
