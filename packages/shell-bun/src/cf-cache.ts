// fetch(url, { cf: { cacheTtl, cacheEverything } }) on Cloudflare is answered from the edge cache.
// The worker-mode host has no edge, so without this every such call goes out: a star widget that
// fetches api.github.com with cacheTtl: 14400 on each render got rate-limited at 200 renders (#908).
// This keeps those responses in process, keyed by method and URL, for the TTL the call asked for.
//
// As on Cloudflare: only GET and HEAD; cacheTtl caches 200, 206, 301, 302, 303, 404 and 410 for that
// many seconds whatever the headers say (0 or less: not cached); cacheEverything alone uses the
// response's own s-maxage / max-age. Concurrent misses for one key share a single outbound call.

type Entry = { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer; expires: number };
type Fetch = typeof fetch;

const CACHEABLE = new Set([200, 206, 301, 302, 303, 404, 410]);
const MAX_ENTRIES = 500;
const MAX_BODY = 5 * 1024 * 1024;

function ttlFor(cf: { cacheTtl?: number; cacheEverything?: boolean }, res: Response): number {
  if (typeof cf.cacheTtl === "number") return CACHEABLE.has(res.status) ? cf.cacheTtl : 0;
  if (!cf.cacheEverything || res.status !== 200) return 0;
  const cc = res.headers.get("cache-control") ?? "";
  if (/no-store|no-cache|private/i.test(cc)) return 0;
  const m = /s-maxage=(\d+)/i.exec(cc) ?? /max-age=(\d+)/i.exec(cc);
  return m ? Number(m[1]) : 0;
}

const toResponse = (e: Entry) => new Response(e.body.byteLength ? e.body.slice(0) : null, { status: e.status, statusText: e.statusText, headers: e.headers });

/** A fetch that answers calls carrying cf.cacheTtl / cf.cacheEverything from an in-process cache. */
export function cfCachedFetch(base: Fetch, now: () => number = Date.now): Fetch {
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<Entry | Response>>();
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit & { cf?: any }) => {
    const cf = init?.cf ?? (input as any)?.cf;
    if (!cf || (cf.cacheTtl === undefined && !cf.cacheEverything)) return base(input as any, init);
    const req = input instanceof Request ? input : undefined;
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    if ((method !== "GET" && method !== "HEAD") || init?.body != null) return base(input as any, init);
    const key = `${method} ${req ? req.url : String(input)}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now()) return toResponse(hit);
    if (hit) cache.delete(key);
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const res = await base(input as any, init);
        const ttl = ttlFor(cf, res);
        const len = Number(res.headers.get("content-length") ?? 0);
        if (ttl <= 0 || len > MAX_BODY) return res;
        const body = await res.arrayBuffer();
        const e: Entry = { status: res.status, statusText: res.statusText, headers: [...res.headers], body, expires: now() + ttl * 1000 };
        if (body.byteLength > MAX_BODY) return e;
        cache.set(key, e);
        if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
        return e;
      })().finally(() => inflight.delete(key));
      inflight.set(key, p);
      const r = await p;
      return r instanceof Response ? r : toResponse(r);
    }
    // Another call is already fetching this key: wait for it, and fetch our own if it wasn't cached.
    const r = await p.catch(() => undefined);
    return r && !(r instanceof Response) ? toResponse(r) : base(input as any, init);
  }) as Fetch;
  return Object.assign(wrapped, { preconnect: (base as any).preconnect });
}
