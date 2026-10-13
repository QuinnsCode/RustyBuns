// Cloudflare entry for campaigns played a turn at a time: serves the page, and routes
// /api/campaigns/<id>/... to that campaign's Durable Object, the vote's pointer socket included.
// POST /api/campaigns starts one and hands back its id and a seat token for each human side.
import { CampaignRoom } from "./campaign.ts";
import { allowStart } from "./limits.ts";
// workerd takes only handlers and Durable Object classes from this module, so nothing else goes out.
export { CampaignRoom };

interface DONamespace {
  newUniqueId(): { toString(): string };
  idFromString(hex: string): unknown;
  get(id: unknown): { fetch(r: Request): Promise<Response> };
}
interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  CAMPAIGN: DONamespace;
}

// Cloudflare's unique ids are 64 hex characters; the in-process host's are 32.
const ID = /^[0-9a-f]{32,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/campaigns")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/campaigns" && req.method === "POST") {
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !allowStart(ip, Date.now())) return Response.json({ error: "Too many new campaigns, try again in a minute" }, { status: 429 });
      const id = env.CAMPAIGN.newUniqueId();
      const res = await env.CAMPAIGN.get(id).fetch(new Request("https://campaign/create", { method: "POST", body: await req.text() }));
      if (!res.ok) return res;
      return Response.json({ id: id.toString(), ...((await res.json()) as object) }, { status: 201 });
    }
    const m = url.pathname.match(/^\/api\/campaigns\/([^/]+)(\/[a-z]+)?\/?$/);
    if (!m || !ID.test(m[1]!)) return Response.json({ error: "No such campaign" }, { status: 404 });
    const room = env.CAMPAIGN.get(env.CAMPAIGN.idFromString(m[1]!));
    // The vote's pointer socket goes through as it came, Upgrade header and all.
    if (m[2] === "/pointers") return room.fetch(new Request("https://campaign/pointers", req));
    const headers = new Headers({ "Content-Type": "application/json" });
    const auth = req.headers.get("Authorization");
    if (auth) headers.set("Authorization", auth);
    const body = req.method === "POST" ? await req.text() : undefined;
    return room.fetch(new Request(`https://campaign${m[2] ?? "/"}`, { method: req.method, headers, body }));
  },
};
