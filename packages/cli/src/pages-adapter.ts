// Cloudflare Pages Functions as one module Worker. `rustybuns pages-functions` copies this file into
// the app's .rustybuns/pages/ beside the route table it generates, so it imports nothing and never
// makes Rusty Buns part of the app's bundle.
//
// The handlers run as written: each gets Pages' context ({ request, env, params, data, next,
// waitUntil }), `_middleware` files wrap everything under their folder, outermost first, and a
// request no Function answers (or whose method none exports) falls through to the static assets.
// `_routes.json` excludes go straight to the assets, as on Pages.

export type Seg = { kind: "static" | "param" | "rest"; v: string };
export type Handler = (context: any) => Response | Promise<Response>;
export type Route = { path: string; segs: Seg[]; methods: Record<string, Handler> };
export type Middleware = { prefix: string[]; fns: Handler[] };
export type Table = { routes: Route[]; middleware: Middleware[]; routesJson?: { include?: string[]; exclude?: string[] } };
type Ctx = { waitUntil(p: Promise<unknown>): void; passThroughOnException?(): void };

/** Params for `parts` against `segs`, or null. `[[rest]]` takes zero or more segments, as an array. */
export function match(segs: Seg[], parts: string[]): Record<string, string | string[]> | null {
  const params: Record<string, string | string[]> = {};
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s.kind === "rest") { params[s.v] = parts.slice(i); return params; }
    if (i >= parts.length) return null;
    if (s.kind === "static" && s.v !== parts[i]) return null;
    if (s.kind === "param") params[s.v] = parts[i]!;
  }
  return segs.length === parts.length ? params : null;
}

/** A `_routes.json` pattern: `*` is any run of characters. */
const glob = (pattern: string, path: string) =>
  new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(path);

export function pagesWorker(table: Table) {
  return {
    async fetch(request: Request, env: any, ctx: Ctx): Promise<Response> {
      const url = new URL(request.url);
      const assets = (req: Request): Promise<Response> =>
        env?.ASSETS ? env.ASSETS.fetch(req) : Promise.resolve(new Response("Not found", { status: 404 }));
      const rj = table.routesJson;
      if (rj && (!(rj.include ?? ["/*"]).some((p) => glob(p, url.pathname)) || (rj.exclude ?? []).some((p) => glob(p, url.pathname))))
        return assets(request);

      const parts = url.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
      let params: Record<string, string | string[]> = {};
      let handler: Handler | undefined;
      let functionPath = url.pathname;
      for (const r of table.routes) {
        const p = match(r.segs, parts);
        const h = p && (r.methods[request.method] ?? r.methods.ANY);
        if (h) { params = p; handler = h; functionPath = r.path; break; }
      }
      const chain: Handler[] = [
        ...table.middleware.filter((m) => m.prefix.every((s, i) => parts[i] === s)).flatMap((m) => m.fns),
        handler ?? ((c: { request: Request }) => assets(c.request)),
      ];
      const data: Record<string, unknown> = {};
      const run = (i: number, req: Request): Promise<Response> => Promise.resolve(chain[i]!({
        request: req, env, params, data, functionPath,
        waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
        passThroughOnException: () => ctx.passThroughOnException?.(),
        next: (input?: Request | string, init?: RequestInit) => run(i + 1,
          input === undefined ? req : new Request(typeof input === "string" ? new URL(input, req.url) : input, init)),
      }));
      return run(0, request);
    },
  };
}
