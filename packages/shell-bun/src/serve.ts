// The Bun shell. One Bun.serve() that:
//   1. gates every request on the per-launch token (cookie or ?token=)
//   2. serves the embedded client build (assets first, like CF's asset layer)
//   3. mounts a Workers-shaped fetch(request, env, ctx) for everything else
//   4. routes WebSocket upgrades on registered paths to the app's handlers
// The app never learns it is not on Cloudflare.

import type { Server, ServerWebSocket } from "bun";
import type { CommsPort, ExecutionContext, FetchHandler, Reporter, Socket, SocketHandlers } from "@rustybuns/ports";
import { join, normalize } from "node:path";
import { statSync } from "node:fs";

/** fs.statSync works inside /$bunfs (embedded assets); Bun.file().stat() does not always. */
function kind(p: string): "file" | "dir" | null {
  try { const st = statSync(p); return st.isDirectory() ? "dir" : st.isFile() ? "file" : null; } catch { return null; }
}
import { installCloudflareGlobals, type LocalWebSocket } from "./bindings/durable-object.ts";

export interface ServeOptions<Env> {
  /** Directory of built client assets (Vite dist). Served before fetch(). */
  assets?: string;
  /** Extra static mounts: URL prefix -> directory. e.g. { "/asset": ".asset-cache/asset" }. Checked before `assets`. */
  mounts?: Record<string, string>;
  /** Paths that must reach the Worker before asset matching (CF runWorkerFirst). */
  runWorkerFirst?: string[];
  /** Per-launch token. Undefined = no gate (headless/container mode with its own auth). */
  token?: string;
  /** Extra headers on every response. COOP/COEP are on by default for SAB. */
  headers?: Record<string, string>;
  port?: number;
  hostname?: string;
  reporter?: Reporter;
}

const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

interface WsData { path: string; attachment: unknown; wrapped: Socket; bridge?: LocalWebSocket }

export interface BunShell<Env> {
  server: Server<WsData>;
  url: string;
  comms: CommsPort;
  mount(handler: FetchHandler<Env>, env: Env): void;
  stop(): Promise<void>;
}

export function serve<Env>(opts: ServeOptions<Env> = {}): BunShell<Env> {
  installCloudflareGlobals();
  const headers = { ...ISOLATION, ...(opts.headers ?? {}) };
  const wsRoutes = new Map<string, SocketHandlers>();
  const live: Socket[] = [];
  let handler: FetchHandler<Env> | null = null;
  let env: Env | null = null;
  const rep = opts.reporter;

  const withHeaders = (res: Response) => {
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(headers)) if (!h.has(k)) h.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };

  const gate = (req: Request, url: URL): Response | null => {
    if (!opts.token) return null;
    const cookie = req.headers.get("cookie") ?? "";
    if (cookie.includes(`rb_token=${opts.token}`)) return null;
    const q = url.searchParams.get("token");
    if (q === opts.token) {
      url.searchParams.delete("token");
      return new Response(null, {
        status: 302,
        headers: { Location: url.pathname + url.search, "Set-Cookie": `rb_token=${opts.token}; Path=/; HttpOnly; SameSite=Strict` },
      });
    }
    return new Response("forbidden", { status: 403 });
  };

  const asset = async (url: URL): Promise<Response | null> => {
    for (const [route, dir] of Object.entries(opts.mounts ?? {})) {
      if (url.pathname !== route && !url.pathname.startsWith(route.replace(/\/$/, "") + "/")) continue;
      const root = normalize(dir);
      const p = normalize(join(root, decodeURIComponent(url.pathname.slice(route.replace(/\/$/, "").length))));
      if (!p.startsWith(root)) return null;
      if (kind(p) === "file") return new Response(Bun.file(p));
      return new Response("not found", { status: 404 });
    }
    if (!opts.assets) return null;
    const root = normalize(opts.assets);
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) return null;
    let k = kind(p);
    if (k === "dir") { p = join(p, "index.html"); k = kind(p); }
    if (k !== "file") return null;
    return new Response(Bun.file(p));
  };

  const wrap = (ws: ServerWebSocket<WsData>): Socket => ({
    send: (d) => { ws.send(d as any); },
    close: (code, reason) => ws.close(code, reason),
    serializeAttachment: (v) => { ws.data.attachment = v; },
    deserializeAttachment: () => ws.data.attachment,
  });

  const server = Bun.serve<WsData>({
    port: opts.port ?? 0,
    hostname: opts.hostname ?? "127.0.0.1",
    async fetch(req, srv) {
      const url = new URL(req.url);
      const denied = gate(req, url);
      if (denied) return denied;

      if (req.headers.get("upgrade")?.toLowerCase() === "websocket" && wsRoutes.has(url.pathname)) {
        const ok = srv.upgrade(req, { data: { path: url.pathname, attachment: null, wrapped: null as unknown as Socket } });
        return ok ? undefined as unknown as Response : new Response("upgrade failed", { status: 500 });
      }

      const workerFirst = (opts.runWorkerFirst ?? []).some((pat) =>
        pat.endsWith("*") ? url.pathname.startsWith(pat.slice(0, -1)) : url.pathname === pat);
      if (!workerFirst) {
        const a = await asset(url);
        if (a) return withHeaders(a);
      }
      if (handler && env) {
        const pending: Promise<unknown>[] = [];
        const ctx: ExecutionContext = { waitUntil: (p) => { pending.push(p); }, passThroughOnException() {} };
        try {
          const res = await handler.fetch(req, env, ctx);
          void Promise.allSettled(pending);
          // A DO answered an upgrade with 101 + a local client end: bridge it
          // to the real socket. This is what makes WorldDurableObject-style
          // code run in-process untouched.
          const client = (res as any).webSocket as LocalWebSocket | undefined;
          if (res.status === 101 && client) {
            const ok = srv.upgrade(req, { data: { path: url.pathname, attachment: null, wrapped: null as unknown as Socket, bridge: client } });
            return ok ? undefined as unknown as Response : new Response("upgrade failed", { status: 500 });
          }
          return withHeaders(res);
        } catch (err) {
          rep?.escaped("fetch", err, { path: url.pathname });
          return new Response("internal error", { status: 500 });
        }
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const w = wrap(ws); ws.data.wrapped = w; live.push(w);
        const b = ws.data.bridge;
        if (b) {
          b.toBrowser = (d) => { ws.send(d as any); };
          b.closeBrowser = (code, reason) => ws.close(code, reason);
          for (const d of b.queue.splice(0)) ws.send(d as any);
          if (b.readyState === 3) ws.close(1000, "closed before attach");
          return;
        }
        wsRoutes.get(ws.data.path)?.open?.(w);
      },
      message(ws, m) {
        const data = typeof m === "string" ? m : (m as Buffer).buffer.slice((m as Buffer).byteOffset, (m as Buffer).byteOffset + (m as Buffer).byteLength) as ArrayBuffer;
        if (ws.data.bridge) { ws.data.bridge.onMessage?.(data); return; }
        wsRoutes.get(ws.data.path)?.message(ws.data.wrapped, data);
      },
      close(ws, code, reason) {
        const i = live.indexOf(ws.data.wrapped); if (i >= 0) live.splice(i, 1);
        if (ws.data.bridge) { ws.data.bridge.readyState = 3; ws.data.bridge.onClose?.(code, reason); return; }
        wsRoutes.get(ws.data.path)?.close(ws.data.wrapped, code, reason);
      },
    },
  });

  const url = `http://${server.hostname}:${server.port}`;
  return {
    server, url,
    comms: {
      websocket: (path, handlers) => { wsRoutes.set(path, handlers); },
      sockets: () => [...live],
      broadcast: (d) => { for (const s of live) { try { s.send(d); } catch {} } },
    },
    mount(h, e) { handler = h; env = e; },
    async stop() { await server.stop(true); },
  };
}
