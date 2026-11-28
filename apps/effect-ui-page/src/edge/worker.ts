// Agent Page on Cloudflare: the built page as static assets (every /r/<room> is the same page), and one Room Durable
// Object per room that relays agents' calls to the page open in someone's browser (../relay.ts). /api/r/<room>/socket
// is the page's socket; /tools and /mcp are the agents' doors; /picture and the page's link preview are share.ts;
// /world is the room's saved world and /made marks it made (../saved.ts). /api/galaxy is Agent Galaxy, one Durable
// Object for the whole map (./galaxy.ts), which also keeps each signed-in person's world (/api/me/world). `bun run deploy`.
import { type RoomCtx, type RoomSocket, Sockets } from "@rustybuns/util/room";
import { json } from "@rustybuns/util/http";
import type { Kv } from "../galaxy.ts";
import { fromPage, linksFor, Relay } from "../relay.ts";
import { Saved } from "../saved.ts";
import { pictureBucket, pictureHttp, type Pictures, withCard } from "../share.ts";
import { ROOM } from "../tools.ts";

export { Galaxy } from "./galaxy.ts";

interface Stub { fetch(r: Request): Promise<Response> }
interface Env {
  ASSETS: Stub;
  ROOM: { idFromName(name: string): unknown; get(id: unknown): Stub };
  GALAXY: { idFromName(name: string): unknown; get(id: unknown): Stub };
  /** Where eqosys is (wrangler.jsonc's vars): the Galaxy checks sign-in tokens against its keys. */
  EQOSYS_URL?: string;
}

/** /api/r/<room><rest>: the room and the rest of the path, or null. */
const roomOf = (path: string) => {
  const m = path.match(/^\/api\/r\/([^/]+)(\/.*)?$/);
  return m && ROOM.test(m[1]!) ? { room: m[1]!, rest: m[2] ?? "" } : null;
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // An MCP client asks whether it must sign in first (OAuth discovery): no.
    if (url.pathname.startsWith("/.well-known/")) return json({ error: "no sign-in: the room's link is its key" }, 404);
    if (url.pathname === "/api/galaxy" || url.pathname.startsWith("/api/galaxy/") || url.pathname === "/api/me/world") return env.GALAXY.get(env.GALAXY.idFromName("galaxy")).fetch(req);
    if (url.pathname.startsWith("/api/")) {
      const r = roomOf(url.pathname);
      return r ? env.ROOM.get(env.ROOM.idFromName(r.room)).fetch(req) : json({ error: "not a room: /api/r/<room>/tools" }, 404);
    }
    // `/` and `/r/<room>`: the built page, with its link preview written into its head.
    const headers = new Headers(req.headers);
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    const page = await env.ASSETS.fetch(new Request(req, { headers }));
    if (url.pathname !== "/" && !url.pathname.startsWith("/r/")) return page;
    return withCard(page, url, async (room) => (await env.ROOM.get(env.ROOM.idFromName(room)).fetch(new Request(`${url.origin}/api/r/${room}/picture`, { method: "HEAD" }))).ok);
  },
};

/** What the room's object keeps: its latest picture. */
interface Storage { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> }

/** One room: its page's sockets (the newest one gets the calls) and the relay between them and the agents. */
export class Room {
  private sockets: Sockets<{ at: number }>;
  private relay: Relay;
  private pictures: Pictures;
  private uploads = pictureBucket();
  private saved: Saved;
  constructor(ctx: RoomCtx & { storage: Storage & Kv }) {
    this.pictures = { get: () => ctx.storage.get<Uint8Array<ArrayBuffer>>("picture"), put: (bytes) => ctx.storage.put("picture", bytes) };
    // A page only answers calls: a few frames a second, each at most a page's worth of JSON.
    this.sockets = new Sockets(ctx, { maxBytes: 256_000, rate: 20, burst: 40 });
    this.saved = new Saved(ctx.storage);
    this.relay = new Relay(() => {
      const newest = this.sockets.open().sort((a, b) => (this.sockets.who(b)?.at ?? 0) - (this.sockets.who(a)?.at ?? 0))[0];
      return newest ? (frame) => newest.send(frame) : null;
    });
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const r = roomOf(url.pathname);
    if (!r) return json({ error: "not a room" }, 404);
    if (r.rest === "/socket") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "this is the page's socket" }, 426);
      if (!fromPage(req)) return json({ error: "only this site's page may hold the room" }, 403);
      return this.sockets.upgrade({ at: Date.now() }).response;
    }
    if (r.rest === "/picture") return pictureHttp(req, this.pictures, this.uploads);
    if (r.rest === "/world") return this.saved.http(req);
    if (r.rest === "/made") return this.saved.http(req, true);
    return this.relay.http(req, r.rest, linksFor(url.origin, r.room));
  }
  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const f = this.sockets.frame(ws, raw);
    if (f) this.relay.heard(f.value);
  }
  webSocketClose(ws: RoomSocket) { ws.close(1000, "bye"); }
}
