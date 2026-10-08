// The room: sockets on one side, a Match on the other. Platform-free: it only
// sees the ports. The Durable Object and the desktop world are both a dozen
// lines around this class.
//
// Authority is here. Clients send inputs; the room ticks the Match at 30 Hz
// and broadcasts snapshots at 15 Hz. Identity comes from the shell (the
// `uid` and `name` it vouched), never from a message body. One socket may
// drive several seats (couch players over the network: `hello.k`); the extra
// players are `<uid>+2`, `<uid>+3`... in the Match, a suffix no vouched uid can
// carry. A socket with no seat watches.
//
// Persistence is deliberately small: phase, seats, scores and the round seed,
// written when the phase or the seats change. If the room is evicted mid-round
// it comes back at that round's countdown with scores reset (see Match.restore):
// restarting is simple and honest, and nobody is replaying thirty seconds of
// inputs they never sent. Scores are not written more often on purpose: a
// mid-round score is only meaningful with the drops, positions and bot memory
// it came from, and a fresh countdown on the same seed with old scores bolted
// on would hand someone a head start in a round that is being replayed. Final
// scores are written at the podium (a phase change), which is the only point
// where a score is a result.
//
// The tick loop is a setTimeout loop. A storage alarm is its watchdog: while
// anyone is seated it fires every WATCHDOG_MS and restarts a loop that has
// stopped beating, and on Cloudflare it also wakes an evicted room.
import { SEATS, SEAT_NAMES } from "../sim/rules.ts";
import { Match, type Persisted } from "./match.ts";
import { TokenBucket } from "./limits.ts";
import { realClock, type Clock, type EngineCtx, type EngineSocket } from "./ports.ts";
import { TickLoop } from "./tickLoop.ts";
import {
  CLOSE_FLOOD, CLOSE_FULL, CLOSE_REPLACED, CLOSE_VERSION, PROTO_VERSION, decodeClient, encodeSnapshot,
  type ClientMsg, type RoomSeat, type ServerMsg,
} from "./wire.ts";

/** Survives hibernation. `hello`: said a good hello; `k`: seats asked for; `gone`: closed by us. */
interface Attachment { uid: string; name: string; hello: boolean; k: number; gone?: boolean }
const SNAP_EVERY = 2;          // ticks between snapshots while a round is on (15 Hz)
const LOBBY_SNAP_EVERY = 30;   // and about once a second in the lobby
const STORE_KEY = "room";
/** Messages a second per seat a socket drives, and the burst it may save. The client sends at most ~35. */
export const MSG_RATE = 60, MSG_BURST = 120;
/** Watchers beyond the four seats; past this a hello is refused as full. */
export const MAX_WATCHERS = 8;
export const WATCHDOG_MS = 10_000;
/** A running loop that has not woken for this long is dead. */
export const STALL_MS = 2_000;

export interface RoomOpts {
  clock?: Clock;
  /** Round seed. Persisted; tests pass a fixed one. */
  seed?: number;
  /** Where errors go (the tick loop swallows throws; this is how you hear them). */
  report?: (where: string, err: unknown) => void;
}

const attach = (ws: EngineSocket): Attachment | null => {
  const a = ws.deserializeAttachment() as (Attachment & { seated?: boolean }) | null;
  if (!a || typeof a.uid !== "string") return null;
  return { uid: a.uid, name: a.name, hello: a.hello ?? a.seated ?? false, k: a.k ?? 1, ...(a.gone ? { gone: true } : {}) };   // `seated`: a v1 attachment
};
/** The Match uid and name of a socket's j-th player (0 = the vouched one). */
const uidAt = (a: Attachment, j: number) => (j === 0 ? a.uid : `${a.uid}+${j + 1}`);
const nameAt = (a: Attachment, j: number) => (j === 0 ? a.name : `${a.name.slice(0, 21)} ${j + 1}`);

export class Room {
  readonly match: Match;
  private loop: TickLoop;
  private clock: Clock;
  private seq = 0;
  private lastPhase = "lobby";
  private sinceSnap = 0;
  private roomName = "";
  /** In memory only: a woken room starts every socket with a full bucket. */
  private buckets = new WeakMap<EngineSocket, TokenBucket>();

  constructor(private ctx: EngineCtx, private opts: RoomOpts = {}) {
    this.clock = opts.clock ?? realClock;
    this.match = new Match(opts.seed ?? (this.clock.now() & 0x7fffffff));
    this.loop = new TickLoop(this.clock, {
      step: () => this.onTick(),
      wakeEnd: () => {},
      fail: (err) => opts.report?.("tick", err),
    });
  }

  // ---- lifecycle ---------------------------------------------------------
  /** Load what survived and put the players still connected back in the seats they held. */
  async restore() {
    const saved = await this.ctx.storage.get<Persisted>(STORE_KEY);
    if (saved) this.match.restore(saved);
    this.lastPhase = this.match.phase;
    const held = new Set(saved?.seats.map((s) => s.uid) ?? []);
    for (const ws of this.ctx.getWebSockets()) {
      const a = attach(ws);
      if (!a?.hello || a.gone) continue;
      for (let j = 0; j < a.k; j++) if (held.has(uidAt(a, j))) this.match.join(uidAt(a, j), nameAt(a, j));   // watchers stay watchers
    }
    if (this.match.humans() > 0) this.run();
  }

  /** The shell accepted `ws` with this vouched identity. The seat is taken at `hello`. */
  onConnect(ws: EngineSocket, uid: string, name: string, room = "") {
    this.roomName = room || this.roomName;
    ws.serializeAttachment({ uid, name, hello: false, k: 1 } satisfies Attachment);
  }

  webSocketMessage(ws: EngineSocket, raw: string | ArrayBuffer) {
    const a = attach(ws);
    if (!a || a.gone) return;
    if (!this.allow(ws, a)) return this.flood(ws, a);
    const m = decodeClient(raw);
    if (!m) return;
    if (m.t === "hello") return this.hello(ws, a, m.v, m.k ?? 1);
    if (!a.hello) return;                // nothing counts before a good hello
    if (m.t === "ping") return this.send(ws, { t: "pong", n: m.n });
    const mine = this.seatsOf(a);
    switch (m.t) {
      case "in": {
        const seat = m.s ?? mine[0];
        if (seat === undefined || !mine.includes(seat)) return;
        const before = this.match.seats[seat]!.ready;
        this.match.input(seat, m.m / 100, m.g === 1, m.h === 1);
        if (this.match.seats[seat]!.ready !== before) this.sendRoom();
        break;
      }
      case "seat": this.sit(a, mine, m.n, m.s); break;
      default: if (mine.includes(this.match.hostSeat())) this.command(m);   // only the first human steers the room
    }
  }

  webSocketClose(ws: EngineSocket) { this.drop(ws); }
  webSocketError(ws: EngineSocket) { this.drop(ws); }

  /** The watchdog. Revives a dead tick loop while anyone is seated, then sets the next alarm. */
  alarm() {
    const live = this.match.humans() > 0 && this.ctx.getWebSockets().some((ws) => attach(ws)?.hello);
    if (!live) return;                   // nobody to tick for: let the alarms lapse
    if (!this.loop.active || this.clock.now() - this.loop.lastBeat > STALL_MS) {
      this.opts.report?.("watchdog", new Error(`tick loop ${this.loop.active ? "stalled" : "stopped"} with players seated; restarted`));
      this.loop.stop();
      this.loop.start();
    }
    this.armWatchdog();
  }

  // ---- internals ---------------------------------------------------------
  /** Seats this socket drives, in its players' order. */
  private seatsOf(a: Attachment): number[] {
    const out: number[] = [];
    for (let j = 0; j < a.k; j++) { const s = this.match.seatOf(uidAt(a, j)); if (s >= 0) out.push(s); }
    return out;
  }

  private watchers(except?: EngineSocket): number {
    return this.ctx.getWebSockets().filter((ws) => { const a = ws !== except && attach(ws); return a && a.hello && !a.gone && this.seatsOf(a).length === 0; }).length;
  }

  private allow(ws: EngineSocket, a: Attachment): boolean {
    const now = this.clock.now(), k = Math.max(1, a.k);
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new TokenBucket(MSG_RATE * k, MSG_BURST * k, now)));
    return b.take(now, MSG_RATE * k, MSG_BURST * k);
  }

  /** Too many messages: free the seats and close. Nothing more from this socket counts. */
  private flood(ws: EngineSocket, a: Attachment) {
    this.opts.report?.("flood", new Error(`closed ${a.uid}: over ${MSG_RATE * a.k} messages a second`));
    this.send(ws, { t: "err", msg: "Too many messages. Disconnected." });
    this.drop(ws);
    try { ws.serializeAttachment({ ...a, hello: false, gone: true } satisfies Attachment); } catch { /* already closing */ }
    ws.close(CLOSE_FLOOD, "flood");
  }

  private hello(ws: EngineSocket, a: Attachment, v: number, k: number) {
    if (v !== PROTO_VERSION) {
      this.send(ws, { t: "err", msg: `This room speaks protocol ${PROTO_VERSION}, your game speaks ${v}. Update the app.` });
      ws.close(CLOSE_VERSION, "version mismatch");
      return;
    }
    // one socket per player: a second tab of the same uid replaces the first
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && attach(other)?.uid === a.uid) {
        this.send(other, { t: "err", msg: "You joined from somewhere else." });
        other.serializeAttachment({ ...attach(other)!, hello: false });
        other.close(CLOSE_REPLACED, "replaced");
      }
    }
    const mt = this.match, me = { ...a, hello: true, k };
    for (let j = k; j < SEATS; j++) mt.leave(uidAt(me, j));                      // came back with fewer players
    for (let j = 0; j < k; j++) mt.join(uidAt(me, j), nameAt(me, j));
    const mine = this.seatsOf(me);
    if (mine.length === 0 && this.watchers(ws) >= MAX_WATCHERS) {
      this.send(ws, { t: "err", msg: "This room is full, even the gallery." });
      ws.close(CLOSE_FULL, "full");
      return;
    }
    ws.serializeAttachment(me satisfies Attachment);
    this.send(ws, { t: "hello", v: PROTO_VERSION, seq: ++this.seq, you: mine[0] ?? -1, room: this.roomName });
    this.sendRoom();
    if (mine.length) { this.persist(); this.run(); }
  }

  /**
   * "Sit here" on a bot's seat. A player of this socket without a seat (a
   * watcher, or a couch partner who did not fit) takes it at any time;
   * otherwise one of its seats (`from`, or its first) moves there, in the lobby only.
   */
  private sit(a: Attachment, mine: number[], to: number, from?: number) {
    const mt = this.match;
    if (mt.seats[to]!.uid !== null) return;
    const j = from === undefined ? [...Array(a.k).keys()].find((j) => mt.seatOf(uidAt(a, j)) < 0) : undefined;
    if (j !== undefined) {
      if (mt.join(uidAt(a, j), nameAt(a, j), to) < 0) return;
      this.afterChange();
      this.run();
      return;
    }
    const f = from ?? mine[0];
    if (f !== undefined && mine.includes(f) && mt.moveSeat(mt.seats[f]!.uid!, to)) this.afterChange();
  }

  private command(m: ClientMsg) {
    const mt = this.match;
    if (m.t === "start" && mt.phase === "lobby") mt.start();
    else if (m.t === "rematch" && mt.phase === "podium") mt.start();
    else if (m.t === "lobby" && mt.phase === "podium") mt.toLobby();
    else if (m.t === "cfg" && m.n !== undefined) mt.setCfg({ bots: mt.cfg.bots.map((d, i) => (i === m.n ? m.diff! : d)) });
    else if (m.t === "cfg") mt.setCfg({ ...(m.secs !== undefined ? { secs: m.secs } : {}), ...(m.diff !== undefined ? { difficulty: m.diff } : {}) });
    else return;
    this.afterChange();
  }

  private drop(ws: EngineSocket) {
    const a = attach(ws);
    if (!a?.hello) return;
    try { ws.serializeAttachment({ ...a, hello: false } satisfies Attachment); } catch { /* a closed socket */ }
    // a replaced or duplicate socket for the same uid must not free the seats
    if (this.ctx.getWebSockets().some((o) => o !== ws && attach(o)?.uid === a.uid && attach(o)!.hello)) return;
    let left = false;
    for (let j = 0; j < SEATS; j++) if (this.match.leave(uidAt(a, j)) >= 0) left = true;
    if (left) this.afterChange(); else this.sendRoom();          // a watcher left: the count changed
    if (this.match.humans() === 0) this.loop.stop();
  }

  private afterChange() {
    this.lastPhase = this.match.phase;
    this.sendRoom();
    this.persist();
  }

  /** Start ticking if not already, with the watchdog behind it. */
  private run() {
    if (this.loop.active) return;
    this.loop.start();
    this.armWatchdog();
  }

  private armWatchdog() {
    const s = this.ctx.storage;
    if (!s.setAlarm) return;
    try { void s.setAlarm(this.clock.now() + WATCHDOG_MS).catch((err) => this.opts.report?.("alarm", err)); }
    catch (err) { this.opts.report?.("alarm", err); }
  }

  private onTick() {
    const m = this.match;
    m.tick();
    if (m.phase !== this.lastPhase) { this.lastPhase = m.phase; this.sendRoom(); this.persist(); this.sinceSnap = SNAP_EVERY; }
    if (++this.sinceSnap >= (m.phase === "lobby" ? LOBBY_SNAP_EVERY : SNAP_EVERY)) {
      this.sinceSnap = 0;
      this.broadcast(encodeSnapshot(m.snapshot()));
    }
  }

  /** The room frame is everyone's but for `you`, the seats that socket drives. */
  private sendRoom() {
    const m = this.match;
    const seats: RoomSeat[] = m.seats.map((s, i) => ({ n: s.uid === null ? SEAT_NAMES[i]! : s.name, h: s.uid === null ? 0 : 1, r: s.ready ? 1 : 0 }));
    const frame = { t: "room" as const, seq: ++this.seq, ph: m.phase, seats, secs: m.cfg.secs, diff: m.cfg.difficulty, bd: [...m.cfg.bots], host: m.hostSeat(), sp: this.watchers() };
    for (const ws of this.ctx.getWebSockets()) {
      const a = attach(ws);
      this.send(ws, { ...frame, you: a?.hello ? this.seatsOf(a) : [] });
    }
  }

  private persist() {
    try { void this.ctx.storage.put(STORE_KEY, this.match.persisted()); } catch (err) { this.opts.report?.("persist", err); }
  }

  private send(ws: EngineSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch { /* a closing socket */ } }
  private broadcast(m: ServerMsg) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) try { ws.send(s); } catch { /* a closing socket */ }
  }
}
