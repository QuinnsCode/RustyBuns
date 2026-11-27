// Agent Galaxy on Cloudflare: one Durable Object for the whole map (`idFromName("galaxy")`). It keeps the plots in its
// storage and the players' sockets (hibernating, each player's spot on its socket's attachment); the logic is
// ../galaxy.ts, which the dev server runs in memory too. A plot's picture and saved world are the plot's own Room's
// (GET /api/r/<room>/picture, /world): the Galaxy looks the room up and asks it.
import { Seats } from "@rustybuns/util/seats";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { Galaxy as Plots, type FromGalaxy, type Hub, joined, type Kv, left, walked, type Walker } from "../galaxy.ts";

interface Stub { fetch(r: Request): Promise<Response> }
interface Env { ROOM: { idFromName(name: string): unknown; get(id: unknown): Stub } }

// A position is a few dozen bytes; a page sends at most 10 a second.
const LIMITS = { maxBytes: 256, rate: 12, burst: 24 };

export class Galaxy {
  private plots: Plots;
  private sockets: Seats<Walker, FromGalaxy>;
  private hub: Hub<RoomSocket>;
  constructor(ctx: RoomCtx & { storage: Kv }, private env: Env) {
    this.plots = new Plots(ctx.storage);
    this.sockets = new Seats(ctx, LIMITS);
    this.hub = {
      list: () => this.sockets.open().flatMap((s) => { const p = this.sockets.who(s); return p ? [{ s, p }] : []; }),
      save: (s, p) => this.sockets.attach(s, p),
      send: (s, m) => this.sockets.send(s, m),
    };
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const rest = url.pathname.replace(/^\/api\/galaxy/, "");
    if (rest === "/socket") {
      const p = await this.plots.seat(req);
      if (p instanceof Response) return p;
      // One socket per room: another tab of the same room takes the character over.
      const { server, response } = this.sockets.take(p);
      joined(this.hub, server, p);
      return response;
    }
    return this.plots.http(req, rest, (room, path) =>
      this.env.ROOM.get(this.env.ROOM.idFromName(room)).fetch(new Request(`${url.origin}/api/r/${room}${path}`)));
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const f = this.sockets.frame(ws, raw);
    if (f) walked(this.hub, ws, f.value);
  }

  webSocketClose(ws: RoomSocket) {
    const p = this.sockets.who(ws);
    if (this.sockets.leave(ws) && p) left(this.hub, ws, p);
    try { ws.close(1000, "bye"); } catch { /* closed */ }
  }
}
