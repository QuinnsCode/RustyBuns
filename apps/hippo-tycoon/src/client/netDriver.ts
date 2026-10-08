// The network half of the Driver seam. Snapshots arrive at 15 Hz; the frame
// it hands the renderer is two of them, blended, about 100 ms behind the
// server, so motion is smooth without guessing. Your own chomp is animated the
// moment you press (Renderer.predictGulp); the server still decides what was eaten.
import type { Cfg, Snapshot } from "../engine/match.ts";
import { TICK_MS } from "../engine/tickLoop.ts";
import { decodeSnapshot, roomCfg, type ServerMsg } from "../engine/wire.ts";
import { DEFAULT_CFG } from "../engine/match.ts";
import { SEAT_NAMES, SEATS } from "../sim/rules.ts";
import type { Event } from "../sim/types.ts";
import type { Command, Driver, Frame, SeatView } from "./driver.ts";
import { NetSocket, type NetState } from "./net.ts";

const DELAY_TICKS = 3;          // render this far behind the newest snapshot
const KEEP = 40;

const blank = (): Snapshot => ({
  tick: 0, round: 0, phase: "lobby", countdown: 0, left: 0, events: [], drops: [], slicks: [],
  hippos: Array.from({ length: SEATS }, (_, seat) => ({ seat, slide: 0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: 0, bellow: 0 })),
});

export class NetDriver implements Driver {
  readonly kind = "net";
  private sock: NetSocket;
  private buf: { at: number; snap: Snapshot }[] = [];
  /** local time minus tick time, kept as the minimum seen: the earliest-arrival estimate */
  private offset = Infinity;
  private offsetWindow: number[] = [];
  private events: Event[] = [];
  private seats: SeatView[] = Array.from({ length: SEATS }, (_, i) => ({ name: SEAT_NAMES[i]!, human: false, ready: false, mine: false }));
  private cfg: Cfg = DEFAULT_CFG;
  private host = 0;
  private you = -1;
  private roomSeq = 0;
  private roomPhase: Snapshot["phase"] = "lobby";
  private state: NetState = "connecting";
  private message: string | undefined;
  private ping: number | undefined;
  private room = "";
  private held = { move: 0 };

  constructor(open: () => WebSocket) {
    this.sock = new NetSocket(open, {
      onMessage: (m) => this.onMessage(m),
      onState: (s, msg) => { this.state = s; this.message = msg; if (s !== "online") this.you = -1; },
      onPing: (ms) => { this.ping = Math.round(ms); },
      onOpen: () => { this.held.move = 0; },
    });
  }

  private onMessage(m: ServerMsg) {
    if (m.t === "hello") { this.you = m.you; this.room = m.room; return; }
    if (m.t === "room") {
      if (m.seq <= this.roomSeq) return;          // a late, older control frame
      this.roomSeq = m.seq; this.roomPhase = m.ph; this.cfg = roomCfg(m); this.host = m.host;
      this.seats = m.seats.map((s, i) => ({ name: s.n, human: s.h === 1, ready: s.r === 1, mine: i === this.you }));
      return;
    }
    if (m.t !== "snap") return;
    const snap = decodeSnapshot(m), now = performance.now();
    const last = this.buf[this.buf.length - 1];
    if (last && snap.round !== last.snap.round) { this.buf = []; this.offsetWindow = []; this.offset = Infinity; }   // a new round restarts the tick count
    else if (last && snap.tick < last.snap.tick) return;                       // older than what we have
    this.events.push(...snap.events);
    // the tick holds still through the lobby and countdown: the newest frame wins, it is not a new moment
    if (last && snap.tick === last.snap.tick && snap.round === last.snap.round) { this.buf[this.buf.length - 1] = { at: now, snap }; return; }
    this.offsetWindow.push(now - snap.tick * TICK_MS);
    if (this.offsetWindow.length > 45) this.offsetWindow.shift();
    this.offset = Math.min(...this.offsetWindow);
    this.buf.push({ at: now, snap });
    if (this.buf.length > KEEP) this.buf.shift();
  }

  advance(_dtMs: number): Frame {
    const now = performance.now();
    const buf = this.buf;
    let prev: Snapshot, cur: Snapshot, alpha = 1;
    if (buf.length === 0) prev = cur = blank();
    else if (buf.length === 1) prev = cur = buf[0]!.snap;
    else {
      const renderTick = (now - this.offset) / TICK_MS - DELAY_TICKS;
      let i = buf.length - 1;
      while (i > 0 && buf[i - 1]!.snap.tick >= renderTick) i--;
      if (i === 0 && buf[0]!.snap.tick > renderTick) { prev = cur = buf[0]!.snap; }
      else if (i >= buf.length - 1 && buf[buf.length - 1]!.snap.tick <= renderTick) { prev = cur = buf[buf.length - 1]!.snap; }
      else {
        prev = buf[Math.max(0, i - 1)]!.snap; cur = buf[i]!.snap;
        alpha = cur.tick === prev.tick ? 1 : Math.max(0, Math.min(1, (renderTick - prev.tick) / (cur.tick - prev.tick)));
      }
    }
    const latest = buf.length ? buf[buf.length - 1]!.snap : null;
    const events = this.events; this.events = [];
    return {
      phase: this.roomPhase === "lobby" || !latest ? this.roomPhase : latest.phase,
      prev, cur, alpha,
      seats: this.seats.map((s, i) => ({ ...s, mine: i === this.you })),
      mine: this.you >= 0 ? [this.you] : [],
      cfg: this.cfg, hostSeat: this.host, events,
      net: { state: this.state, message: this.message, code: this.room, ping: this.ping },
    };
  }

  mine() { return this.you >= 0 ? [this.you] : []; }

  input(seat: number, move: number, gulp: boolean, bellow: boolean) {
    if (seat !== this.you) return;
    const m = Math.round(Math.max(-1, Math.min(1, move)) * 100);
    if (m !== this.held.move || gulp || bellow) {
      this.held.move = m;
      this.sock.send({ t: "in", m, g: gulp ? 1 : 0, h: bellow ? 1 : 0 });
    }
  }

  command(c: Command) {
    switch (c.t) {
      case "start": this.sock.send({ t: "start" }); break;
      case "rematch": this.sock.send({ t: "rematch" }); break;
      case "lobby": this.sock.send({ t: "lobby" }); break;
      case "seat": this.sock.send({ t: "seat", n: c.seat }); break;
      case "cfg": this.sock.send({ t: "cfg", secs: c.cfg.secs, diff: c.cfg.difficulty }); break;
    }
  }

  dispose() { this.sock.close(); }
}
