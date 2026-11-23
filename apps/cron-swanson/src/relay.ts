// The live channel: a Worker and one Durable Object that only fans out. Pages on the laptop and the phone hold a
// socket to it; the Bun server POSTs /publish after a job changes or a run lands, and every page hears
// `{ t: "changed" }` and fetches /api/jobs again. The Bun server stays the clock (DO alarms landed minutes late),
// and nothing is stored here: a woken relay has its hibernated sockets and nothing else to lose.
// Deployed from relay/ (rustybuns.config.ts there); TOKEN is the same secret as the server's CRON_SWANSON_TOKEN.
//   GET  /live      a page's socket; subprotocols `cron-swanson, <ticket>` (the day's ticket /api/jobs hands a signed-in page)
//   POST /publish   the server's nudge; Authorization: Bearer <token>
//   GET  /health    open
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { json } from "@rustybuns/util/http";
import { PROTOCOL, offeredToken, sameToken, ticketOk, type LiveMsg } from "./live.ts";

type Stub = { fetch(r: Request): Promise<Response> };
export type Env = { RELAY: { idFromName(n: string): unknown; get(id: unknown): Stub }; TOKEN?: string };

/** Every page there is in one room: one owner, a handful of devices. */
const ROOM = "all";

/** Pages say nothing; a frame past this is a page misbehaving. */
const LIMITS = { maxBytes: 256, rate: 1, burst: 5 };

export class Relay {
  private sockets: Sockets<null, LiveMsg>;
  constructor(ctx: RoomCtx, _env: unknown) { this.sockets = new Sockets(ctx, LIMITS); }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("upgrade") === "websocket") return this.sockets.upgrade(null).response;
    const msg: LiveMsg = { t: "changed", at: Date.now() };
    this.sockets.broadcast(msg);
    return json({ pages: this.sockets.open().length });
  }

  webSocketMessage(ws: RoomSocket, m: string | ArrayBuffer) { this.sockets.frame(ws, m); }
  webSocketClose(ws: RoomSocket, code: number) { try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ } }
  webSocketError() {}
}

/** The DO's 101 again, answering the subprotocol the page offered: a browser drops a socket whose answer names none. */
function echo(res: Response): Response {
  const webSocket: unknown = Reflect.get(res, "webSocket");
  if (res.status !== 101 || !webSocket) return res;
  const init: ResponseInit & { webSocket: unknown } = { status: 101, webSocket, headers: { "sec-websocket-protocol": PROTOCOL } };
  return new Response(null, init);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (path === "/health") return json({ ok: true });
    const room = () => env.RELAY.get(env.RELAY.idFromName(ROOM));
    const want = env.TOKEN ?? "";
    if (path === "/live") {
      if (req.headers.get("upgrade") !== "websocket") return json({ error: "websocket only" }, 426);
      if (want && !(await ticketOk(offeredToken(req), want))) return json({ error: "ticket needed" }, 401);
      return echo(await room().fetch(req));
    }
    if (path === "/publish" && req.method === "POST") {
      if (want && !sameToken(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", want)) return json({ error: "token needed" }, 401);
      return room().fetch(new Request("https://relay/publish", { method: "POST" }));
    }
    return json({ error: "not found" }, 404);
  },
};
