// Cloudflare entry: the page from static assets, and the two lookups a browser can't make on its own (a DNS TXT
// record, a handle's own /.well-known, which sends no CORS headers). Everything read is public; no keys, no bindings.
// For signing in it also serves the OAuth client metadata (the client_id is that URL) and resolves handles for the
// OAuth client in the page; the tokens themselves stay in the page and never pass through here.
import { clientMetadata } from "../lexicon.ts";
import { isHandle, lookup, NotFound, records, resolveHandle, type Fetcher } from "./atproto.ts";

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
  if (url.pathname === "/client-metadata.json") return Promise.resolve(Response.json(clientMetadata(url.origin), { headers: { "Cache-Control": "public, max-age=300" } }));
  if (url.pathname === "/xrpc/com.atproto.identity.resolveHandle") return resolveXrpc(q.get("handle") ?? "", f);
  return null;
}

/** com.atproto.identity.resolveHandle, the XRPC the OAuth client asks before sign-in: our own walk, not a third party's. */
async function resolveXrpc(raw: string, f: Fetcher): Promise<Response> {
  const handle = raw.trim().toLowerCase();
  const found = isHandle(handle) ? await resolveHandle(handle, f) : null;
  return found
    ? Response.json({ did: found.did }, { headers: { "Cache-Control": "public, max-age=60" } })
    : Response.json({ error: "InvalidRequest", message: `${handle.slice(0, 80) || "that"} doesn't resolve to a DID` }, { status: 400 });
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
