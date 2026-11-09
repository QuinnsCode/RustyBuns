// Cloudflare entry for battles online. Serves the page, and routes /ws?room=CODE to that room's
// World Durable Object: the same class the desktop runs in-process for LAN battles. The Worker is
// the only place identity is decided: a player signed in through eqosys sends its token (`seatDoor` in @rustybuns/util/seats),
// anyone else a uid and name; it strips any identity headers the client sent and vouches its own. Everyone is a guest to the
// world's rules, so the
// world (with ONLINE set) lets whoever picks the battle first own the room. /__rb/info tells the
// page it's online, so the battle menu deals in room codes instead of addresses.
import World from "../net/world.ts";
import type { Door } from "@rustybuns/util/token";
import { seatDoor } from "@rustybuns/util/seats";
import { APP, EQOSYS } from "../eqosys.ts";
import { RoomMintGate } from "@rustybuns/util/limits";
export { World };

type DONamespace = { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: DONamespace;
  ONLINE?: string;
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
}

/** A room code: what the page makes, and what a friend types in. */
export const ROOM = /^[A-Z0-9]{4,8}$/;
/** Per isolate. Keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();

/** Who a request is from: a signed-in player's eqosys token, else the guest uid their browser made (@rustybuns/util/token). */
const door = (env: { EQOSYS_URL?: string }): Door => ({ app: APP, eqosys: env.EQOSYS_URL || EQOSYS, fallbackName: "soldier" });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/__rb/info") return Response.json({ app: "git-recon", online: true }, { headers: { "Cache-Control": "no-store" } });
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);

    const seat = await seatDoor(req, { door: door(env), room: ROOM, gate: mintGate });
    if (seat instanceof Response) return seat;
    return env.WORLD.get(env.WORLD.idFromName(seat.room)).fetch(seat.request);
  },
};
