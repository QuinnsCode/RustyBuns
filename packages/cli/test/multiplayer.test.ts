// Runs a generated spa host for real: host page vs. guest on the world socket.
import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spaEntry } from "../src/build.ts";

const root = mkdtempSync(join(import.meta.dir, ".e2e-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function launch(extraEnv: Record<string, string> = {}, args: string[] = [], host: "desktop" | "box" = "desktop") {
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
  webSocketMessage(ws: any, m: any) { if (m === "bye") ws.close(4000, "bye"); else ws.send("echo:" + m); }
}`);
  writeFileSync(join(root, ".rustybuns/actions.ts"), `export const actions: Record<string, Record<string, Function>> = { m: { f: async () => 42 } };`);
  const entry = spaEntry({ name: "e2e", bindings: {}, targets: { desktop: { mode: "spa", clientDir: "dist/ui", dataDir: join(root, "data"), guests: { max: 2, version: "v1" } } } } as any, host);
  writeFileSync(join(root, ".rustybuns/desktop.ts"), entry);
  const p = Bun.spawn(["bun", ".rustybuns/desktop.ts", ...args], { cwd: root, env: { ...process.env, RB_NO_BROWSER: "1", ...extraEnv }, stdout: "pipe", stderr: "pipe" });
  let out = "";
  const reader = p.stdout.getReader();
  const deadline = Date.now() + 15000;
  const ready = host === "box" ? /serving (http:\/\/\S+)/ : /open http/;
  while (!ready.test(out) && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
  const m = host === "box" ? out.match(/serving (http:\/\/[^/\s]+)()/) : out.match(/open (http:\/\/[^/]+)\/\?token=(\S+)/);
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
    // the host page needs an address to show its friends; the browser cannot find its own LAN IP
    expect(Array.isArray(i.lan)).toBe(true);
    for (const ip of i.lan) expect(ip).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);

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

test("generated host: a guest the world closes frees exactly one slot", async () => {
  const { p, url } = await launch({ RB_JOIN: "pw" }, ["--listen", "127.0.0.1:0"]);
  try {
    const a = await connect(`${url}/ws?join=pw&uid=a&v=v1`), b = await connect(`${url}/ws?join=pw&uid=b&v=v1`);
    expect("hello" in a && "hello" in b).toBe(true);
    const closed = new Promise<{ code: number }>((res) => ((b as any).ws.onclose = (e: any) => res({ code: e.code })));
    (b as any).ws.send("bye");                        // the world closes b itself, with its own code
    expect((await closed).code).toBe(4000);           // and the code reaches the guest
    await Bun.sleep(50);
    // two more guests fit: a still holds one of the two slots. A double decrement would have let a third in.
    const c = await connect(`${url}/ws?join=pw&uid=c&v=v1`);
    expect("hello" in c).toBe(true);
    const status = async (q: string) => (await fetch(`${url}/ws?${q}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "x", "sec-websocket-version": "13" } })).status;
    expect(await status("join=pw&uid=d&v=v1")).toBe(503);   // full: a and c
  } finally { p.kill(); }
});

test("box: a room leaves when its last socket closes, and /ws is rate limited per X-Real-IP", async () => {
  const { p, url } = await launch({ PORT: "0", DATA_DIR: join(root, "boxdata") }, [], "box");
  try {
    const status = async (q: string, ip?: string) => (await fetch(`${url}/ws?${q}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "x", "sec-websocket-version": "13", ...(ip ? { "X-Real-IP": ip } : {}) } })).status;
    // no X-Real-IP (no proxy in front): no gate, so one test can fill all 200 rooms
    const open: WebSocket[] = [];
    for (let i = 0; i < 200; i++) {
      const c = await connect(`${url}/ws?room=r${i}`);
      expect("hello" in c).toBe(true);
      open.push((c as any).ws);
    }
    expect(await status("room=extra")).toBe(400);              // full
    const twin = await connect(`${url}/ws?room=r0`);           // a room in use still takes more sockets
    expect("hello" in twin).toBe(true);
    open[0]!.close(); await Bun.sleep(50);
    expect(await status("room=extra")).toBe(400);              // r0 still has its twin
    (twin as any).ws.close(); await Bun.sleep(50);
    const fresh = await connect(`${url}/ws?room=extra`);       // r0 emptied, so its slot is free
    expect("hello" in fresh).toBe(true);
    expect(await status("room=another")).toBe(400);            // and only that one slot
    for (const ws of open) ws.close();
    (fresh as any).ws.close();

    for (let i = 0; i < 30; i++) expect(await status("room=lobby", "203.0.113.7")).not.toBe(429);
    expect(await status("room=lobby", "203.0.113.7")).toBe(429);
    expect(await status("room=lobby", "203.0.113.8")).not.toBe(429);  // another address has its own minute
  } finally { p.kill(); }
}, 30000);
