// One match: seats, the lobby -> countdown -> playing -> podium machine, bot
// fill and takeover, and the sim. No sockets, no clocks, no DOM. LocalDriver
// (solo and couch) and Room (LAN and online) both wrap this, so a match plays
// the same wherever it runs.
import { bot, newBotMem, type BotMem } from "../sim/bots.ts";
import { seedOf } from "../sim/rng.ts";
import { COUNTDOWN_TICKS, DEFAULT_ROUND_SECS, PERSONALITIES, SEATS, SEAT_NAMES, type Difficulty } from "../sim/rules.ts";
import type { StepFn } from "../sim/native.ts";
import { newState, step } from "../sim/step.ts";
import { NO_INPUT, type Event, type Hippo, type Input, type State } from "../sim/types.ts";

export type Phase = "lobby" | "countdown" | "playing" | "podium";
export interface Cfg {
  secs: number;
  /** The last "all bots" choice. Setting it sets every seat's bot. */
  difficulty: Difficulty;
  /** Per seat: how the bot plays when one drives that seat. */
  bots: Difficulty[];
}
export const DEFAULT_CFG: Readonly<Cfg> = Object.freeze({ secs: DEFAULT_ROUND_SECS, difficulty: "normal", bots: Object.freeze(Array<Difficulty>(SEATS).fill("normal")) as Difficulty[] });

/** Merge a partial config; a `difficulty` without `bots` sets every seat's bot. */
export function mergeCfg(base: Cfg, c: Partial<Cfg>): Cfg {
  const difficulty = c.difficulty ?? base.difficulty;
  const bots = Array.from({ length: SEATS }, (_, i) => c.bots?.[i] ?? (c.difficulty !== undefined ? c.difficulty : base.bots[i] ?? difficulty));
  return { secs: c.secs ?? base.secs, difficulty, bots };
}

export interface Seat {
  /** null = a bot drives. */
  uid: string | null;
  name: string;
  ready: boolean;
}

export interface DropView { id: number; kind: number; x: number; y: number }
export interface SlickView { id: number; x: number; y: number; life: number }
/** Everything a renderer needs for one moment. Local and networked play produce the same thing. */
export interface Snapshot {
  tick: number;
  /** Which round this is; ticks restart from 0 each round. */
  round: number;
  phase: Phase;
  /** Ticks of countdown left. */
  countdown: number;
  /** Ticks of the round left. */
  left: number;
  hippos: Hippo[];
  drops: DropView[];
  slicks: SlickView[];
  events: Event[];
}

export interface Persisted {
  phase: Phase; cfg: Cfg; round: number; baseSeed: number;
  seats: { uid: string | null; name: string }[];
  scores: number[];
  /** Per seat: the human who last left it, so they get it back. */
  away?: (string | null)[];
}

/** A latched control: move holds, gulp and bellow are edges consumed by one tick. */
interface Latch { move: number; gulp: boolean; bellow: boolean }

const mixSeed = (base: number, round: number) => (Math.imul(base ^ 0x5bd1e995, 0x2545f491) + Math.imul(round + 1, 0x9e3779b1)) >>> 0;

export class Match {
  phase: Phase = "lobby";
  cfg: Cfg;
  seats: Seat[];
  round = 0;
  sim: State;
  /** The rules engine: TypeScript step(), or the Rust twin's drop-in (src/sim/native.ts). Same results either way. */
  stepper: StepFn = step;
  private countdown = 0;
  private latch: Latch[] = Array.from({ length: SEATS }, () => ({ move: 0, gulp: false, bellow: false }));
  private mem: BotMem[] = [];
  private botRng: { rng: number }[] = [];
  private pending: Event[] = [];
  /** Per seat: the uid of the human who last left it. Their seat to come back to while a bot holds it. */
  private away: (string | null)[] = Array(SEATS).fill(null);

  constructor(public baseSeed: number, cfg: Partial<Cfg> = {}) {
    this.cfg = mergeCfg(DEFAULT_CFG, cfg);
    this.seats = Array.from({ length: SEATS }, (_, i) => ({ uid: null, name: SEAT_NAMES[i]!, ready: false }));
    this.sim = newState(mixSeed(baseSeed, 0), this.cfg.secs);
    this.resetBots();
  }

  // ---- seats -------------------------------------------------------------
  seatOf(uid: string): number { return this.seats.findIndex((s) => s.uid === uid); }
  humans(): number { return this.seats.filter((s) => s.uid !== null).length; }
  /** The first human in seat order owns the room's settings and Start. */
  hostSeat(): number { return this.seats.findIndex((s) => s.uid !== null); }

  /**
   * Take a seat (a bot's, at any time): `prefer` if free; else, for a human
   * coming back, the seat they left if a bot still holds it; else the first
   * free seat nobody is coming back to, then any free seat. -1 if full.
   */
  join(uid: string, name: string, prefer?: number): number {
    const have = this.seatOf(uid);
    if (have >= 0) { this.seats[have]!.name = name; return have; }
    const free = (i: number) => this.seats[i]!.uid === null;
    const back = this.away.indexOf(uid);
    const seat = prefer !== undefined && prefer >= 0 && prefer < SEATS && free(prefer) ? prefer
      : back >= 0 && free(back) ? back
      : [...this.seats.keys()].find((i) => free(i) && this.away[i] === null) ?? this.seats.findIndex((_, i) => free(i));
    if (seat < 0) return -1;
    this.claim(seat, uid);
    this.seats[seat] = { uid, name, ready: false };
    this.mem[seat] = newBotMem();
    this.latch[seat] = { move: 0, gulp: false, bellow: false };
    return seat;
  }

  /** Hand the seat back to a bot; the hippo keeps its net worth. */
  leave(uid: string): number {
    const seat = this.seatOf(uid);
    if (seat < 0) return -1;
    this.claim(-1, uid);
    this.away[seat] = uid;
    this.seats[seat] = { uid: null, name: SEAT_NAMES[seat]!, ready: false };
    this.mem[seat] = newBotMem();
    this.latch[seat] = { move: 0, gulp: false, bellow: false };
    if (this.humans() === 0 && this.phase !== "lobby") this.toLobby();
    return seat;
  }

  /** Lobby only: move a human to another seat if a bot holds it. */
  moveSeat(uid: string, to: number): boolean {
    const from = this.seatOf(uid);
    if (this.phase !== "lobby" || from < 0 || to < 0 || to >= SEATS || this.seats[to]!.uid !== null) return false;
    this.claim(to, uid);
    this.seats[to] = { ...this.seats[from]!, ready: false };
    this.seats[from] = { uid: null, name: SEAT_NAMES[from]!, ready: false };
    return true;
  }

  /** Who is coming back to which seat (null = nobody). */
  awayFrom(): readonly (string | null)[] { return this.away; }

  /** `uid` holds `seat` now (or no seat, -1): forget their old seat, and whoever was coming back to this one. */
  private claim(seat: number, uid: string) {
    this.away = this.away.map((u, i) => (u === uid || i === seat ? null : u));
  }

  setCfg(c: Partial<Cfg>) {
    if (this.phase !== "lobby") return;
    this.cfg = mergeCfg(this.cfg, c);
    this.sim = newState(mixSeed(this.baseSeed, this.round), this.cfg.secs);
  }

  // ---- input -------------------------------------------------------------
  /** Latch a seat's control. Move holds until changed; gulp and bellow are one-shot edges. */
  input(seat: number, move: number, gulp: boolean, bellow: boolean) {
    const l = this.latch[seat];
    if (!l) return;
    l.move = Number.isFinite(move) ? Math.max(-1, Math.min(1, move)) : 0;
    if (gulp) l.gulp = true;
    if (bellow) {
      l.bellow = true;
      if (this.phase === "lobby" && this.seats[seat]!.uid !== null) this.seats[seat]!.ready = !this.seats[seat]!.ready;
    }
  }

  // ---- phases ------------------------------------------------------------
  /** Everyone human is ready: go. Needs at least one human. */
  allReady(): boolean {
    const h = this.seats.filter((s) => s.uid !== null);
    return h.length > 0 && h.every((s) => s.ready);
  }

  start(): boolean {
    if (this.phase !== "lobby" && this.phase !== "podium") return false;
    if (this.phase === "podium") this.round++;
    this.sim = newState(mixSeed(this.baseSeed, this.round), this.cfg.secs);
    this.resetBots();
    for (const s of this.seats) s.ready = false;
    this.countdown = COUNTDOWN_TICKS;
    this.phase = "countdown";
    return true;
  }

  toLobby() {
    this.phase = "lobby";
    this.round++;
    for (const s of this.seats) s.ready = false;
    this.sim = newState(mixSeed(this.baseSeed, this.round), this.cfg.secs);
    this.resetBots();
  }

  /** One 30 Hz tick. */
  tick(): Event[] {
    let evs: Event[] = [];
    if (this.phase === "lobby" && this.allReady()) this.start();
    if (this.phase === "countdown") {
      if (--this.countdown <= 0) this.phase = "playing";
    } else if (this.phase === "playing") {
      const inputs: Input[] = [];
      for (let i = 0; i < SEATS; i++) {
        const l = this.latch[i]!;
        if (this.seats[i]!.uid === null) inputs.push(bot(this.sim, i, PERSONALITIES[this.cfg.bots[i] ?? this.cfg.difficulty], this.mem[i]!, this.botRng[i]!));
        else inputs.push({ move: l.move, gulp: l.gulp, bellow: l.bellow });
      }
      evs = this.stepper(this.sim, inputs);
      if (this.sim.over) this.phase = "podium";
    } else {
      // lobby/countdown/podium bellows still roar
      for (let i = 0; i < SEATS; i++) if (this.latch[i]!.bellow) evs.push({ t: "bellow", seat: i });
    }
    for (const l of this.latch) { l.gulp = false; l.bellow = false; }
    this.pending.push(...evs);
    return evs;
  }

  // ---- views and persistence ---------------------------------------------
  snapshot(): Snapshot {
    const s = this.sim;
    const events = this.pending; this.pending = [];
    return {
      tick: s.tick, round: this.round, phase: this.phase, countdown: this.countdown, left: s.roundTicks - s.tick,
      hippos: s.hippos.map((h) => ({ ...h })),
      drops: s.drops.map((d) => ({ id: d.id, kind: d.kind, x: d.x, y: d.y })),
      slicks: s.slicks.map((k) => ({ id: k.id, x: k.x, y: k.y, life: k.life })),
      events,
    };
  }

  /** Richest first; ties share the rank. */
  standings(): { seat: number; score: number; rank: number }[] {
    const rows = this.sim.hippos.map((h) => ({ seat: h.seat, score: h.score })).sort((a, b) => b.score - a.score || a.seat - b.seat);
    return rows.map((r) => ({ ...r, rank: rows.findIndex((x) => x.score === r.score) + 1 }));
  }

  persisted(): Persisted {
    return { phase: this.phase, cfg: this.cfg, round: this.round, baseSeed: this.baseSeed,
      seats: this.seats.map((s) => ({ uid: s.uid, name: s.name })), scores: this.sim.hippos.map((h) => h.score), away: [...this.away] };
  }

  /**
   * Restore after an eviction. The sim is not replayed: a round that was
   * running starts over from its countdown (same seed, scores reset); a
   * lobby or podium comes back as it was. Seats are reclaimed by the room
   * from live sockets, so a human who is gone becomes a bot; every human who
   * held a seat is owed it back (see join).
   */
  restore(p: Persisted) {
    this.baseSeed = p.baseSeed; this.cfg = mergeCfg(mergeCfg(DEFAULT_CFG, { difficulty: p.cfg?.difficulty }), { secs: p.cfg?.secs, bots: p.cfg?.bots }); this.round = p.round;
    this.away = Array.from({ length: SEATS }, (_, i) => p.seats[i]?.uid ?? p.away?.[i] ?? null);
    this.sim = newState(mixSeed(p.baseSeed, p.round), this.cfg.secs);
    this.resetBots();
    if (p.phase === "podium") { this.phase = "podium"; p.scores.forEach((sc, i) => { this.sim.hippos[i]!.score = sc; }); this.sim.over = true; }
    else if (p.phase === "lobby") this.phase = "lobby";
    else { this.phase = "countdown"; this.countdown = COUNTDOWN_TICKS; }
  }

  private resetBots() {
    this.mem = this.seats.map(() => newBotMem());
    this.botRng = this.seats.map((_, i) => ({ rng: seedOf(mixSeed(this.baseSeed, this.round) + i + 1) }));
  }
}

export { NO_INPUT };
