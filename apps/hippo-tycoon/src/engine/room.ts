// The room: sockets on one side, a Match on the other. Platform-free: it only
// sees the ports. The Durable Object and the desktop world are both a dozen
// lines around this class.
//
// Authority is here. Clients send inputs; the room ticks the Match at 30 Hz
// and broadcasts snapshots at 15 Hz. Identity comes from the shell (the
// `uid` and `name` it vouched), never from a message body.
//
// Persistence is deliberately small: phase, seats, scores and the round seed,
// written when the phase or the seats change. If the room is evicted mid-round
// it comes back at that round's countdown with scores reset (see Match.restore):
// restarting is simple and honest, and nobody is replaying thirty seconds of
// inputs they never sent.
import { SEAT_NAMES } from "../sim/rules.ts";
import { Match, type Persisted } from "./match.ts";
import { realClock, type Clock, type EngineCtx, type EngineSocket } from "./ports.ts";
import { TickLoop } from "./tickLoop.ts";
import {
  CLOSE_FULL, CLOSE_REPLACED, CLOSE_VERSION, PROTO_VERSION, decodeClient, encodeSnapshot,
  type ClientMsg, type RoomSeat, type ServerMsg,
} from "./wire.ts";

interface Attachment { uid: string; name: string; seated: boolean }
const SNAP_EVERY = 2;          // ticks between snapshots while a round is on (15 Hz)
const LOBBY_SNAP_EVERY = 30;   // and about once a second in the lobby
const STORE_KEY = "room";

export interface RoomOpts {
  clock?: Clock;
  /** Round seed. Persisted; tests pass a fixed one. */
  seed?: number;
  /** Where errors go (the tick loop swallows throws; this is how you hear them). */
  report?: (where: string, err: unknown) => void;
}

const attach = (ws: EngineSocket): Attachment | null => {
  const a = ws.deserializeAttachment() as Attachment | null;
  return a && typeof a.uid === "string" ? a : null;
};

export class Room {
  readonly match: Match;
  private loop: TickLoop;
  private clock: Clock;
  private seq = 0;
  private lastPhase = "lobby";
  private sinceSnap = 0;
  private roomName = "";

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
  /** Load what survived and reseat the sockets that are still connected. */
  async restore() {
    const saved = await this.ctx.storage.get<Persisted>(STORE_KEY);
    if (saved) this.match.restore(saved);
    this.lastPhase = this.match.phase;
    for (const ws of this.ctx.getWebSockets()) {
      const a = attach(ws);
      if (a?.seated) this.match.join(a.uid, a.name);
    }
    if (this.match.humans() > 0) this.loop.start();
  }

  /** The shell accepted `ws` with this vouched identity. The seat is taken at `hello`. */
  onConnect(ws: EngineSocket, uid: string, name: string, room = "") {
    this.roomName = room || this.roomName;
    ws.serializeAttachment({ uid, name, seated: false } satisfies Attachment);
  }

  webSocketMessage(ws: EngineSocket, raw: string | ArrayBuffer) {
    const a = attach(ws);
    if (!a) return;
    const m = decodeClient(raw);
    if (!m) return;
    if (m.t === "hello") return this.hello(ws, a, m.v);
    if (!a.seated) return;               // nothing counts before a good hello
    const seat = this.match.seatOf(a.uid);
    if (seat < 0) return;
    switch (m.t) {
      case "in": {
        const before = this.match.seats[seat]!.ready;
        this.match.input(seat, m.m / 100, m.g === 1, m.h === 1);
        if (this.match.seats[seat]!.ready !== before) this.sendRoom();
        break;
      }
      case "ping": this.send(ws, { t: "pong", n: m.n }); break;
      default: this.command(seat, m);
    }
  }

  webSocketClose(ws: EngineSocket) { this.drop(ws); }
  webSocketError(ws: EngineSocket) { this.drop(ws); }
  alarm() {}

  // ---- internals ---------------------------------------------------------
  private hello(ws: EngineSocket, a: Attachment, v: number) {
    if (v !== PROTO_VERSION) {
      this.send(ws, { t: "err", msg: `This room speaks protocol ${PROTO_VERSION}, your game speaks ${v}. Update the app.` });
      ws.close(CLOSE_VERSION, "version mismatch");
      return;
    }
    // one seat per player: a second tab of the same uid replaces the first
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && attach(other)?.uid === a.uid) {
        this.send(other, { t: "err", msg: "You joined from somewhere else." });
        other.serializeAttachment({ ...attach(other)!, seated: false });
        other.close(CLOSE_REPLACED, "replaced");
      }
    }
    const seat = this.match.join(a.uid, a.name);
    if (seat < 0) {
      this.send(ws, { t: "err", msg: "This room is full." });
      ws.close(CLOSE_FULL, "full");
      return;
    }
    ws.serializeAttachment({ ...a, seated: true } satisfies Attachment);
    this.send(ws, { t: "hello", v: PROTO_VERSION, seq: ++this.seq, you: seat, room: this.roomName });
    this.sendRoom();
    this.persist();
    this.loop.start();
  }

  private command(seat: number, m: ClientMsg) {
    const mt = this.match, host = seat === mt.hostSeat();
    if (m.t === "seat") { if (mt.moveSeat(mt.seats[seat]!.uid!, m.n)) this.afterChange(); return; }
    if (!host) return;                   // only the first human steers the room
    if (m.t === "start" && mt.phase === "lobby") mt.start();
    else if (m.t === "rematch" && mt.phase === "podium") mt.start();
    else if (m.t === "lobby" && mt.phase === "podium") mt.toLobby();
    else if (m.t === "cfg") mt.setCfg({ ...(m.secs !== undefined ? { secs: m.secs } : {}), ...(m.diff !== undefined ? { difficulty: m.diff } : {}) });
    else return;
    this.afterChange();
  }

  private drop(ws: EngineSocket) {
    const a = attach(ws);
    if (!a?.seated) return;
    // a replaced or duplicate socket for the same uid must not free the seat
    if (this.ctx.getWebSockets().some((o) => o !== ws && attach(o)?.uid === a.uid && attach(o)!.seated)) return;
    if (this.match.leave(a.uid) < 0) return;
    this.afterChange();
    if (this.match.humans() === 0) this.loop.stop();
  }

  private afterChange() {
    this.lastPhase = this.match.phase;
    this.sendRoom();
    this.persist();
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

  private roomFrame(): ServerMsg {
    const m = this.match;
    const seats: RoomSeat[] = m.seats.map((s, i) => ({ n: s.uid === null ? SEAT_NAMES[i]! : s.name, h: s.uid === null ? 0 : 1, r: s.ready ? 1 : 0 }));
    return { t: "room", seq: ++this.seq, ph: m.phase, seats, secs: m.cfg.secs, diff: m.cfg.difficulty, host: m.hostSeat() };
  }
  private sendRoom() { this.broadcast(this.roomFrame()); }

  private persist() {
    try { void this.ctx.storage.put(STORE_KEY, this.match.persisted()); } catch (err) { this.opts.report?.("persist", err); }
  }

  private send(ws: EngineSocket, m: ServerMsg) { try { ws.send(JSON.stringify(m)); } catch { /* a closing socket */ } }
  private broadcast(m: ServerMsg) {
    const s = JSON.stringify(m);
    for (const ws of this.ctx.getWebSockets()) try { ws.send(s); } catch { /* a closing socket */ }
  }
}
