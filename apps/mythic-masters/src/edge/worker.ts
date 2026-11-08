// Cloudflare entry for walking the world together (#3663) and fighting a friend. Serves the built page, routes
// /duel?room=CODE to that duel's Duel Durable Object (edge/duel.ts, two seats), and routes
// /ws?room=CODE (the room an eqosys party started, net/online.ts) to that party's Region Durable Object: one per party,
// never one per player. Solo play never comes here (no party, no socket). A player signed in through eqosys
// sends its token (`whoIs` in @rustybuns/util/token); only where GUESTS is set (the local edge) may a guest join with the uid its browser made. The Worker checks the id and
// name, strips any identity headers the client sent, and vouches its own.
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import { refuseSocket } from "@rustybuns/util/room";
import { whoIs, type Door } from "@rustybuns/util/token";
import { APP, EQOSYS } from "../account.ts";
import { DUEL_CODE } from "../net/duel.ts";
import { Duel } from "./duel.ts";
import { Region } from "./region.ts";
// The Durable Object classes are the only named exports: workerd takes every named export of the Worker's module for an
// entrypoint and refuses to start on a constant (test/edge.test.ts runs it there).
export { Duel, Region };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
  /** "1" lets a guest in with the uid its browser made (scripts/party.ts, for dev and tests). Unset, every join carries an eqosys token. */
  GUESTS?: string;
  REGION: Rooms;
  /** One Duel per fight a friend challenged you to (/duel?room=CODE, net/duel.ts). */
  DUEL?: Rooms;
}
interface Rooms { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } }

/** The room code an eqosys party starts with (packages/util/src/eqosys.ts `party`, its `onStart`). */
const ROOM = /^[A-Z0-9]{4,12}$/;
/** The socket's close code when its token is missing or ran out: the page stops trying and asks you to sign in. */
const CLOSE_SIGN_IN = 4401;
/** Per isolate, keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();

/** Who a request is from: a signed-in player's eqosys token, else the guest uid their browser made (@rustybuns/util/token). */
const door = (env: { EQOSYS_URL?: string }): Door => ({ app: APP, eqosys: env.EQOSYS_URL || EQOSYS, fallbackName: "Wanderer" });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const duel = url.pathname === "/duel";
    if (url.pathname !== "/ws" && !duel) return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!(duel ? DUEL_CODE : ROOM).test(room)) return new Response("bad room code", { status: 400 });
    // A refused upgrade shows the page no status, so "sign in again" goes as a socket closed with CLOSE_SIGN_IN.
    const signIn = () => refuseSocket(JSON.stringify({ error: "sign in" }), CLOSE_SIGN_IN, "sign in");
    if (!url.searchParams.has("token") && env.GUESTS !== "1") return signIn();
    const who = await whoIs(url, door(env));
    if (who instanceof Response) return who.status === 401 ? signIn() : who;
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);
    headers.set("X-User-Id", who.uid);
    headers.set("X-User-Name", who.name);
    if (duel && !env.DUEL) return new Response("no duels here", { status: 503 });
    if (duel && env.DUEL) return env.DUEL.get(env.DUEL.idFromName(`${room}:duel`)).fetch(new Request(req, { headers }));
    // One room per party: where each of them stands is in their pose, not in the room's name.
    return env.REGION.get(env.REGION.idFromName(`${room}:party`)).fetch(new Request(req, { headers }));
  },
};
