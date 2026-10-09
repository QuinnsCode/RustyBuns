// Cloudflare entry for playing online. Serves the page, and routes
// /ws?room=ABCD to that room's World Durable Object: the same class the
// desktop runs in-process for LAN games. The Worker is the only place identity
// is decided: it checks the player's id and name from the query, strips any
// identity headers the client sent, and vouches its own. Everyone is a guest
// here, so whoever reaches a room first hosts it. /api/match is quick play:
// the Matchmaker hands out the room that's filling up right now.
import World from "../../packages/desktop/world.ts";
import { RoomMintGate, originAllowed } from "./limits.ts";
import { Matchmaker, type DONamespace } from "./match.ts";
export { World, Matchmaker };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: DONamespace;
  MATCH: DONamespace;
}

export const ROOM = /^[A-Z0-9]{4,8}$/;
const UID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);
/** Per isolate. Keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();
/** New player ids one address may bring to quick play a minute, so a script can't flood the room filling up. */
const matchGate = new RoomMintGate(6);

export default {
  fetch(req: Request, env: Env): Response | Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/match") {
      const uid = url.searchParams.get("uid") ?? "";
      if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !matchGate.allow(ip, uid, Date.now())) return new Response("too many players from here, try again in a minute", { status: 429 });
      return env.MATCH.get(env.MATCH.idFromName("quick")).fetch(new Request(`https://match/?uid=${uid}`));
    }
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const uid = url.searchParams.get("uid") ?? "";
    if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);   // never a client's word
    headers.set("X-User-Id", uid);
    headers.set("X-User-Name", clean(url.searchParams.get("name"), 24) || "Camper");
    headers.set("X-RB-Principal", "guest");
    return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
  },
};
