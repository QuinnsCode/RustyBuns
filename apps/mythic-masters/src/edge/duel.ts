// One Durable Object per fight with friends (net/duel.ts): a duel seats two, a co-op room (`kind=coop` on the first
// join, #4400) two to four against a wild one. The first to come is seat 0. It holds each one's pick until everyone
// seated has picked (two at least), then starts a round, with a seed for the wild one, and relays each seat's inputs to
// the rest. A co-op room opened at a den or a keeper (#4413) fights what lives there: seat 0 says which with its pick,
// and the room believes it only when the world's seed could put that creature there at that level (dens.ts `holds`). It never plays the fight: every page does, from the same inputs. What it does decide: who sits (no more
// than the chairs), that inputs come in order and only for the round under way, and whether the pages' hashes agree.
//
// Like the Region: no storage, no timer. A seat's pick, round and last hashes ride on its socket's attachment, so the
// room can hibernate between rounds (a fight's 60 messages a second keep it awake while one plays, ~100 s at most).
// The Worker (worker.ts) decides identity and vouches X-User-Id and X-User-Name.
import { refuseSocket, Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { holds } from "../net/dens.ts";
import { BATCH, parseDuelIn, SEATS, SUM_EVERY, type DenFoe, type DuelOut, type Pick, type RoomKind } from "../net/duel.ts";
import { publicId } from "./region.ts";

/** 60 ticks a second, sent a frame at a time (a 120 Hz screen sends twice as often), with room to catch up after a stall. */
export const DUEL_LIMITS = { maxBytes: 1024, rate: 150, burst: 300 };
export const CLOSE_FULL = 4003;
export const CLOSE_REPLACED = 4001;

/** A seat: who, which chair in which kind of room, their pick for the next round (with the den's creature, from a co-op
 *  room's host), the round they're in and the next input tick the room expects from them, and their last few fight hashes by tick. */
interface Seat { id: string; name: string; kind: RoomKind; seat: number; pick: Pick | null; foe?: DenFoe; r: number; next: number; sums: [number, number][] }

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
  /** The others' sockets with their seats: everyone in the room but `me`. */
  private others(me: Seat): [RoomSocket, Seat][] {
    return this.sockets.open().flatMap((ws) => { const s = this.sockets.who(ws); return s && s.id !== me.id ? [[ws, s] as [RoomSocket, Seat]] : []; });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 400 });
    const uid = request.headers.get("X-User-Id");
    if (!uid) return new Response("Unauthenticated", { status: 401 });
    const id = await publicId(uid), name = (request.headers.get("X-User-Name") || "A friend").slice(0, 40);
    const here = this.seats(), back = here.find((s) => s.id === id);
    // The room is what its first player opened; a later link can't turn a duel into a co-op room or back.
    const kind: RoomKind = here[0]?.kind ?? (new URL(request.url).searchParams.get("kind") === "coop" ? "coop" : "duel");
    const taken = new Set(here.filter((s) => s.id !== id).map((s) => s.seat));
    if (!back && taken.size >= SEATS[kind]) return refuseSocket(JSON.stringify({ error: "full" }), CLOSE_FULL, "full");
    let seat = back?.seat ?? 0;
    while (!back && taken.has(seat)) seat++;
    // Back from a drop or another tab: the round it was in is lost (its inputs went nowhere), so it picks again.
    const { server, response } = this.sockets.upgrade({ id, name, kind, seat, pick: null, r: 0, next: 1, sums: [] });
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    this.tellSeats();
    return response;
  }

  /** Everyone's view of the chairs: who sits where and who has picked. */
  private tellSeats(gone?: RoomSocket) {
    const all = this.seats(gone), chairs = SEATS[all[0]?.kind ?? "duel"];
    const names: (string | null)[] = Array(chairs).fill(null), picked: boolean[] = Array(chairs).fill(false);
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
    const others = this.others(me);
    if (ev.e === "pick") {
      // Only a co-op room's foe, and only one the den could hold: anything else fights the seeded wild one.
      const foe = me.kind === "coop" && ev.foe && holds(ev.foe.den, ev.foe.c, ev.foe.lv) ? ev.foe : undefined;
      const mine: Seat = { ...me, pick: { c: ev.c, lv: ev.lv }, foe };
      this.sockets.attach(ws, mine);
      if (!others.length || others.some(([, o]) => !o.pick)) { this.tellSeats(); return; }
      // Everyone in: a new round, one past the last any of them played, its picks in seat order.
      const all = [[ws, mine] as [RoomSocket, Seat], ...others].sort((a, b) => a[1].seat - b[1].seat);
      const r = Math.max(...all.map(([, o]) => o.r)) + 1, picks = all.map(([, o]) => o.pick!), against = all[0]![1].foe;
      for (const [w, o] of all) this.sockets.attach(w, { ...o, seat: all.findIndex(([, x]) => x.id === o.id), pick: null, r, next: 1, sums: [] });
      this.tellSeats();
      this.sockets.broadcast({ t: "go", r, picks, seed: 1 + Math.floor(Math.random() * (2 ** 31 - 2)), ...(against && { foe: against }) });
      return;
    }
    const playing = others.filter(([, o]) => o.r === me.r);
    if (ev.r !== me.r || !playing.length) return; // a round that's over, or nobody to tell
    if (ev.e === "in") {
      // In order, no gaps and no replays: the friend's page plays exactly one input per tick.
      if (ev.i.length > BATCH) return;
      // A gap is a batch this room dropped (over the rate): ask for it again, once per batch that shows the gap.
      if (ev.n > me.next) { this.sockets.send(ws, { t: "from", r: ev.r, n: me.next }); return; }
      // Overlapping a resend: only the ticks not relayed yet.
      const fresh = ev.i.slice(me.next - ev.n);
      if (!fresh.length) return;
      this.sockets.attach(ws, { ...me, next: me.next + fresh.length });
      for (const [w] of playing) this.sockets.send(w, { t: "in", s: me.seat, r: ev.r, n: me.next, i: fresh });
      return;
    }
    if (ev.n % SUM_EVERY) return;
    if (playing.some(([, o]) => o.sums.some(([n, h]) => n === ev.n && h !== ev.h))) { this.sockets.broadcast({ t: "desync", r: ev.r, n: ev.n }); return; }
    const kept: [number, number] = [ev.n, ev.h];
    this.sockets.attach(ws, { ...me, sums: [...me.sums, kept].slice(-4) });
  }

  webSocketClose(ws: RoomSocket) { this.tellSeats(ws); }
  webSocketError(ws: RoomSocket) { this.tellSeats(ws); }
}
