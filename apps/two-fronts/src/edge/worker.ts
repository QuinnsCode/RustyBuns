// Cloudflare entry for campaigns played a turn at a time: serves the page, and routes
// /api/campaigns/<id>/... to that campaign's Durable Object, the vote's pointer socket included.
// POST /api/campaigns starts one and hands back its id and a seat token for each human side.
import { CampaignRoom } from "./campaign.ts";
import { allowStart } from "./limits.ts";
import { EQOSYS_HEADER, PartyAsk, TICKET_SEAT_HEADER } from "./view.ts";
import { APP, EQOSYS } from "../account.ts";
import { startTicket, whoIs, type Door } from "@rustybuns/util/token";
import { check } from "@rustybuns/util/guard";
// workerd takes only handlers and Durable Object classes from this module, so nothing else goes out.
export { CampaignRoom };

interface DONamespace {
  newUniqueId(): { toString(): string };
  idFromName(name: string): { toString(): string };
  idFromString(hex: string): unknown;
  get(id: unknown): { fetch(r: Request): Promise<Response> };
}
interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  CAMPAIGN: DONamespace;
  /** Another eqosys than the live one (a local one, or a test's). */
  EQOSYS_URL?: string;
}

/** Who a party's ask is from: the eqosys account its token was signed for (@rustybuns/util/token). */
const door = (e: Env): Door => ({ app: APP, eqosys: e.EQOSYS_URL || EQOSYS, fallbackName: "Commander" });

// Cloudflare's ids are 64 hex characters; the in-process host's are 32 (a named one 16).
const ID = /^[0-9a-f]{16,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // A war from an eqosys party: the room eqosys gave the party names its campaign, so every seat finds the same one.
    const party = url.pathname.match(/^\/api\/parties\/([A-Z0-9]{4,12})$/);
    if (party && req.method === "POST") {
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !allowStart(ip, Date.now())) return Response.json({ error: "Too many asks, try again in a minute" }, { status: 429 });
      // A party seat is an eqosys account's, so knowing the party's code isn't enough to sit in someone's seat.
      const token = req.headers.get(EQOSYS_HEADER);
      if (!token) return Response.json({ error: "Sign in with eqosys to take your seat" }, { status: 401 });
      const who = await whoIs(new URL(`https://two-fronts/?${new URLSearchParams({ token })}`), door(env));
      if (who instanceof Response) return Response.json({ error: "Sign in with eqosys again to take your seat" }, { status: 401 });
      const text = await req.text();
      let ask: PartyAsk | null = null;
      try { ask = check(PartyAsk, JSON.parse(text)); } catch { /* not JSON: the room says what it wanted */ }
      // Knowing the code isn't being in the party: the ticket the party handed this account on start says which seat it was given.
      const ticket = ask?.ticket ? await startTicket(door(env).eqosys, APP, ask.ticket) : null;
      const seat = ticket && `eq:${ticket.sub}` === who.uid && ticket.room === party[1] && ticket.seat === ask?.seat ? String(ticket.seat) : null;
      const id = env.CAMPAIGN.idFromName(`party:${party[1]}`);
      // The room trusts X-User-Id and the ticket's seat only from here: the Worker builds this request, so no client sets them.
      const headers: Record<string, string> = { "X-User-Id": who.uid, ...(seat !== null && { [TICKET_SEAT_HEADER]: seat }) };
      return env.CAMPAIGN.get(id).fetch(new Request(`https://campaign/party?id=${id.toString()}`, { method: "POST", headers, body: text }));
    }
    if (!url.pathname.startsWith("/api/campaigns")) return env.ASSETS.fetch(req);
    if (url.pathname === "/api/campaigns" && req.method === "POST") {
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !allowStart(ip, Date.now())) return Response.json({ error: "Too many new campaigns, try again in a minute" }, { status: 429 });
      // The room answers with a `Started`: its id and a seat token for each human side.
      const id = env.CAMPAIGN.newUniqueId();
      return env.CAMPAIGN.get(id).fetch(new Request(`https://campaign/create?id=${id.toString()}`, { method: "POST", body: await req.text() }));
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
