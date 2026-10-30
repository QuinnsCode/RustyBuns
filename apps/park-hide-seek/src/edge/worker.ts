// Cloudflare entry for playing online. Serves the page, and routes
// /ws?room=ABCD to that room's World Durable Object: the same class the
// desktop runs in-process for LAN games. The Worker is the only place identity
// is decided: a player who signed in through eqosys sends its token and the
// Worker takes their id and name from that; anyone else sends the id their
// browser made and the name they typed (src/edge/eqosys.ts). It strips any
// identity headers the client sent and vouches its own. Everyone is a guest
// here, so whoever reaches a room first hosts it. /api/match is quick play:
// the Matchmaker hands out the room that's filling up right now. /api/parks is
// "Request a park": votes for the next national park (src/edge/requests.ts). A client below
// MIN_PROTOCOL (`pv` in the query) is told to update, not served (@rustybuns/util/protocol).
import World from "../../packages/desktop/world.ts";
import { sha256 } from "@rustybuns/util/bytes";
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import { tooOld } from "@rustybuns/util/protocol";
import { MIN_PROTOCOL, REPORT_REASONS, ROOM, STORE_URL } from "../api.ts";
import { whoIs } from "./eqosys.ts";
import { Matchmaker, type DONamespace } from "./match.ts";
import { ParkRequests } from "./requests.ts";
import { zoneReply } from "./zone.ts";
export { World, Matchmaker, ParkRequests };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: DONamespace;
  MATCH: DONamespace;
  PARKS: DONamespace;
  /** The eqosys that signs players' tokens; the live one when unset (wrangler.jsonc). */
  EQOSYS_URL?: string;
}

/** Per isolate. Keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();
/** New player ids one address may bring to quick play a minute, so a script can't flood the room filling up. */
const matchGate = new RoomMintGate(6);
/** Park votes one address may cast a minute. */
const voteGate = new RoomMintGate(5);
/** Reports one address may send a minute. */
const reportGate = new RoomMintGate(5);
/** Votes are kept under a hash of the player's id, which is their login. */
const voter = async (uid: string) => (await sha256(`park-vote:${uid}`)).slice(0, 24);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const old = url.pathname === "/ws" || url.pathname.startsWith("/api/") ? tooOld(url, { min: MIN_PROTOCOL, store: STORE_URL }) : null;
    if (old) return url.pathname === "/ws" ? old.socket() : old.http();
    if (url.pathname === "/api/match") {
      const who = await whoIs(url, env);
      if (who instanceof Response) return who;
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !matchGate.allow(ip, who.uid, Date.now())) return new Response("too many players from here, try again in a minute", { status: 429 });
      return env.MATCH.get(env.MATCH.idFromName("quick")).fetch(new Request(`https://match/?uid=${encodeURIComponent(who.uid)}`));
    }
    if (url.pathname === "/api/parks") return parks(req, url, env);
    if (url.pathname === "/api/zone") {
      const zone = await zoneReply(url.searchParams.get("id") ?? "");
      return zone ? Response.json(zone, { headers: { "Cache-Control": "public, max-age=86400" } }) : new Response("no such zone", { status: 404 });
    }
    if (url.pathname === "/api/report") return report(req, url, env);
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const who = await whoIs(url, env);
    if (who instanceof Response) return who;
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);   // never a client's word
    headers.set("X-User-Id", who.uid);
    headers.set("X-User-Name", who.name);
    headers.set("X-RB-Principal", "guest");
    return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
  },
};

/** Report a player met in quick play (the iOS app's Report button). Read in the Worker's logs; nothing is stored. */
async function report(req: Request, url: URL, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response("post only", { status: 405 });
  const who = await whoIs(url, env);
  if (who instanceof Response) return who;
  const room = (url.searchParams.get("room") ?? "").toUpperCase();
  const player = url.searchParams.get("player") ?? "";
  const reason = REPORT_REASONS.find((r) => r === url.searchParams.get("reason"));
  if (!ROOM.test(room) || !/^[0-9a-f]{16}$/.test(player) || !reason) return new Response("bad report", { status: 400 });
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip && !reportGate.allow(ip, player, Date.now())) return new Response("too many reports, try again in a minute", { status: 429 });
  console.log(JSON.stringify({ report: { room, player, reason, by: await voter(who.uid) } }));
  return new Response(null, { status: 204 });
}

async function parks(req: Request, url: URL, env: Env): Promise<Response> {
  const stub = env.PARKS.get(env.PARKS.idFromName("parks"));
  if (req.method !== "POST") return stub.fetch(new Request("https://parks/"));
  if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin vote refused", { status: 403 });
  const code = (url.searchParams.get("code") ?? "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) return new Response("bad vote", { status: 400 });
  const who = await whoIs(url, env);
  if (who instanceof Response) return who;
  const ip = req.headers.get("CF-Connecting-IP");
  if (ip && !voteGate.allow(ip, code, Date.now())) return new Response("too many votes, try again in a minute", { status: 429 });
  return stub.fetch(new Request(`https://parks/?code=${code}&voter=${await voter(who.uid)}`, { method: "POST" }));
}
