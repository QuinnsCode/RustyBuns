// Agent Page on Cloudflare: the built page as static assets (every /r/<room> is the same page), and one Room Durable
// Object per room that relays agents' calls to the page open in someone's browser (../relay.ts). /api/r/<room>/socket
// is the page's socket; /tools and /mcp are the agents' doors. `bun run deploy`.
import { type RoomCtx, type RoomSocket, Sockets } from "@rustybuns/util/room";
import { json } from "@rustybuns/util/http";
import { linksFor, Relay } from "../relay.ts";
import { ROOM } from "../tools.ts";

interface Stub { fetch(r: Request): Promise<Response> }
interface Env {
  ASSETS: Stub;
  ROOM: { idFromName(name: string): unknown; get(id: unknown): Stub };
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
    if (url.pathname.startsWith("/api/")) {
      const r = roomOf(url.pathname);
      return r ? env.ROOM.get(env.ROOM.idFromName(r.room)).fetch(req) : json({ error: "not a room: /api/r/<room>/tools" }, 404);
    }
    return env.ASSETS.fetch(req);
  },
};

/** One room: its page's sockets (the newest one gets the calls) and the relay between them and the agents. */
export class Room {
  private sockets: Sockets<{ at: number }>;
  private relay: Relay;
  constructor(ctx: RoomCtx) {
    // A page only answers calls: a few frames a second, each at most a page's worth of JSON.
    this.sockets = new Sockets(ctx, { maxBytes: 256_000, rate: 20, burst: 40 });
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
      return this.sockets.upgrade({ at: Date.now() }).response;
    }
    return this.relay.http(req, r.rest, linksFor(url.origin, r.room));
  }
  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const f = this.sockets.frame(ws, raw);
    if (f) this.relay.heard(f.value);
  }
  webSocketClose(ws: RoomSocket) { ws.close(1000, "bye"); }
}
