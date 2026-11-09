// One Durable Object per duel: two friends' fight (net/duel.ts). It seats two players (the first to come is seat 0),
// holds each one's pick until both are in, then starts a round and relays inputs from one to the other. It never plays
// the fight: both pages do, from the same inputs. What it does decide: who sits (two, no more), that inputs come in
// order and only for the round under way, and whether the two pages' fight hashes agree.
//
// Like the Region: no storage, no timer. A seat's pick, round and last hashes ride on its socket's attachment, so the
// room can hibernate between rounds (a fight's 60 messages a second keep it awake while one plays, ~100 s at most).
// The Worker (worker.ts) decides identity and vouches X-User-Id and X-User-Name.
import { refuseSocket, Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { BATCH, parseDuelIn, SUM_EVERY, type DuelOut, type Pick } from "../net/duel.ts";
import { publicId } from "./region.ts";

/** 60 ticks a second, sent a frame at a time (a 120 Hz screen sends twice as often), with room to catch up after a stall. */
export const DUEL_LIMITS = { maxBytes: 1024, rate: 150, burst: 300 };
export const CLOSE_FULL = 4003;
export const CLOSE_REPLACED = 4001;

/** A seat: who, which chair, their pick for the next round, the round they're in and the next input tick the room
 *  expects from them, and their last few fight hashes by tick. */
interface Seat { id: string; name: string; seat: 0 | 1; pick: Pick | null; r: number; next: number; sums: [number, number][] }

export class Duel {
  private sockets: Sockets<Seat, DuelOut>;

  constructor(ctx: RoomCtx) { this.sockets = new Sockets(ctx, DUEL_LIMITS); }

  /** Who sits, by id (a player's newer tab stands for them); `gone` is a socket closing now. */
  private seats(gone?: RoomSocket): Seat[] {
    const by = new Map<string, Seat>();
    for (const ws of this.sockets.open()) {
      const s = ws === gone ? null : this.sockets.who(ws);
      if (s) by.set(s.id, s);
    }
    return [...by.values()];
  }
  private socketOf(seat: 0 | 1): RoomSocket | null {
    return this.sockets.open().find((ws) => this.sockets.who(ws)?.seat === seat) ?? null;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid), name = (request.headers.get("X-User-Name") || "A friend").slice(0, 40);
    const here = this.seats(), back = here.find((s) => s.id === id);
    const taken = new Set(here.filter((s) => s.id !== id).map((s) => s.seat));
    if (!back && taken.size >= 2) return refuseSocket(JSON.stringify({ error: "full" }), CLOSE_FULL, "full");
    const seat: 0 | 1 = back?.seat ?? (taken.has(0) ? 1 : 0);
    // Back from a drop or another tab: the round it was in is lost (its inputs went nowhere), so it picks again.
    const { server, response } = this.sockets.upgrade({ id, name, seat, pick: null, r: 0, next: 1, sums: [] });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    this.tellSeats();
    return response;
  }

  /** Everyone's view of the chairs: who sits where and who has picked. */
  private tellSeats(gone?: RoomSocket) {
    const all = this.seats(gone), names: [string | null, string | null] = [null, null], picked: [boolean, boolean] = [false, false];
    for (const s of all) { names[s.seat] = s.name; picked[s.seat] = !!s.pick; }
    for (const ws of this.sockets.open()) {
      const s = ws === gone ? null : this.sockets.who(ws);
      if (s) this.sockets.send(ws, { t: "seats", you: s.seat, names, picked });
    }
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const frame = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    if (!frame || !me) return;
    const ev = parseDuelIn(frame.value);
    if (!ev) return;
    if (ev.e === "echo") { this.sockets.send(ws, { t: "echo", at: ev.at }); return; }
    const otherWs = this.socketOf(me.seat ? 0 : 1), other = otherWs ? this.sockets.who(otherWs) : null;
    if (ev.e === "pick") {
      const mine = { ...me, pick: { c: ev.c, lv: ev.lv } };
      this.sockets.attach(ws, mine);
      if (!other?.pick || !otherWs) { this.tellSeats(); return; }
      // Both in: a new round, one past the last either of them played.
      const r = Math.max(mine.r, other.r) + 1, picks: [Pick, Pick] = me.seat === 0 ? [mine.pick, other.pick] : [other.pick, mine.pick];
      this.sockets.attach(ws, { ...mine, pick: null, r, next: 1, sums: [] });
      this.sockets.attach(otherWs, { ...other, pick: null, r, next: 1, sums: [] });
      this.tellSeats();
      this.sockets.broadcast({ t: "go", r, picks });
      return;
    }
    if (ev.r !== me.r || !otherWs || !other || other.r !== me.r) return; // a round that's over, or nobody to tell
    if (ev.e === "in") {
      // In order, no gaps and no replays: the friend's page plays exactly one input per tick.
      if (ev.i.length > BATCH) return;
      // A gap is a batch this room dropped (over the rate): ask for it again, once per batch that shows the gap.
      if (ev.n > me.next) { this.sockets.send(ws, { t: "from", r: ev.r, n: me.next }); return; }
      // Overlapping a resend: only the ticks not relayed yet.
      const fresh = ev.i.slice(me.next - ev.n);
      if (!fresh.length) return;
      this.sockets.attach(ws, { ...me, next: me.next + fresh.length });
      this.sockets.send(otherWs, { t: "in", r: ev.r, n: me.next, i: fresh });
      return;
    }
    if (ev.n % SUM_EVERY) return;
    const theirs = other.sums.find(([n]) => n === ev.n);
    if (theirs && theirs[1] !== ev.h) { this.sockets.broadcast({ t: "desync", r: ev.r, n: ev.n }); return; }
    const kept: [number, number] = [ev.n, ev.h];
    this.sockets.attach(ws, { ...me, sums: [...me.sums, kept].slice(-4) });
  }

  webSocketClose(ws: RoomSocket) { this.tellSeats(ws); }
  webSocketError(ws: RoomSocket) { this.tellSeats(ws); }
}
