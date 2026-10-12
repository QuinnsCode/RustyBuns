// desktop.server: the app's own Node server (a node:http `server.js` in ../api) as a child of the
// host, with the paths the app's Vite dev server proxied to it ("/api") proxied to it here too.
// The build bundles it with Bun into one file; the child is this same executable run as Bun
// (BUN_BE_BUN), so a compiled binary needs no Node or Bun on the machine.

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export interface AppServerOptions {
  /** The server's bundle. Inside a compiled binary it is copied out to the data dir first. */
  file: string;
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
  /** `req` sent on to it, or null when the path isn't its. A 502 while it's down. */
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

export async function appServer(o: AppServerOptions): Promise<AppServer> {
  let file = o.file;
  // A compiled binary's files live in its own $bunfs, which the child (a fresh process) can't read.
  if (/\$bunfs|~BUN/.test(file)) {
    const dir = join(o.dataDir, ".rb-server");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, basename(file)), await Bun.file(file).bytes());
    file = join(dir, basename(file));
  }
  const port = o.port ?? await freePort();
  const owns = proxyMatcher(o.paths);
  let exited: number | null = null;
  const child = Bun.spawn([process.execPath, file], {
    cwd: o.dataDir,
    env: { ...process.env, BUN_BE_BUN: "1", PORT: String(port), DATA_DIR: o.dataDir, ...o.env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.exited.then((code) => { exited = code; console.error(`[server] ${basename(o.file)} exited (${code}); ${o.paths.join(", ")} now answer 502`); });
  const stop = () => { if (exited === null) child.kill(); };
  process.on("exit", stop);
  console.log(`[server] ${basename(o.file)} on 127.0.0.1:${port}, for ${o.paths.join(", ")}`);
  const base = `http://127.0.0.1:${port}`;
  const startBy = Date.now() + (o.startMs ?? 15_000);
  return {
    port, owns, stop,
    async fetch(req) {
      const url = new URL(req.url);
      if (!owns(url.pathname)) return null;
      const headers = new Headers(req.headers);
      for (const h of DROP) headers.delete(h);
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      // Until it listens, a refused connection is the server still starting: wait for it.
      for (;;) {
        if (exited !== null) return Response.json({ error: "server_down", detail: `the app's server exited (${exited})` }, { status: 502 });
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
