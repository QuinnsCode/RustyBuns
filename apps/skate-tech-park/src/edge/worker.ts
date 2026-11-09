// Cloudflare entry for playing together. Serves the built page, and routes /ws?room=ABCD&level=el-capitan
// to that room's World Durable Object. Up to 4 riders a room. A rider signed in through eqosys sends its token
// (`seatDoor` in @rustybuns/util/seats); anyone else is a guest. The door checks the id and name, strips any identity headers the client sent, and vouches its own.
import { RoomMintGate } from "@rustybuns/util/limits";
import { seatDoor } from "@rustybuns/util/seats";
import { Purchases, handlePay, type PayEnv } from "./pay.ts";
import type { Door } from "@rustybuns/util/token";
import { APP, EQOSYS } from "../eqosys.ts";
import { World } from "./world.ts";
export { World, Purchases };

interface Env extends PayEnv {
  ASSETS: { fetch(r: Request): Promise<Response> };
  /** The eqosys that signs riders' tokens; the live one when unset. */
  EQOSYS_URL?: string;
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

export const ROOM = /^[A-Z0-9]{4,8}$/;
const LEVEL = /^[a-z0-9-]{1,32}$/;
/** Per isolate, keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();

/** Who a request is from: a signed-in player's eqosys token, else the guest uid their browser made (@rustybuns/util/token). */
const door = (env: { EQOSYS_URL?: string }): Door => ({ app: APP, eqosys: env.EQOSYS_URL || EQOSYS, fallbackName: "Skater" });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return (await handlePay(req, env, url)) ?? new Response("not found", { status: 404 });
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);
    const level = url.searchParams.get("level") ?? "";
    if (req.headers.get("Upgrade")?.toLowerCase() === "websocket" && !LEVEL.test(level)) return new Response("bad level", { status: 400 });
    const seat = await seatDoor(req, { door: door(env), room: ROOM, gate: mintGate });
    if (seat instanceof Response) return seat;
    // A room is a level, a code and a mode: the same code on two levels, with and without collisions, or at real and squashed height, is two rooms.
    return env.WORLD.get(env.WORLD.idFromName(`${level}:${seat.room}${url.searchParams.get("pve") === "1" ? ":pve" : ""}${url.searchParams.has("real") ? ":real" : ""}`)).fetch(seat.request);
  },
};
