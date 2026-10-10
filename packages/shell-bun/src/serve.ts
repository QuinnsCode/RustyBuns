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
import { readFileSync, statSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

/** fs.statSync works inside /$bunfs (embedded assets); Bun.file().stat() does not always. */
function kind(p: string): "file" | "dir" | null {
  try { const st = statSync(p); return st.isDirectory() ? "dir" : st.isFile() ? "file" : null; } catch { return null; }
}
import { installCloudflareGlobals, type LocalWebSocket } from "./bindings/durable-object.ts";

/** Files at the asset root that Cloudflare's asset server reads as config (or skips at upload) and never serves. */
const CONFIG_FILES = new Set(["/_headers", "/_redirects", "/.assetsignore"]);

interface HeaderRule { match: RegExp; set: [string, string][]; unset: string[] }

/**
 * Parses a Cloudflare `_headers` file: an unindented URL pattern, then indented
 * `Name: value` lines (or `! Name` to drop one). `*` is a splat and `:name` a
 * placeholder; patterns with a host are skipped, since the shell has one host.
 */
function parseHeaders(text: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let cur: HeaderRule | null = null;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      cur = null;
      if (!t.startsWith("/")) continue;
      const re = t.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:[A-Za-z]\w*/g, "[^/]+");
      cur = { match: new RegExp(`^${re}$`), set: [], unset: [] };
      rules.push(cur);
    } else if (cur) {
      if (t.startsWith("!")) { cur.unset.push(t.slice(1).trim()); continue; }
      const i = t.indexOf(":");
      if (i > 0) cur.set.push([t.slice(0, i).trim(), t.slice(i + 1).trim()]);
    }
  }
  return rules;
}

/** Every matching rule applies; a header set by several rules joins with ", " as Cloudflare does. */
function applyHeaders(rules: HeaderRule[], pathname: string, res: Response): Response {
  const hit = rules.filter((r) => r.match.test(pathname));
  if (!hit.length) return res;
  const h = new Headers(res.headers);
  const seen = new Set<string>();
  for (const r of hit) for (const [k, v] of r.set) {
    const key = k.toLowerCase();
    if (seen.has(key)) h.append(k, v); else { h.set(k, v); seen.add(key); }
  }
  for (const r of hit) for (const k of r.unset) h.delete(k);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

interface RedirectRule { match: RegExp; names: string[]; to: string; status: number }
const REDIRECT_STATUS = new Set([200, 301, 302, 303, 307, 308]);

/**
 * Parses a Cloudflare `_redirects` file: `source destination [status]` per
 * line, status 302 by default. One `*` splat in the source fills `:splat` in
 * the destination, and `:name` placeholders match a path segment. Sources with
 * a host, and lines with an unknown status, are skipped.
 */
function parseRedirects(text: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [from, to, code] = t.split(/\s+/);
    if (!from?.startsWith("/") || !to) continue;
    const status = code ? Number(code) : 302;
    if (!REDIRECT_STATUS.has(status)) continue;
    const names: string[] = [];
    const re = from.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([A-Za-z]\w*)|\*/g, (m, name) => { names.push(name ?? "splat"); return name ? "([^/]+)" : "(.*)"; });
    rules.push({ match: new RegExp(`^${re}$`), names, to, status });
  }
  return rules;
}

/** The first rule that matches wins; its destination gets the placeholders filled in. */
function findRedirect(rules: RedirectRule[], pathname: string): { to: string; status: number } | null {
  for (const r of rules) {
    const m = r.match.exec(pathname);
    if (!m) continue;
    const vals = new Map(r.names.map((n, i) => [n, m[i + 1]!]));
    return { to: r.to.replace(/:([A-Za-z]\w*)/g, (s, n) => vals.get(n) ?? s), status: r.status };
  }
  return null;
}

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
  /** The asset layer as a Fetcher, for env.ASSETS: the same files the shell serves before fetch(). */
  assets: { fetch(req: Request | URL | string): Promise<Response> };
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

  let headerRules: HeaderRule[] = [];
  let redirectRules: RedirectRule[] = [];
  if (opts.assets) {
    try { headerRules = parseHeaders(readFileSync(join(opts.assets, "_headers"), "utf8")); } catch {}
    try { redirectRules = parseRedirects(readFileSync(join(opts.assets, "_redirects"), "utf8")); } catch {}
  }

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
    if (CONFIG_FILES.has(url.pathname)) return null;
    // Like Cloudflare, a matching redirect wins even when a file sits at the path.
    let path = url.pathname;
    const r = findRedirect(redirectRules, path);
    if (r) {
      const to = r.to.includes("?") || !url.search ? r.to : r.to.replace(/(?=#|$)/, url.search);
      // 200 is a rewrite: serve the destination's file under the requested URL.
      if (r.status !== 200) return new Response(null, { status: r.status, headers: { Location: to } });
      if (!to.startsWith("/")) return null;
      path = new URL(to, url).pathname;
    }
    const root = normalize(opts.assets);
    let p = normalize(join(root, decodeURIComponent(path)));
    if (!inside(root, p)) return null;
    let k = kind(p);
    if (k === "dir") { p = join(p, "index.html"); k = kind(p); }
    if (k !== "file") return null;
    return applyHeaders(headerRules, url.pathname, new Response(Bun.file(p)));
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
    assets: { fetch: async (req) => (await asset(new URL(req instanceof Request ? req.url : req))) ?? new Response("not found", { status: 404 }) },
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
