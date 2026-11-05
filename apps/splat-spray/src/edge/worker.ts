// Cloudflare entry for playing online. Serves the page, and routes /ws?room=ABCD to that room's
// World Durable Object: the same class the desktop runs in-process for LAN games. The Worker is the
// only place identity is decided: a player signed in through eqosys sends its token
// (`whoIs` in @rustybuns/util/token), anyone else is a guest. It strips any identity headers the client sent, and vouches its own.
import World from "../../packages/desktop/world.ts";
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import type { DONamespace } from "@rustybuns/util/matchmaker";
import { Matchmaker } from "./match.ts";
import { ROOM } from "../api.ts";
import { whoIs, type Door } from "@rustybuns/util/token";
import { APP, EQOSYS } from "../eqosys.ts";
import { Signups } from "./signups.ts";
export { World, Matchmaker, Signups };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: DONamespace;
  MATCH: DONamespace;
  SIGNUPS: DONamespace;
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
}

/** Per isolate. Keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();
/** New player ids one address may bring to quick play a minute, so a script can't flood the room filling up. */
const matchGate = new RoomMintGate(6);

/** Sign-ups one address may send a minute. */
const signupGate = new RoomMintGate(5);

/** Who a request is from: a signed-in player's eqosys token, else the guest uid their browser made (@rustybuns/util/token). */
const door = (env: { EQOSYS_URL?: string }): Door => ({ app: APP, eqosys: env.EQOSYS_URL || EQOSYS, fallbackName: "Spy" });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/match") {
      const who = await whoIs(url, door(env));
      if (who instanceof Response) return who;
      const { uid } = who;
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !matchGate.allow(ip, uid, Date.now())) return new Response("too many players from here, try again in a minute", { status: 429 });
      return env.MATCH.get(env.MATCH.idFromName("quick")).fetch(new Request(`https://match/?uid=${encodeURIComponent(uid)}`));
    }
    if (url.pathname === "/api/splat-spot") {
      if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin refused", { status: 403 });
      const ip = req.headers.get("CF-Connecting-IP");
      if (ip && !signupGate.allow(ip, crypto.randomUUID(), Date.now())) return new Response("too many tries, try again in a minute", { status: 429 });
      return env.SIGNUPS.get(env.SIGNUPS.idFromName("list")).fetch(req);
    }
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const who = await whoIs(url, door(env));
    if (who instanceof Response) return who;
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);   // never a client's word
    headers.set("X-User-Id", who.uid);
    headers.set("X-User-Name", who.name);
    return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
  },
};
