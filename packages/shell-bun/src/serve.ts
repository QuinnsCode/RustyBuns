// The Bun shell. One Bun.serve() that:
//   1. gates every request on the per-launch token (cookie, ?token=, or a
//      one-time ?rb_launch= code from launchCode(), so the token itself
//      never has to sit in a browser's argv)
//   2. serves the embedded client build (assets first, like CF's asset layer)
//   3. mounts a Workers-shaped fetch(request, env, ctx) for everything else
//   4. routes WebSocket upgrades on registered paths to the app's handlers
// The app never learns it is not on Cloudflare.
//
// Guests: with `guest` set, the listed paths (the world socket) also accept a
// join passphrase as a query param, with no redirect and no cookie, so a page
// served from another machine's own 127.0.0.1 can open a WebSocket here.
// Everything else stays token-only. The mounted handler learns which it got
// from the `x-rb-principal` request header ("host" | "guest"), which the shell
// strips from incoming requests before setting it.

import type { Server, ServerWebSocket } from "bun";
import type { CommsPort, ExecutionContext, FetchHandler, Reporter, Socket, SocketHandlers } from "@rustybuns/ports";
import { join, normalize, sep } from "node:path";
import { statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

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
  /** Remote guests: a second credential, checked only on these paths. */
  guest?: GuestOptions;
  /**
   * Routes that carry their own auth and skip the token gate: URL prefix ->
   * handler. Local Artifacts git remotes use this (git clients send a repo
   * token, not the host's cookie).
   */
  open?: Record<string, (req: Request) => Response | Promise<Response>>;
}

export interface GuestOptions {
  /** Exact paths a guest may reach, e.g. ["/ws"]. */
  paths: string[];
  /** Query param carrying the passphrase. @default "join" */
  param?: string;
  /** The passphrase; a function is re-read per request so the host can open, rotate and close at runtime. undefined = closed. */
  passphrase?: string | (() => string | undefined);
}

export type Principal = "host" | "guest";

const ISOLATION = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

interface WsData { path: string; attachment: unknown; wrapped: Socket; bridge?: LocalWebSocket }

export interface BunShell<Env> {
  /** The live listener. Replaced by rebind(). */
  readonly server: Server<WsData>;
  readonly url: string;
  readonly hostname: string;
  readonly port: number;
  comms: CommsPort;
  mount(handler: FetchHandler<Env>, env: Env): void;
  /**
   * Listen somewhere else without restarting the process: stops accepting on
   * the old address (open sockets stay up) and binds the new one. Keeping the
   * port is what lets the host's own page keep working across a rebind, since
   * 0.0.0.0 still answers on loopback.
   */
  rebind(opts: { hostname?: string; port?: number }): { hostname: string; port: number };
  /**
   * A one-time code that trades for the token cookie via `?rb_launch=`. It
   * works once, within `ttlMs`, so a copy seen in `ps` or a log is useless
   * after the browser has used it. Undefined when there is no token gate.
   */
  launchCode(ttlMs?: number): string | undefined;
  stop(): Promise<void>;
}

/** Equal-length compare that does not short-circuit on the first differing byte. */
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };
/** p is root or under it; a bare prefix test would let /srv/dist-old pass for /srv/dist. */
const inside = (root: string, p: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

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

  // Two instances on one machine both set cookies for 127.0.0.1 (cookies ignore
  // the port), so the name carries the port and they coexist.
  let port = 0;
  const cookieName = () => `rb_token_${port}`;
  const login = (url: URL, param: string) => {
    url.searchParams.delete(param);
    return new Response(null, {
      status: 302,
      headers: { Location: url.pathname + url.search, "Set-Cookie": `${cookieName()}=${opts.token}; Path=/; HttpOnly; SameSite=Strict` },
    });
  };
  // Launch codes -> expiry (ms since epoch). Each is deleted when used or found expired.
  const codes = new Map<string, number>();
  const redeem = (given: string) => {
    const now = Date.now();
    for (const [c, exp] of codes) {
      if (exp <= now) { codes.delete(c); continue; }
      if (same(given, c)) { codes.delete(c); return true; }
    }
    return false;
  };
  const gate = (req: Request, url: URL): Response | Principal => {
    if (!opts.token) return "host";
    const cookie = req.headers.get("cookie") ?? "";
    if (cookie.includes(`${cookieName()}=${opts.token}`)) {
      // SameSite counts every port on 127.0.0.1 as one site, so another local
      // page's fetch or WebSocket would carry this cookie. Browsers always send
      // Origin on those, so anything not from this server's own host is refused.
      const origin = req.headers.get("origin");
      if (origin !== null && origin !== `http://${req.headers.get("host")}`) return new Response("forbidden", { status: 403 });
      return "host";
    }
    const q = url.searchParams.get("token");
    if (q !== null && same(q, opts.token)) return login(url, "token");
    const l = url.searchParams.get("rb_launch");
    if (l !== null && redeem(l)) return login(url, "rb_launch");
    const g = opts.guest;
    if (g && g.paths.includes(url.pathname)) {
      const pass = typeof g.passphrase === "function" ? g.passphrase() : g.passphrase;
      const given = url.searchParams.get(g.param ?? "join");
      if (pass && given !== null && same(given, pass)) return "guest";
    }
    return new Response("forbidden", { status: 403 });
  };

  const asset = async (url: URL): Promise<Response | null> => {
    for (const [route, dir] of Object.entries(opts.mounts ?? {})) {
      if (url.pathname !== route && !url.pathname.startsWith(route.replace(/\/$/, "") + "/")) continue;
      const root = normalize(dir);
      const p = normalize(join(root, decodeURIComponent(url.pathname.slice(route.replace(/\/$/, "").length))));
      if (!inside(root, p)) return null;
      if (kind(p) === "file") return new Response(Bun.file(p));
      return new Response("not found", { status: 404 });
    }
    if (!opts.assets) return null;
    const root = normalize(opts.assets);
    let p = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!inside(root, p)) return null;
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

  const listen = (hostname: string, port: number) => Bun.serve<WsData>({
    port, hostname,
    async fetch(raw, srv) {
      const url = new URL(raw.url);
      for (const [prefix, route] of Object.entries(opts.open ?? {}))
        if (url.pathname.startsWith(prefix)) return withHeaders(await route(raw));
      const who = gate(raw, url);
      if (who instanceof Response) return who;
      // Vouch the principal to the handler; never trust the client's copy.
      const h = new Headers(raw.headers);
      for (const k of [...h.keys()]) if (k.startsWith("x-rb-")) h.delete(k);
      h.set("x-rb-principal", who);
      const req = new Request(raw, { headers: h });

      if (req.headers.get("upgrade")?.toLowerCase() === "websocket" && wsRoutes.has(url.pathname)) {
        const ok = srv.upgrade(raw, { data: { path: url.pathname, attachment: null, wrapped: null as unknown as Socket } });
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
            const ok = srv.upgrade(raw, { data: { path: url.pathname, attachment: null, wrapped: null as unknown as Socket, bridge: client } });
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
        if (ws.data.bridge) {
          const b = ws.data.bridge;
          // The world closed first (LocalWebSocket.close already ran its close path): do not run it twice.
          if (b.readyState === 3) return;
          b.readyState = 3; b.peer.readyState = 3;   // the DO's end must see the close too
          b.onClose?.(code, reason, code !== 1006);   // 1006: the socket dropped without a close frame
          return;
        }
        wsRoutes.get(ws.data.path)?.close(ws.data.wrapped, code, reason);
      },
    },
  });

  let server = listen(opts.hostname ?? "127.0.0.1", opts.port ?? 0);
  port = server.port!;
  return {
    get server() { return server; },
    get url() { return `http://${server.hostname}:${server.port}`; },
    get hostname() { return server.hostname!; },
    get port() { return server.port!; },
    comms: {
      websocket: (path, handlers) => { wsRoutes.set(path, handlers); },
      sockets: () => [...live],
      broadcast: (d) => { for (const s of live) { try { s.send(d); } catch {} } },
    },
    mount(h, e) { handler = h; env = e; },
    rebind(o) {
      const hostname = o.hostname ?? server.hostname!, next = o.port ?? server.port!;
      if (hostname === server.hostname && next === server.port) return { hostname, port: next };
      // stop(false) resolves only once every connection has closed, so it is
      // not awaited; the listening socket itself is released synchronously.
      void server.stop(false);
      server = listen(hostname, next);
      port = server.port!;
      return { hostname: server.hostname!, port };
    },
    launchCode(ttlMs = 60_000) {
      if (!opts.token) return undefined;
      const c = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
      codes.set(c, Date.now() + ttlMs);
      return c;
    },
    async stop() { await server.stop(true); },
  };
}
