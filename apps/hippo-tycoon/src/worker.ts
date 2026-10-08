// Cloudflare entry. Serves the page, and routes /ws?room=ABCD to that room's
// World Durable Object (the same class the desktop runs in-process). The
// Worker is the only place identity is decided: it validates the player's id
// and name from the query, strips any identity headers the client sent, and
// vouches its own. The Durable Object trusts nothing else.
//
// It is also the front door against abuse: a browser upgrade from someone
// else's page is refused (Origin), and one address can only open so many new
// rooms a minute (each new code is a new Durable Object).
import { RoomMintGate, originAllowed } from "./engine/limits.ts";
import { World } from "./room-do.ts";
export { World };

interface Env {
  ASSETS: { fetch(r: Request): Promise<Response> };
  WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

const ROOM = /^[A-Z0-9]{3,8}$/;
const UID = /^[A-Za-z0-9_-]{8,64}$/;
const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);
/** Per isolate. Keyed by CF-Connecting-IP, which Cloudflare sets and a client cannot. */
export const mintGate = new RoomMintGate();

export default {
  fetch(req: Request, env: Env): Response | Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws") return env.ASSETS.fetch(req);

    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    if (!originAllowed(req.headers.get("Origin"), url)) return new Response("cross-origin websocket refused", { status: 403 });
    const room = (url.searchParams.get("room") ?? "").toUpperCase();
    if (!ROOM.test(room)) return new Response("bad room code", { status: 400 });
    const uid = url.searchParams.get("uid") ?? "";
    if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
    const ip = req.headers.get("CF-Connecting-IP");
    if (ip && !mintGate.allow(ip, room, Date.now())) return new Response("too many new rooms, try again in a minute", { status: 429, headers: { "Retry-After": "60" } });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.toLowerCase().startsWith("x-")) headers.delete(k);   // never a client's word
    headers.set("X-User-Id", uid);
    headers.set("X-User-Name", clean(url.searchParams.get("name"), 24) || "Tycoon");
    headers.set("X-Room", room);
    return env.WORLD.get(env.WORLD.idFromName(room)).fetch(new Request(req, { headers }));
  },
};
