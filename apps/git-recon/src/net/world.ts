// The world: one battle room, shaped like a Durable Object. On the desktop the Rusty Buns host
// runs it in-process for whoever clicked "Host a battle", and guests on the LAN reach it over
// ws:// with the join passphrase; the host vouches X-User-Id and X-User-Name for each. The host
// player sends the setup (level, mode, repo, and a lat/long level's ground); everyone who joins
// gets it in their welcome and builds the same map. Then the room runs at SNAP_HZ: step the
// battle, send each player their snapshot, a binary delta against the last one their inputs
// acked. The vouched uid only keys the player here; snapshots carry soldier ids and names.
//
// The same class can be a Durable Object per (level, repo) online; that needs a Worker in front
// to vouch for players, and pricing before it goes live.

import { cleanSetup, Room } from "./room.ts";
import { encodeSnap, SNAP_HZ, type FromWorld, type Look } from "./wire.ts";

// Provided by workerd and by the Rusty Buns host.
declare const WebSocketPair: { new (): Record<0 | 1, unknown> };

/** Inputs come in at about 30 a second; past this many a second, they're dropped. */
const MSG_RATE = 90, MSG_BURST = 120;
const MAX_INPUT = 2048, MAX_SETUP = 1_000_000;
/** The same player from another tab or a reconnect: the older socket is closed with this. */
export const CLOSE_REPLACED = 4001;
/** The room is full. */
export const CLOSE_FULL = 4002;

const LOOK = /^[a-z0-9-]{1,24}$/;

interface Who { key: string; name: string; look: Look; host: boolean }

class Bucket {
  private tokens = MSG_BURST;
  constructor(private at: number) {}
  take(now: number): boolean {
    this.tokens = Math.min(MSG_BURST, this.tokens + Math.max(0, now - this.at) * MSG_RATE / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export default class World {
  room: Room | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private rounds = new WeakMap<object, number>();
  private buckets = new WeakMap<object, Bucket>();

  constructor(private ctx: any, private env: any) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const key = request.headers.get("X-User-Id");
    if (!key) return new Response("Unauthenticated", { status: 401 });
    const q = new URL(request.url).searchParams;
    const look: Look = { head: LOOK.test(q.get("head") ?? "") ? q.get("head")! : "ball", build: LOOK.test(q.get("build") ?? "") ? q.get("build")! : "average" };
    const host = request.headers.get("X-RB-Principal") !== "guest";
    // A guest's name comes vouched with its uid; the host's own socket names itself.
    const name = (host ? q.get("name") : null) || request.headers.get("X-User-Name") || "soldier";
    const who: Who = { key, name: name.slice(0, 24), look, host };
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as any[];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(who);
    // One socket per player: a reconnect or second tab replaces the older one (after the new one is in, so its close doesn't take the player out).
    for (const old of this.open()) if (old !== server && this.who(old)?.key === key) try { old.close(CLOSE_REPLACED, "replaced"); } catch {}
    this.enter(server, who);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000 / SNAP_HZ);
    return new Response(null, { status: 101, webSocket: client } as any);
  }

  webSocketMessage(ws: any, raw: string | ArrayBuffer) {
    if (typeof raw !== "string" || raw.length > MAX_SETUP) return;
    const who = this.who(ws), now = Date.now();
    if (!who) return;
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new Bucket(now)));
    if (!b.take(now)) return;
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.t === "in" && raw.length <= MAX_INPUT) this.room?.input(who.key, m.i), this.room?.ack(who.key, m.ack);
    else if (m?.t === "setup" && who.host) {
      // The host picks the battle; a new pick starts it over, with everyone still here.
      const setup = cleanSetup(m.setup);
      if (!setup) return;
      this.room = new Room(setup, this.room?.seq);
      for (const w of this.open()) this.enter(w, this.who(w)!);
    }
  }

  webSocketClose(ws: any) { this.gone(ws); }
  webSocketError(ws: any) { this.gone(ws); }

  /** A socket into the battle, if there is one yet: a welcome, or wait for the host's setup. */
  private enter(ws: any, who: Who) {
    if (!this.room) return this.send(ws, { t: "wait" });
    if (this.room.join(who.key, who.name, who.look) === null) {
      try { ws.close(CLOSE_FULL, "full"); } catch {}
      return;
    }
    this.welcome(ws, who);
  }

  private welcome(ws: any, who: Who) {
    const room = this.room!, me = room.idOf(who.key);
    if (me === undefined) return;
    const snap = room.snap(who.key, { events: [], files: [] }, true);
    if (!snap) return;
    this.rounds.set(ws, room.round);
    this.send(ws, { t: "welcome", setup: room.setup, me, roster: room.rosterNow(), files: room.filesNow(), snap });
  }

  private gone(ws: any) {
    const who = this.who(ws);
    const others = this.open().filter((w) => w !== ws && this.who(w)?.key === who?.key);
    if (who && !others.length) this.room?.leave(who.key);
    if (!this.open().length && this.timer) clearInterval(this.timer), (this.timer = null);
  }

  private tick() {
    const room = this.room;
    if (!room) return;
    room.tick(Date.now());
    const shared = room.drain();
    for (const ws of this.open()) {
      const who = this.who(ws);
      if (!who) continue;
      if (this.rounds.get(ws) !== room.round) {
        if (room.idOf(who.key) !== undefined) this.welcome(ws, who);
        continue;
      }
      const snap = room.snap(who.key, shared);
      if (snap) try { ws.send(encodeSnap(snap)); } catch {}
    }
  }

  private who(ws: any): Who | undefined { return ws.deserializeAttachment() as Who | undefined; }

  private open(): any[] {
    // getWebSockets can still list a closing socket; count open ones only.
    return this.ctx.getWebSockets().filter((w: any) => w.readyState === undefined || w.readyState === 1);
  }

  private send(ws: any, m: FromWorld) {
    try { ws.send(JSON.stringify(m)); } catch {}
  }
}
