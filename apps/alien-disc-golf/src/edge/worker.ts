// Cloudflare entry: the page from static assets, and /api/wind, which hands the page NOAA's latest GFS
// wind grid (10 m and 250 mb u and v, 1°, about 200 KB of GRIB2) fetched from NOMADS. The bytes are kept
// in this isolate for half an hour so NOMADS sees one request per edge location per half hour, not one
// per player. The page decodes the GRIB itself (src/grib2.ts), so this stays a relay.
import { gfsCandidates, isGrib } from "./gfs.ts";

interface Env { ASSETS: { fetch(r: Request): Promise<Response> } }

const KEEP_MS = 30 * 60e3;
interface Kept { bytes: Uint8Array<ArrayBuffer>; cycle: string; hour: number; at: number }
let kept: Kept | null = null;
let inflight: Promise<Kept> | null = null;

async function latestWind(now: Date, fetcher: typeof fetch = fetch): Promise<Kept> {
  if (kept && now.getTime() - kept.at < KEEP_MS) return kept;
  inflight ??= (async () => {
    const tried: string[] = [];
    for (const c of gfsCandidates(now)) {
      try {
        const res = await fetcher(c.url, { headers: { "User-Agent": "alien-disc-golf (RustyBuns example)" } });
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (res.ok && isGrib(bytes)) return (kept = { bytes, cycle: c.cycle.toISOString(), hour: c.hour, at: now.getTime() });
        tried.push(`${c.cycle.toISOString()} f${c.hour}: ${res.status}${isGrib(bytes) ? "" : " not GRIB"}`);
      } catch (e) {
        tried.push(`${c.cycle.toISOString()} f${c.hour}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(`NOMADS had no readable GFS file: ${tried.join("; ")}`);
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function windResponse(now = new Date(), fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const w = await latestWind(now, fetcher);
    return new Response(w.bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=900",
        "X-GFS-Cycle": w.cycle,
        "X-GFS-Hour": String(w.hour),
      },
    });
  } catch (e) {
    // Stale is better than nothing: the last grid we had, marked as such.
    if (kept) return new Response(kept.bytes, { headers: { "Content-Type": "application/octet-stream", "X-GFS-Cycle": kept.cycle, "X-GFS-Hour": String(kept.hour), "X-GFS-Stale": "1" } });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/wind") return windResponse();
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 });
    return env.ASSETS.fetch(req);
  },
};
