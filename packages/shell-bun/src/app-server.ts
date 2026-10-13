// desktop.server: the app's own Node server (a node:http `server.js` in ../api) as a child of the
// host, with the paths the app's Vite dev server proxied to it ("/api") proxied to it here too.
// The build bundles it with Bun into one file; the child is this same executable run as Bun
// (BUN_BE_BUN), so a compiled binary needs no Node or Bun on the machine.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { WebSocketPair } from "./bindings/durable-object.ts";

export interface AppServerOptions {
  /** The server's bundle. Inside a compiled binary it is copied out to the data dir first. */
  file: string;
  /** What the logs call it ("../api/server.js"). @default the file's name */
  name?: string;
  /** Paths it answers, as vite's server.proxy keys: a prefix ("/api"), or "^..." for a regex. */
  paths: string[];
  /** Its DATA_DIR, and where it runs. */
  dataDir: string;
  /** The port it listens on. Unset, the host picks a free one and passes it as PORT. */
  port?: number;
  /** More env for it, over the host's own. */
  env?: Record<string, string>;
  /** How long a request waits for it to start listening, in ms. @default 15000 */
  startMs?: number;
}

export interface AppServer {
  port: number;
  /** Whether `pathname` is one of its paths. */
  owns(pathname: string): boolean;
  /**
   * `req` sent on to it, or null when the path isn't its. A 502 while it's down. A WebSocket
   * upgrade comes back as a 101 carrying the browser's end of a bridge to the server's socket,
   * which the shell attaches as it does a Durable Object's.
   */
  fetch(req: Request): Promise<Response | null>;
  stop(): void;
}

/** A vite proxy key matched the way vite matches it: "^" starts a regex, anything else a prefix. */
export function proxyMatcher(paths: string[]): (pathname: string) => boolean {
  const tests = paths.map((p) => p.startsWith("^") ? ((s: string) => new RegExp(p).test(s)) : ((s: string) => s.startsWith(p)));
  return (pathname) => tests.some((t) => t(pathname));
}

async function freePort(): Promise<number> {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
}

// Hop-by-hop headers stay on this hop; Host becomes the server's, as vite's changeOrigin does.
// The response goes back as the server sent it (decompress: false keeps its Content-Encoding true).
const DROP = ["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection"];
// The upgrade's own handshake headers: the client WebSocket below makes its own.
const WS_DROP = [...DROP, "sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol", "content-length"];

// Run before the server, in the child: a host that's SIGKILLed can't stop it, so it stops itself
// once it's been orphaned (its parent pid changes). Not an import, so the server stays the main module.
const WATCHDOG = `const ppid = process.ppid;
setInterval(() => { if (process.ppid !== ppid) process.exit(0); }, 1000).unref();
`;

/** A code a close frame may carry: 1005 and 1006 are only ever reported, never sent. */
const sendable = (code: number) => code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000;

export async function appServer(o: AppServerOptions): Promise<AppServer> {
  let file = o.file;
  const name = o.name ?? basename(o.file);
  const dir = join(o.dataDir, ".rb-server");
  mkdirSync(dir, { recursive: true });
  // A compiled binary's files live in its own $bunfs, which the child (a fresh process) can't read.
  // Its native addons (.node files) go with it: the build lists them beside it, in
  // server-<i>.addons.json, and the bundle requires them from its own dir (sharp's from a tree in it,
  // server-<i>-native/@img/..., whose paths keep its addon's rpath to libvips).
  if (/\$bunfs|~BUN/.test(file)) {
    let addons: string[] = [];
    try { addons = JSON.parse(readFileSync(file.replace(/\.js$/, ".addons.json"), "utf8")); } catch {}
    for (const f of [basename(file), ...addons]) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), await Bun.file(join(dirname(file), f)).bytes());
    }
    file = join(dir, basename(file));
  }
  const watchdog = join(dir, "watchdog.js");
  writeFileSync(watchdog, WATCHDOG);
  const port = o.port ?? await freePort();
  const owns = proxyMatcher(o.paths);
  let exited: number | null = null;
  const child = Bun.spawn([process.execPath, "--preload", watchdog, file], {
    cwd: o.dataDir,
    env: { ...process.env, BUN_BE_BUN: "1", PORT: String(port), DATA_DIR: o.dataDir, ...o.env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.exited.then((code) => { exited = code; console.error(`[server] ${name} exited (${code}); ${o.paths.join(", ")} now answer 502`); });
  const stop = () => { if (exited === null) child.kill(); };
  process.on("exit", stop);
  console.log(`[server] ${name} on 127.0.0.1:${port}, for ${o.paths.join(", ")}`);
  const base = `http://127.0.0.1:${port}`;
  const startBy = Date.now() + (o.startMs ?? 15_000);
  const down = () => Response.json({ error: "server_down", detail: `the app's server exited (${exited})` }, { status: 502 });

  // The server's socket, opened before the browser's upgrade is answered so a refusal is a 502,
  // and bridged frame for frame to the browser's end once the shell attaches it.
  async function socket(url: URL, from: Headers): Promise<Response> {
    const headers = new Headers(from);
    for (const h of WS_DROP) headers.delete(h);
    const protocols = from.get("sec-websocket-protocol")?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
    let up: WebSocket;
    for (;;) {
      if (exited !== null) return down();
      up = new WebSocket(`ws://127.0.0.1:${port}${url.pathname}${url.search}`, { headers: Object.fromEntries(headers), protocols } as any);
      up.binaryType = "arraybuffer";
      const opened = await new Promise<boolean>((done) => { up.onopen = () => done(true); up.onerror = () => done(false); up.onclose = () => done(false); });
      if (opened) break;
      if (Date.now() > startBy) return Response.json({ error: "server_unreachable", detail: "the app's server refused the WebSocket" }, { status: 502 });
      await Bun.sleep(100);
    }
    // The shell hands the browser's frames and close to its end's onMessage/onClose; frames sent
    // on ours go out to the browser.
    const pair = new WebSocketPair(), browser = pair[0], ours = pair[1];
    browser.onMessage = (d) => { if (up.readyState === WebSocket.OPEN) up.send(d); };
    browser.onClose = (code, reason) => { if (up.readyState < WebSocket.CLOSING) up.close(sendable(code), reason); };
    up.onmessage = (e) => { if (ours.readyState === 1) ours.send(e.data as string | ArrayBuffer); };
    up.onclose = (e) => ours.close(sendable(e.code), e.reason);
    up.onerror = null;
    // What the shell bridges: a 101 with the browser's end (Bun's own Response won't take a 101).
    const res = { status: 101, webSocket: browser, headers: new Headers(up.protocol ? { "sec-websocket-protocol": up.protocol } : {}) };
    return res as unknown as Response;
  }

  return {
    port, owns, stop,
    async fetch(req) {
      const url = new URL(req.url);
      if (!owns(url.pathname)) return null;
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") return socket(url, req.headers);
      const headers = new Headers(req.headers);
      for (const h of DROP) headers.delete(h);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      // Until it listens, a refused connection is the server still starting: wait for it.
      for (;;) {
        if (exited !== null) return down();
        try {
          return await fetch(base + url.pathname + url.search, { method: req.method, headers, body, redirect: "manual", decompress: false } as RequestInit);
        } catch (err) {
          if (Date.now() > startBy) return Response.json({ error: "server_unreachable", detail: String((err as Error).message ?? err) }, { status: 502 });
          await Bun.sleep(100);
        }
      }
    },
  };
}
