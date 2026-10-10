// The seam. The renderer and UI only ever see a Frame; they never learn
// whether it came from a local Match or from a server's snapshots.
import { Match, type Cfg, type Phase, type Snapshot } from "../engine/match.ts";
import { TICK_HZ, type Difficulty } from "../sim/rules.ts";
import { compileSim, instantiateSim } from "../sim/native.ts";
import type { Event } from "../sim/types.ts";

export interface SeatView { name: string; human: boolean; ready: boolean; mine: boolean }

export interface Frame {
  phase: Phase;
  /** Two snapshots to blend between: `prev` -> `cur` by `alpha`. */
  prev: Snapshot;
  cur: Snapshot;
  alpha: number;
  seats: SeatView[];
  /** Seats this machine controls. */
  mine: number[];
  cfg: Cfg;
  hostSeat: number;
  /** Events not yet delivered to a previous frame. */
  events: Event[];
  /** Net-only: connection state and room facts. */
  net?: {
    state: "connecting" | "online" | "offline" | "refused"; message?: string; code?: string; ping?: number;
    /** In the room with no seat: watching. */
    watching?: boolean;
    /** How many are watching. */
    watchers?: number;
  };
}

export type Command =
  | { t: "start" } | { t: "rematch" } | { t: "lobby" }
  | { t: "cfg"; cfg: Partial<Cfg> } | { t: "seat"; seat: number }
  | { t: "bot"; seat: number; difficulty: Difficulty };

export interface Driver {
  readonly kind: "local" | "net";
  advance(dtMs: number): Frame;
  /** Seats this machine controls right now (cheap; does not consume events). */
  mine(): number[];
  /** The latest control for a seat. Move holds; gulp and bellow are presses. */
  input(seat: number, move: number, gulp: boolean, bellow: boolean): void;
  command(c: Command): void;
  dispose(): void;
  /** Local only: which engine steps the rules and the bots ("rust" once the wasm has loaded). */
  readonly simEngine?: "rust" | "ts";
}

export interface LocalSeat { name: string; human: boolean }

const TICK_MS = 1000 / TICK_HZ;

/**
 * The Rust twin of the rules and the bots, compiled from public/hippo_sim.wasm,
 * or null: not built, not a browser, or `?sim=ts`. The round stays inside the
 * module (Match.setEngine), so it is the faster engine (bench/sim.ts).
 */
export function loadSim(url = "/hippo_sim.wasm"): Promise<WebAssembly.Module | null> {
  return (compiled ??= fetchSim(url));
}
let compiled: Promise<WebAssembly.Module | null> | undefined;
async function fetchSim(url: string): Promise<WebAssembly.Module | null> {
  if (typeof location === "undefined" || typeof fetch === "undefined" || new URLSearchParams(location.search).get("sim") === "ts") return null;
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("wasm")) return null;
    return await compileSim(await r.arrayBuffer());
  } catch { return null; }
}

/** Solo and couch: the same Match a server runs, stepped right here. */
export class LocalDriver implements Driver {
  readonly kind = "local";
  readonly match: Match;
  private acc = 0;
  private prev: Snapshot;
  private cur: Snapshot;
  private events: Event[] = [];
  private mine_: number[] = [];
  simEngine: "rust" | "ts" = "ts";

  constructor(seats: LocalSeat[], cfg: Partial<Cfg>, seed: number) {
    this.match = new Match(seed, cfg);
    // same results either way, so swapping engines mid-round is safe
    void loadSim().then((mod) => { if (mod) { this.match.setEngine(instantiateSim(mod)); this.simEngine = "rust"; } }).catch(() => {});   // else TypeScript stays
    seats.forEach((s, i) => { if (s.human) { this.match.join(`local:${i}`, s.name, i); this.mine_.push(i); } });
    this.match.start();
    this.prev = this.cur = this.match.snapshot();
  }

  advance(dtMs: number): Frame {
    this.acc += Math.min(dtMs, 250);
    while (this.acc >= TICK_MS) {
      this.match.tick();
      this.prev = this.cur;
      this.cur = this.match.snapshot();
      this.events.push(...this.cur.events);
      this.acc -= TICK_MS;
    }
    const events = this.events; this.events = [];
    const m = this.match;
    return {
      phase: m.phase, prev: this.prev, cur: this.cur, alpha: this.acc / TICK_MS,
      seats: m.seats.map((s, i) => ({ name: s.name, human: s.uid !== null, ready: s.ready, mine: this.mine_.includes(i) })),
      mine: this.mine_, cfg: m.cfg, hostSeat: m.hostSeat(), events,
    };
  }

  mine() { return this.mine_; }

  input(seat: number, move: number, gulp: boolean, bellow: boolean) { this.match.input(seat, move, gulp, bellow); }

  command(c: Command) {
    if (c.t === "rematch") this.match.start();
    else if (c.t === "cfg") this.match.setCfg(c.cfg);
    else if (c.t === "bot") this.match.setCfg({ bots: this.match.cfg.bots.map((d, i) => (i === c.seat ? c.difficulty : d)) });
  }

  dispose() {}
}
