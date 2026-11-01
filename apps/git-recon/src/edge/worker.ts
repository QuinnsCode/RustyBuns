// Cloudflare entry for battles online. Serves the page, and routes /ws?room=CODE to that room's
// World Durable Object: the same class the desktop runs in-process for LAN battles. The Worker is
// the only place identity is decided: a player signed in through eqosys sends its token (edge/eqosys.ts),
// anyone else a uid and name; it strips any identity headers the client sent and vouches its own. Everyone is a guest to the
// world's rules, so the
// world (with ONLINE set) lets whoever picks the battle first own the room. /__rb/info tells the
// page it's online, so the battle menu deals in room codes instead of addresses.
import World from "../net/world.ts";
import { whoIs } from "./eqosys.ts";
import { originAllowed, RoomMintGate } from "@rustybuns/util/limits";
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/__rb/info") return Response.json({ app: "git-recon", online: true }, { headers: { "Cache-Control": "no-store" } });
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
