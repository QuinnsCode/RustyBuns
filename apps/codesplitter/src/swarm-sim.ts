// The swarm, simulated (swarm.html): agents as dots, trying to get their work home through the old git way, then
// through codeSplitter's layers one at a time. Each layer is a switch, so the page can show what each one fixes:
//
//   coord   Durable Objects: the repo is a small computer on Cloudflare's network every agent talks to live, so the
//           lane into main is wide instead of one PR at a time.
//   mervin  the attendant filling seats on the bullet train: settles most conflicts by line id, benches the few that
//           need a call (a card), and sends a whole train of PRs at once.
//   ester   stacks trains into test stations: a station tests a car of PRs in one run, a flaky or already-red check
//           reruns quietly, and only a PR's own red goes back to its agent.
//
// With every switch off it is the old git way: one lane, a merge wall (a conflict sends the agent back to rebase and
// queue again) and a test wall (any red sends it back to fix what it may not have broken, and queue again).
// Deterministic for a seed; no DOM, so tests read it and the build ships it to the page as swarm-sim.js.
import { clamp, mulberry32 } from "@rustybuns/util";

export interface Layers { coord: boolean; mervin: boolean; ester: boolean }
export interface Knobs {
  /** How many agents are working at once. */
  agents: number;
  /** 0..1: how often two features touch the same shared file (the README's feature list). */
  overlap: number;
  /** 0..1: how often a check goes red. */
  flaky: number;
}
export const OLD: Layers = { coord: false, mervin: false, ester: false };
export const ALL: Layers = { coord: true, mervin: true, ester: true };

export type Stage = "work" | "queue" | "gate" | "platform" | "bench" | "train" | "testq" | "station" | "home";
/** A moment worth drawing on a dot: why it bounced, or what a layer did for it. */
export type Flash = "conflict" | "red" | "settled" | "card" | "rerun" | "landed";

export interface Dot {
  id: number;
  stage: Stage;
  /** When the current stage ends (work, gate, bench, home). */
  until: number;
  /** Main's length when the agent last pulled: everything landed after it is what it can't see. */
  base: number;
  files: number[];
  /** When it started waiting (queue onwards): how frustrated it is. */
  since: number;
  /** Redoing work it bounced on: "merge" (rebasing) or "test" (chasing a red check). */
  redo: "merge" | "test" | null;
  bounces: number;
  train?: number;
  station?: number;
  flash?: { kind: Flash; at: number };
}
export interface Train { id: number; departs: number; arrives: number; riders: number[] }
export interface Station { busyUntil: number; riders: number[] }

export interface Stats {
  landed: number;
  bounces: { merge: number; test: number };
  /** Conflicts Mervin settled by line id, and the ones he benched as a card. */
  settled: number;
  cards: number;
  /** Red checks Ester sent round again instead of back to an agent. */
  reruns: number;
  /** Agent minutes spent rebasing and chasing red checks instead of building. */
  wasted: number;
  trains: number;
}

/** The README is file 0: every feature might add its line there. */
export const README = 0;
const FILES = 14;
const WORK = [18, 36], REBASE = 10, FIX = 12, HOME = 5;
const LANES = { one: 1, wide: 8 }, PASS = { one: 2, wide: 0.5 };
const DEPART = 3, RIDE = 2.5, SEATS = 24, SETTLE = 0.87, CARD = 5;
const STATIONS = 4, BATCH = { one: 1, stacked: 8 }, TEST = 6, OWN_RED = 0.35;
/** Simulated minutes per sub-step. */
const SUB = 0.25;

export class Sim {
  t = 0;
  dots: Dot[] = [];
  queue: number[] = [];
  platform: number[] = [];
  testq: number[] = [];
  trains: Train[] = [];
  stations: Station[] = Array.from({ length: STATIONS }, () => ({ busyUntil: 0, riders: [] }));
  /** Each landing's files, in order: main's history. */
  main: number[][] = [];
  /** When each PR landed, for the rate. */
  landings: number[] = [];
  stats: Stats = { landed: 0, bounces: { merge: 0, test: 0 }, settled: 0, cards: 0, reruns: 0, wasted: 0, trains: 0 };
  private rng: () => number;
  private next = 0;
  private nextTrain = 0;
  private trainId = 0;

  constructor(public layers: Layers, public knobs: Knobs, seed = 7) {
    this.rng = mulberry32(seed);
    this.setAgents(knobs.agents);
  }

  setAgents(n: number) {
    this.knobs.agents = clamp(Math.round(n), 1, 400);
    while (this.dots.length < this.knobs.agents) {
      const d: Dot = { id: this.next++, stage: "work", until: 0, base: 0, files: [], since: 0, redo: null, bounces: 0 };
      this.task(d);
      d.until = this.t + this.rng() * WORK[1]!; // staggered, so they don't all finish at once
      this.dots.push(d);
    }
    this.retire();
  }

  /** Fewer agents: the ones at their desks or home go first; the rest leave once they get there. */
  private retire() {
    for (let i = this.dots.length - 1; i >= 0 && this.dots.length > this.knobs.agents; i--) {
      const s = this.dots[i]!.stage;
      if (s === "work" || s === "home") this.dots.splice(i, 1);
    }
  }

  /** Flip layers mid-run. Without Mervin, whoever he was holding goes on: the seated and riding to the tests, the benched back in line. */
  setLayers(layers: Layers) {
    if (this.layers.mervin && !layers.mervin) {
      for (const d of this.dots) {
        if (d.stage === "platform" || d.stage === "train") { d.stage = "testq"; d.train = undefined; this.testq.push(d.id); }
        else if (d.stage === "bench") { d.stage = "queue"; this.queue.push(d.id); }
      }
      this.platform = []; this.trains = [];
    }
    this.layers = { ...layers };
  }

  private get = (id: number) => this.dots.find((d) => d.id === id);
  private flash(d: Dot, kind: Flash) { d.flash = { kind, at: this.t }; }

  /** A new feature: pull main, pick the files it will touch. */
  private task(d: Dot) {
    const files = [1 + Math.floor(this.rng() * (FILES - 1))];
    if (this.rng() < this.knobs.overlap) files.push(README);
    if (this.rng() < this.knobs.overlap * 0.5) files.push(1 + Math.floor(this.rng() * 4));
    Object.assign(d, { stage: "work", base: this.main.length, files: [...new Set(files)], redo: null, until: this.t + WORK[0]! + this.rng() * (WORK[1]! - WORK[0]!) });
  }

  /** Something landed since it pulled touches a file it touched. */
  conflicts(d: Dot) {
    for (let i = d.base; i < this.main.length; i++) if (this.main[i]!.some((f) => d.files.includes(f))) return true;
    return false;
  }

  private bounce(d: Dot, why: "merge" | "test") {
    const cost = why === "merge" ? REBASE : FIX;
    this.stats.bounces[why]++; this.stats.wasted += cost; d.bounces++;
    this.flash(d, why === "merge" ? "conflict" : "red");
    // It pulls again while it redoes the work, so it's fresh when it queues; it just lost the time.
    Object.assign(d, { stage: "work", until: this.t + cost, base: this.main.length, redo: why, train: undefined, station: undefined });
  }

  private land(d: Dot) {
    this.main.push(d.files); this.landings.push(this.t); this.stats.landed++;
    this.flash(d, "landed");
    Object.assign(d, { stage: "home", until: this.t + HOME, train: undefined, station: undefined });
  }

  /** Mervin takes a PR onto the platform: a conflict is settled by line id, or benched as a card. */
  private toPlatform(d: Dot) {
    if (this.conflicts(d)) {
      if (this.rng() < SETTLE) { this.stats.settled++; this.flash(d, "settled"); d.base = this.main.length; }
      else { this.stats.cards++; this.flash(d, "card"); d.stage = "bench"; d.until = this.t + CARD; d.base = this.main.length; return; }
    }
    d.stage = "platform"; this.platform.push(d.id);
  }

  /** Move `minutes` of simulated time on. */
  step(minutes: number) {
    for (let left = minutes; left > 1e-9; left -= SUB) this.tick(Math.min(SUB, left));
  }

  private tick(h: number) {
    this.t += h;
    const { coord, mervin, ester } = this.layers, t = this.t;
    for (const d of this.dots) {
      if (d.stage === "work" && t >= d.until) { d.stage = "queue"; d.since = t; this.queue.push(d.id); }
      else if (d.stage === "home" && t >= d.until) this.task(d);
      else if (d.stage === "bench" && t >= d.until) { d.stage = "platform"; this.platform.push(d.id); }
    }
    this.retire();

    // The lane into main: one PR at a time the old way, wide on a Durable Object.
    const lanes = coord ? LANES.wide : LANES.one, pass = coord ? PASS.wide : PASS.one;
    for (const d of this.dots) {
      if (d.stage !== "gate" || t < d.until) continue;
      if (mervin) this.toPlatform(d);
      else if (this.conflicts(d)) this.bounce(d, "merge");
      else { d.stage = "testq"; this.testq.push(d.id); }
    }
    let busy = this.dots.filter((d) => d.stage === "gate").length;
    while (busy < lanes && this.queue.length) {
      const d = this.get(this.queue.shift()!);
      if (!d) continue;
      d.stage = "gate"; d.until = t + pass; busy++;
    }

    // Mervin sends a train when one is due and anyone is seated.
    if (mervin && t >= this.nextTrain && this.platform.length) {
      const riders = this.platform.splice(0, SEATS).filter((id) => this.get(id));
      const train = { id: this.trainId++, departs: t, arrives: t + RIDE, riders };
      for (const id of riders) { const d = this.get(id)!; d.stage = "train"; d.train = train.id; }
      this.trains.push(train); this.stats.trains++; this.nextTrain = t + DEPART;
    }
    for (const tr of this.trains.filter((x) => t >= x.arrives)) {
      for (const id of tr.riders) { const d = this.get(id); if (d?.stage === "train") { d.stage = "testq"; d.train = undefined; this.testq.push(id); } }
    }
    this.trains = this.trains.filter((x) => t < x.arrives);

    // The stations: a PR at a time the old way, a stacked car at a time with Ester.
    this.stations.forEach((s, k) => {
      if (s.riders.length && t >= s.busyUntil) {
        const reruns: number[] = [];
        for (const id of s.riders) {
          const d = this.get(id);
          if (!d || d.stage !== "station") continue;
          if (this.rng() >= this.knobs.flaky) this.land(d);
          else if (ester && this.rng() >= OWN_RED) { this.stats.reruns++; this.flash(d, "rerun"); reruns.push(id); }
          else this.bounce(d, "test");
        }
        for (const id of reruns) { const d = this.get(id)!; d.stage = "testq"; d.station = undefined; }
        this.testq.unshift(...reruns);
        s.riders = [];
      }
      if (!s.riders.length && this.testq.length) {
        s.riders = this.testq.splice(0, ester ? BATCH.stacked : BATCH.one).filter((id) => this.get(id));
        for (const id of s.riders) { const d = this.get(id)!; d.stage = "station"; d.station = k; }
        s.busyUntil = t + TEST;
      }
    });
  }

  /** PRs landed in the last simulated hour. */
  perHour() { return this.landings.filter((x) => x > this.t - 60).length; }
  /** Dots waiting on something other than their own work. */
  waiting() { return this.dots.filter((d) => d.stage !== "work" && d.stage !== "home").length; }
  /** 0..1: how long a waiting dot has waited, against an hour. */
  frustration(d: Dot) { return d.stage === "work" || d.stage === "home" ? 0 : clamp((this.t - d.since) / 60, 0, 1); }
}
