// Cloudflare entry for a crew: serves the built page, and routes /ws?room=ABCD&level=garage to that room's World
// Durable Object. A player signed in through eqosys sends its token (`seatDoor` in @rustybuns/util/seats); anyone else
// is a guest. The door strips identity headers the client sent and vouches its own.
import { RoomMintGate } from "@rustybuns/util/limits";
import { seatDoor } from "@rustybuns/util/seats";
import type { Door } from "@rustybuns/util/token";
import { APP, EQOSYS } from "../eqosys.ts";
import { World } from "./world.ts";
export { World };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

export const ROOM = /^[A-Z0-9]{4,12}$/;
const LEVEL = /^[a-z0-9-]{1,32}$/;
/** Per isolate, keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();

const door = (env: { EQOSYS_URL?: string }): Door => ({ app: APP, eqosys: env.EQOSYS_URL || EQOSYS, fallbackName: "Roadie" });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);
    const level = url.searchParams.get("level") ?? "";
    if (!LEVEL.test(level)) return new Response("bad level", { status: 400 });
    const seat = await seatDoor(req, { door: door(env), room: ROOM, gate: mintGate });
    if (seat instanceof Response) return seat;
    // A crew is a code on a level: the same code in the garage and the park is two rooms.
    return env.WORLD.get(env.WORLD.idFromName(`${level}:${seat.room}`)).fetch(seat.request);
  },
};
