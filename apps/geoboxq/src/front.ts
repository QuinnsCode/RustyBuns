// The thing in front: sends each request to the first healthy host, in order (Cloudflare, Railway, then AWS only
// when both are down). Health is `GET /api/health`, remembered for a few seconds so a dead host costs one probe.
// Runs anywhere `fetch` does; keep it off the host it guards (`bun src/front.ts`, HOSTS=url,url,url).
const TTL = 10_000;
const PROBE = 2_000;

export function front(hosts: string[], now = Date.now) {
  const seen = new Map<string, { ok: boolean; at: number }>();

  async function healthy(host: string) {
    const hit = seen.get(host);
    if (hit && now() - hit.at < TTL) return hit.ok;
    const ok = await fetch(new URL("/api/health", host), { signal: AbortSignal.timeout(PROBE) }).then((r) => r.ok, () => false);
    seen.set(host, { ok, at: now() });
    return ok;
  }

  /** The first host that answers its health check, or the last one as a hail mary when none do. */
  async function pick() {
    for (const host of hosts) if (await healthy(host)) return host;
    return hosts.at(-1)!;
  }

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const host = await pick();
    const out = await fetch(new URL(url.pathname + url.search, host), { method: req.method, headers: req.headers, body: req.body, redirect: "manual" })
      .catch(() => null);
    if (out) return out;
    seen.set(host, { ok: false, at: now() }); // died mid-request: skip it until the next probe window
    return Response.json({ error: "no healthy host" }, { status: 502 });
  };
}

if (import.meta.main) {
  const hosts = (process.env.HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (!hosts.length) throw new Error("HOSTS is empty: comma-separate the Cloudflare, Railway and AWS URLs, in that order");
  const server = Bun.serve({ port: Number(process.env.PORT ?? 8788), fetch: front(hosts) });
  console.log(`GeoBoxQ front on http://localhost:${server.port} -> ${hosts.join(", ")}`);
}
