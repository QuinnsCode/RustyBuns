// Runs a generated spa host for real: host page vs. guest on the world socket.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spaEntry } from "../src/build.ts";

const root = mkdtempSync(join(import.meta.dir, ".e2e-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function launch(extraEnv: Record<string, string> = {}, args: string[] = []) {
  mkdirSync(join(root, "packages/desktop"), { recursive: true });
  mkdirSync(join(root, "dist/ui"), { recursive: true });
  mkdirSync(join(root, ".rustybuns"), { recursive: true });
  writeFileSync(join(root, "dist/ui/index.html"), "<h1>spa</h1>");
  writeFileSync(join(root, "packages/desktop/world.ts"), `
export default class World {
  constructor(public ctx: any, public env: any) {}
  fetch(req: Request) {
    const pair = new (globalThis as any).WebSocketPair(); const client = pair[0], server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ id: req.headers.get("X-User-Id"), name: req.headers.get("X-User-Name"), principal: req.headers.get("X-RB-Principal"), slug: req.headers.get("X-World-Slug") }));
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws: any, m: any) { ws.send("echo:" + m); }
}`);
  writeFileSync(join(root, ".rustybuns/actions.ts"), `export const actions: Record<string, Record<string, Function>> = { m: { f: async () => 42 } };`);
  const entry = spaEntry({ name: "e2e", bindings: {}, targets: { desktop: { mode: "spa", clientDir: "dist/ui", dataDir: join(root, "data"), guests: { max: 2, version: "v1" } } } } as any);
  writeFileSync(join(root, ".rustybuns/desktop.ts"), entry);
  const p = Bun.spawn(["bun", ".rustybuns/desktop.ts", ...args], { cwd: root, env: { ...process.env, RB_NO_BROWSER: "1", ...extraEnv }, stdout: "pipe", stderr: "pipe" });
  let out = "";
  const reader = p.stdout.getReader();
  const deadline = Date.now() + 15000;
  while (!/open http/.test(out) && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
  const m = out.match(/open (http:\/\/[^/]+)\/\?token=(\S+)/);
  if (!m) throw new Error("host did not start:\n" + out + (await new Response(p.stderr).text()));
  return { p, url: m[1]!, token: m[2]! };
}

type Hello = { id: string; name: string; principal: string; slug: string };
function connect(url: string, headers: Record<string, string> = {}): Promise<{ hello: Hello; ws: WebSocket } | { closed: true }> {
  return new Promise((res) => {
    const ws = new WebSocket(url.replace("http", "ws"), { headers } as any);
    ws.onmessage = (m) => res({ hello: JSON.parse(String(m.data)), ws });
    ws.onerror = () => res({ closed: true }); ws.onclose = () => res({ closed: true });
  });
}

test("generated host: host identity by cookie, guests by passphrase with their own identity", async () => {
  const { p, url, token } = await launch();
  try {
    const cookie = (await fetch(`${url}/?token=${token}`, { redirect: "manual" })).headers.get("set-cookie")!;
    const info = async () => (await fetch(`${url}/__rb/info`, { headers: { cookie } })).json() as Promise<any>;
    let i = await info();
    expect(i.listen).toEqual({ hostname: "127.0.0.1", port: Number(new URL(url).port) });
    expect(i.guests).toEqual({ open: false, connected: 0, max: 2, version: "v1" });

    // the host's socket: local identity, and ?uid= cannot override it
    const h = await connect(`${url}/ws?uid=evil&name=Evil`, { cookie });
    expect("hello" in h && h.hello).toMatchObject({ id: "local", principal: "host", slug: "local" });

    // closed to guests until the host page opens it; then 0.0.0.0 keeps the port
    expect(await connect(`${url}/ws?join=pw&uid=g1&name=Guest&v=v1`)).toEqual({ closed: true });
    const opened = await (await fetch(`${url}/__rb/host`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: "pw" }) })).json() as any;
    expect(opened.listen).toEqual({ hostname: "0.0.0.0", port: Number(new URL(url).port) });
    expect(opened.guests.open).toBe(true);

    const g1 = await connect(`${url}/ws?join=pw&uid=g1&name=Guest%20One&v=v1`);
    expect("hello" in g1 && g1.hello).toEqual({ id: "g1", name: "Guest One", principal: "guest", slug: "local" });
    expect((await info()).guests.connected).toBe(1);

    // rejections happen before the upgrade, with a reason
    const status = async (q: string) => (await fetch(`${url}/ws?${q}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "x", "sec-websocket-version": "13" } })).status;
    expect(await status("join=pw&uid=g2&v=v0")).toBe(409);          // version mismatch
    expect(await status("join=pw&uid=g2")).toBe(409);               // version missing
    expect(await status("join=pw&uid=local&v=v1")).toBe(400);       // the host's id
    expect(await status("join=pw&uid=bad%20id&v=v1")).toBe(400);
    expect(await status("join=nope&uid=g2&v=v1")).toBe(403);        // wrong passphrase
    // the rest of the host stays closed to guests
    expect((await fetch(`${url}/__rb/info?join=pw`)).status).toBe(403);
    expect((await fetch(`${url}/__rb/action?join=pw`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await fetch(`${url}/?join=pw`)).status).toBe(403);
    // the host still runs actions (the request body survives the principal rewrite)
    expect(await (await fetch(`${url}/__rb/action`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ module: "m", fn: "f", args: [] }) })).json()).toBe(42);

    const g2 = await connect(`${url}/ws?join=pw&uid=g2&name=Two&v=v1`);
    expect("hello" in g2).toBe(true);
    expect(await status("join=pw&uid=g3&v=v1")).toBe(503);          // full (max 2)
    (g2 as any).ws.close();
    await Bun.sleep(50);
    expect((await info()).guests.connected).toBe(1);

    // stop hosting: closes to new guests, back to loopback; the live guest socket survives
    await fetch(`${url}/__rb/host`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) });
    expect(await connect(`${url}/ws?join=pw&uid=g3&v=v1`)).toEqual({ closed: true });
    const echo = new Promise<string>((res) => ((g1 as any).ws.onmessage = (m: any) => res(String(m.data))));
    (g1 as any).ws.send("still");
    expect(await echo).toBe("echo:still");
  } finally { p.kill(); }
});

test("generated host: --listen and --join at launch", async () => {
  const { p, url } = await launch({ RB_JOIN: "fromenv" }, ["--listen", "0.0.0.0:0"]);
  try {
    expect(new URL(url).hostname).toBe("0.0.0.0");
    const g = await connect(`http://127.0.0.1:${new URL(url).port}/ws?join=fromenv&uid=g1&v=v1`);
    expect("hello" in g && g.hello.id).toBe("g1");
  } finally { p.kill(); }
});
