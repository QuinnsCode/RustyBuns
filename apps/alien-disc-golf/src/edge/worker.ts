// Cloudflare entry: the page from static assets, and two relays so the page never talks to NOAA itself.
// /api/wind is NOAA's latest GFS wind grid (10 m and 250 mb u and v, 1°, about 200 KB of GRIB2) from
// NOMADS, kept half an hour. /api/currents is NOAA CoastWatch's latest daily ocean currents from ERDDAP,
// packed to 130 KB (src/currents.ts), kept six hours. Each isolate asks upstream once per keep, not once
// per player, and hands back the last good copy, marked stale, when upstream fails.
import { ERDDAP_URL, packDods } from "../currents.ts";
import { gfsCandidates, isGrib } from "./gfs.ts";

interface Env { ASSETS: { fetch(r: Request): Promise<Response> } }

interface Kept { bytes: Uint8Array<ArrayBuffer>; headers: Record<string, string>; at: number }

/** One upstream file, fetched at most once per `keepMs` per isolate however many players ask at once. */
export function relay(keepMs: number, fresh: (now: Date, fetcher: typeof fetch) => Promise<Omit<Kept, "at">>) {
  let kept: Kept | null = null;
  let inflight: Promise<Kept> | null = null;
  return async (now = new Date(), fetcher: typeof fetch = fetch): Promise<Response> => {
    try {
      if (!kept || now.getTime() - kept.at >= keepMs) {
        inflight ??= fresh(now, fetcher).then((k) => (kept = { ...k, at: now.getTime() })).finally(() => { inflight = null; });
        await inflight;
      }
      return new Response(kept!.bytes, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=900", ...kept!.headers } });
    } catch (e) {
      if (kept) return new Response(kept.bytes, { headers: { "Content-Type": "application/octet-stream", ...kept.headers, "X-Stale": "1" } });
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}

const UA = { "User-Agent": "alien-disc-golf (RustyBuns example)" };

export const windResponse = relay(30 * 60e3, async (now, fetcher) => {
  const tried: string[] = [];
  for (const c of gfsCandidates(now)) {
    try {
      const res = await fetcher(c.url, { headers: UA });
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (res.ok && isGrib(bytes)) return { bytes, headers: { "X-GFS-Cycle": c.cycle.toISOString(), "X-GFS-Hour": String(c.hour) } };
      tried.push(`${c.cycle.toISOString()} f${c.hour}: ${res.status}${isGrib(bytes) ? "" : " not GRIB"}`);
    } catch (e) {
      tried.push(`${c.cycle.toISOString()} f${c.hour}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`NOMADS had no readable GFS file: ${tried.join("; ")}`);
});

export const currentsResponse = relay(6 * 3600e3, async (_now, fetcher) => {
  const res = await fetcher(ERDDAP_URL, { headers: UA });
  if (!res.ok) throw new Error(`ERDDAP answered ${res.status}`);
  const packed = packDods(new Uint8Array(await res.arrayBuffer()));
  return { bytes: new Uint8Array(packed), headers: {} };
});

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/wind") return windResponse();
    if (url.pathname === "/api/currents") return currentsResponse();
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 });
    return env.ASSETS.fetch(req);
  },
};
