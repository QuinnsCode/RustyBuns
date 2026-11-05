// Cloudflare entry for walking the world together (#3663). Serves the built page, and routes
// /ws?room=CODE&region=N (CODE: the room an eqosys party started, net/online.ts) to that room's Region: one Region Durable Object
// per occupied region of a party, never one per player. Solo play never comes here (no party, no socket). A player signed in through eqosys
// sends its token (edge/eqosys.ts); anyone else is a guest with the uid its browser made. The Worker checks the id and
// name, strips any identity headers the client sent, and vouches its own.
import { RoomMintGate, originAllowed } from "@rustybuns/util/limits";
import { whoIs } from "./eqosys.ts";
import { Region } from "./region.ts";
export { Region };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  /** The eqosys that signs players' tokens; the live one when unset. */
  EQOSYS_URL?: string;
  REGION: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

/** The room code an eqosys party starts with (packages/util/src/eqosys.ts `party`, its `onStart`). */
export const ROOM = /^[A-Z0-9]{4,12}$/;
/** Per isolate, keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
const mintGate = new RoomMintGate();

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const region = Number(url.searchParams.get("region"));
    if (!Number.isInteger(region) || region < 1 || region > 64) return new Response("bad region", { status: 400 });
    const who = await whoIs(url, env);
    if (who instanceof Response) return who;
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, `${room}:${region}`, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);
    headers.set("X-User-Id", who.uid);
    headers.set("X-User-Name", who.name);
    return env.REGION.get(env.REGION.idFromName(`${room}:${region}`)).fetch(new Request(req, { headers }));
  },
};
