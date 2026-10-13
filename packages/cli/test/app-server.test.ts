// desktop.server for real: a generated spa host starts the app's own node:http server and
// proxies its paths to it, the way the app's Vite dev server did.
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spaEntry, APP_SERVER_DIR, appServerFile } from "../src/build.ts";
import { proxyMatcher } from "@rustybuns/shell-bun";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(import.meta.dir, ".e2e-server-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// openGym's shape: PORT and DATA_DIR from the env, JSON files in DATA_DIR.
const SERVER = `import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const DATA = process.env.DATA_DIR;
http.createServer((req, res) => {
  if (req.url === "/api/save" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => { fs.writeFileSync(path.join(DATA, "saved.json"), body); res.writeHead(201, { "content-type": "application/json" }); res.end(body); });
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "x-origin": process.env.ORIGIN ?? "" });
  res.end(JSON.stringify({ url: req.url, host: req.headers.host, data: DATA }));
}).listen(+process.env.PORT, "127.0.0.1");
`;

// A second server, the media one: answers /img and echoes WebSocket frames on /live, with the
// subprotocol the browser asked for. Its pid in DATA_DIR, to check it dies with the host.
const MEDIA = `import fs from "node:fs";
import path from "node:path";
fs.writeFileSync(path.join(process.env.DATA_DIR, "media.pid"), String(process.pid));
Bun.serve({ port: +process.env.PORT, hostname: "127.0.0.1",
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/live") return srv.upgrade(req, { headers: { "Sec-WebSocket-Protocol": "echo" }, data: { q: url.search } }) ? undefined : new Response("no", { status: 400 });
    return new Response("img " + url.pathname);
  },
  websocket: {
    open(ws) { ws.send("hi " + ws.data.q); },
    message(ws, m) { if (m === "bye") ws.close(4001, "asked"); else ws.send(typeof m === "string" ? "echo " + m : m); },
  },
});
`;

test("vite proxy keys: a prefix, or a regex when they start with ^", () => {
  const owns = proxyMatcher(["/api", "^/ws/.*"]);
  expect(["/api", "/api/x", "/ws/a"].map(owns)).toEqual([true, true, true]);
  expect(["/", "/apx", "/w/ws/a", "/index.html"].map(owns)).toEqual([false, false, false, false]);
});

test("generated host: desktop.server runs beside it, gets PORT and DATA_DIR, answers its paths", async () => {
  mkdirSync(join(root, "dist/ui"), { recursive: true });
  mkdirSync(join(root, ".rustybuns", APP_SERVER_DIR), { recursive: true });
  writeFileSync(join(root, "dist/ui/index.html"), "<h1>spa</h1>");
  writeFileSync(join(root, ".rustybuns/actions.ts"), `export const actions: Record<string, Record<string, Function>> = {};`);
  // What the build's "bundle server" step leaves beside the host.
  writeFileSync(join(root, ".rustybuns", APP_SERVER_DIR, appServerFile(0)), SERVER);
  writeFileSync(join(root, ".rustybuns", APP_SERVER_DIR, appServerFile(1)), MEDIA);
  const dataDir = join(root, "data");
  const entry = spaEntry({ name: "srv", bindings: {}, targets: { desktop: { mode: "spa", clientDir: "dist/ui", world: false, dataDir,
    server: [{ entry: "../api/server.js", paths: ["/api"], env: { ORIGIN: "http://localhost:8080" } }, { entry: "../media/index.js", paths: ["/img", "^/live"] }] } } } as any);
  expect(entry).toContain("appServer(");
  writeFileSync(join(root, ".rustybuns/desktop.ts"), entry);
  const p = Bun.spawn(["bun", ".rustybuns/desktop.ts"], { cwd: root, env: { ...process.env, RB_NO_BROWSER: "1" }, stdout: "pipe", stderr: "pipe" });
  try {
    let out = "";
    const reader = p.stdout.getReader();
    const deadline = Date.now() + 15000;
    while (!/open http/.test(out) && Date.now() < deadline) { const { value, done } = await reader.read(); if (done) break; out += new TextDecoder().decode(value); }
    const m = out.match(/open (http:\/\/[^/]+)\/\?token=(\S+)/);
    if (!m) throw new Error("host did not start:\n" + out + (await new Response(p.stderr).text()));
    const [, url, token] = m;
    expect(out).toMatch(/\[server\] \.\.\/api\/server\.js on 127\.0\.0\.1:\d+, for \/api/);
    expect(out).toMatch(/\[server\] \.\.\/media\/index\.js on 127\.0\.0\.1:\d+, for \/img, \^\/live/);
    const cookie = (await fetch(`${url}/?token=${token}`, { redirect: "manual" })).headers.get("set-cookie")!;

    const r = await fetch(`${url}/api/me?x=1`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-origin")).toBe("http://localhost:8080");
    const got = await r.json() as { url: string; host: string; data: string };
    expect(got.url).toBe("/api/me?x=1");
    expect(got.data).toBe(dataDir);
    expect(got.host).not.toBe(new URL(url!).host);           // Host is the server's, as changeOrigin sends it

    const saved = await fetch(`${url}/api/save`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: '{"sets":3}' });
    expect(saved.status).toBe(201);
    expect(readFileSync(join(dataDir, "saved.json"), "utf8")).toBe('{"sets":3}');

    // The token still gates it, and paths that aren't its stay the host's.
    expect((await fetch(`${url}/api/me`, { redirect: "manual" })).status).not.toBe(200);
    expect(await (await fetch(`${url}/`, { headers: { cookie } })).text()).toContain("<h1>spa</h1>");

    // The second server's paths go to it.
    expect(await (await fetch(`${url}/img/a.png`, { headers: { cookie } })).text()).toBe("img /img/a.png");

    // A WebSocket on its paths: upgraded through the host, frames both ways, its subprotocol, its close.
    const ws = new WebSocket(`${url.replace("http", "ws")}/live?room=1`, { headers: { cookie }, protocols: ["echo"] } as any);
    ws.binaryType = "arraybuffer";
    const frames: unknown[] = [];
    const closed = new Promise<{ code: number; reason: string }>((done) => { ws.onclose = (e) => done({ code: e.code, reason: e.reason }); });
    const next = () => new Promise<unknown>((done) => { ws.onmessage = (e) => done(e.data); });
    frames.push(await next());
    expect(ws.protocol).toBe("echo");
    ws.send("ping"); frames.push(await next());
    ws.send(new Uint8Array([1, 2, 3])); frames.push([...new Uint8Array(await next() as ArrayBuffer)]);
    expect(frames).toEqual(["hi ?room=1", "echo ping", [1, 2, 3]]);
    ws.send("bye");
    expect(await closed).toEqual({ code: 4001, reason: "asked" });
    // Without the cookie, no upgrade.
    const bare = new WebSocket(`${url.replace("http", "ws")}/live`);
    expect(await new Promise<string>((done) => { bare.onopen = () => done("open"); bare.onerror = () => done("refused"); })).toBe("refused");

    // A host that's SIGKILLed can't stop its servers: they notice and stop themselves.
    const pid = +readFileSync(join(dataDir, "media.pid"), "utf8");
    p.kill("SIGKILL");
    await p.exited;
    const deadline2 = Date.now() + 5000;
    while (alive(pid) && Date.now() < deadline2) await Bun.sleep(100);
    expect(alive(pid)).toBe(false);
  } finally {
    p.kill();
    await p.exited;
  }
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
