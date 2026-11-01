// Cloudflare entry for playing together. Serves the built page, and routes /ws?room=ABCD&level=el-capitan
// to that room's World Durable Object. Up to 4 riders a room. A rider signed in through eqosys sends its token
// (edge/eqosys.ts); anyone else is a guest. The Worker checks the id and name, strips any identity headers the client sent, and vouches its own.
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import { Purchases, handlePay, type PayEnv } from "./pay.ts";
import { whoIs } from "./eqosys.ts";
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return (await handlePay(req, env, url)) ?? new Response("not found", { status: 404 });
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const level = url.searchParams.get("level") ?? "";
    if (!LEVEL.test(level)) return new Response("bad level", { status: 400 });
    const who = await whoIs(url, env);
    if (who instanceof Response) return who;
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);
    headers.set("X-User-Id", who.uid);
    headers.set("X-User-Name", who.name);
    // A room is a level, a code and a mode: the same code on two levels, with and without collisions, or at real and squashed height, is two rooms.
    return env.WORLD.get(env.WORLD.idFromName(`${level}:${room}${url.searchParams.get("pve") === "1" ? ":pve" : ""}${url.searchParams.has("real") ? ":real" : ""}`)).fetch(new Request(req, { headers }));
  },
};
