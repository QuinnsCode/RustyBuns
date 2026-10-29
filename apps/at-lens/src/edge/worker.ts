// Cloudflare entry: the page from static assets, and the two lookups a browser can't make on its own (a DNS TXT
// record, a handle's own /.well-known, which sends no CORS headers). Everything read is public; no keys, no bindings.
import { lookup, NotFound, records, type Fetcher } from "./atproto.ts";

interface Env { ASSETS: { fetch(r: Request): Promise<Response> } }

const answer = async (work: () => Promise<unknown>): Promise<Response> => {
  try {
    return Response.json(await work(), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    const status = e instanceof NotFound ? 404 : 502;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status, headers: { "Cache-Control": "no-store" } });
  }
};

export function api(url: URL, f: Fetcher = fetch): Promise<Response> | null {
  const q = url.searchParams;
  if (url.pathname === "/api/lookup") return answer(() => lookup(q.get("q") ?? "", f));
  if (url.pathname === "/api/records") return answer(() => records(q.get("did") ?? "", q.get("collection") ?? "", f));
  return null;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const res = api(url);
    if (res) return res;
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Not found" }, { status: 404 });
    return env.ASSETS.fetch(req);
  },
};
