// The page's side of a rig split across threads (ring.ts, #4948). Settings go to the audio thread and to every
// worker, numbered. While the audio thread is over budget for a third of a second, the chain is cut at the slot
// boundaries that share its work out best (`planCuts`, by each link's `Rig.work`) and the later parts move to
// workers; a new chain (another amp, pedal or board, or Eco) starts back on one thread and is measured again.
import { cutPoints, planCuts } from "@rustybuns/gear/circuit";
import { rigSpec } from "./live.ts";
import { BLOCK, Ring } from "./ring.ts";
import type { ScopeAt } from "@rustybuns/gear/circuit";
import type { AmpSettings, FromAmp, ToAmp, ToPart } from "./messages.ts";

/** Over this share of a thread's time, it can't keep up for long: split. */
export const BUDGET = 0.9;
/** What each part should come to after a split. */
const TARGET = 0.6;
/** Threads at most: two hops, two blocks of latency. */
export const MAX_PARTS = 3;
/** Reports (30 a second) over budget before a split. */
const OVER_REPORTS = 10;

/** How many threads for `load` on one: enough that each gets about `TARGET`, at most `MAX_PARTS`. */
export const partsFor = (load: number) => Math.min(MAX_PARTS, Math.max(1, Math.ceil(load / TARGET)));

/** What the page shows of the split: where the chain is cut, the latency it adds, and each thread's and slot's load. */
export interface Threads {
  /** Links before which the chain is cut (none: one thread). */
  cuts: number[];
  /** The latency the hops add, ms (a block each). */
  hopMs: number;
  /** Each thread's share of its time budget, the audio thread first. */
  loads: number[];
  /** Each link's share of a thread's budget, in chain order, then the power stage, loop and cab's. */
  slots: number[];
  /** Blocks that came back too late to play. */
  late: number;
  /** Whether this page can split at all (cross-origin isolated, with SharedArrayBuffer). */
  can: boolean;
}

/** Each slot's load: its thread's load times its share of that thread's work. */
export function slotLoads(meters: readonly FromAmp[]): number[] {
  return meters.flatMap((m, p) => {
    const w = m.work ?? [], sum = w.reduce((a, x) => a + x, 0);
    const links = p === meters.length - 1 ? w : w.slice(0, -1); // a part that hands on has no back end
    return links.map((x) => (sum > 0 ? (m.load * x) / sum : 0));
  });
}

export class AmpThreads {
  private v = 0;
  private settings: AmpSettings | null = null;
  private shape = "";
  private cuts: number[] = [];
  private workers: Worker[] = [];
  private meters: FromAmp[] = [];
  private over = 0;
  private scopeAt: ScopeAt | null = null;
  readonly can = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;

  /**
   * `spawn` makes a worker running part-worker.ts; `onMeter` gets the threads' reports as one: every thread's
   * levels in chain order, the busiest thread's load, everyone's misses.
   */
  constructor(private readonly node: AudioWorkletNode, private readonly sampleRate: number, private readonly spawn: () => Worker, private readonly onMeter: (m: FromAmp) => void) {
    node.port.onmessage = (e: MessageEvent<FromAmp>) => this.report(0, e.data);
  }

  /** The front panel (or the patch) changed. A new chain plays on one thread until it's measured. */
  send(settings: AmpSettings): void {
    const shape = `${rigSpec(settings).shape}|${settings.oversample}`;
    this.settings = settings;
    if (shape !== this.shape) { this.shape = shape; this.over = 0; if (this.cuts.length) { this.join(); return; } }
    this.post();
  }

  /** Cut the chain before these links (none: back to one thread). The page splits by itself; this is for the harness. */
  split(cuts: number[]): void {
    if (!cuts.length) { this.join(); return; }
    if (!this.can || !this.settings) return;
    const ok = cutPoints(rigSpec(this.settings).spec);
    if (cuts.some((c) => !ok.includes(c))) return;
    this.stopWorkers();
    const rings = Array.from({ length: cuts.length + 1 }, () => Ring.make().sab);
    this.workers = cuts.map((_, i) => {
      const w = this.spawn();
      w.onmessage = (e: MessageEvent<FromAmp>) => this.report(i + 1, e.data);
      const m: ToPart = { t: "start", rings, index: i + 1, sampleRate: this.sampleRate }, sc: ToPart = { t: "scope", at: this.scopeAt };
      w.postMessage(m);
      w.postMessage(sc);
      return w;
    });
    const r: ToAmp = { t: "rings", rings };
    this.node.port.postMessage(r);
    this.cuts = [...cuts];
    this.meters = [];
    this.post();
  }

  state(): Threads {
    const parts = this.cuts.length + 1, m = this.meters.slice(0, parts);
    return {
      cuts: [...this.cuts], hopMs: (this.cuts.length * BLOCK * 1000) / this.sampleRate, loads: m.map((x) => x?.load ?? 0),
      slots: m.length === parts && m.every(Boolean) ? slotLoads(m) : [], late: this.meters[0]?.late ?? 0, can: this.can,
    };
  }

  /** A scope on a link's net (numbered across the whole rig), or none: whichever thread plays the link reports it. */
  scope(at: ScopeAt | null): void {
    if (JSON.stringify(at) === JSON.stringify(this.scopeAt)) return;
    this.scopeAt = at;
    const m: ToAmp = { t: "scope", at };
    this.node.port.postMessage(m);
    for (const w of this.workers) w.postMessage(m);
  }

  /** Workers stopped, rings dropped. */
  close(): void { this.stopWorkers(); }

  private join(): void {
    this.cuts = [];
    this.post();
    const r: ToAmp = { t: "rings", rings: null };
    this.node.port.postMessage(r);
    this.stopWorkers();
    this.meters = [];
  }

  private stopWorkers(): void {
    const stop: ToPart = { t: "stop" };
    for (const w of this.workers) { w.postMessage(stop); w.onmessage = null; }
    this.workers = [];
  }

  private post(): void {
    if (!this.settings) return;
    const m: ToAmp = { t: "set", settings: this.settings, v: ++this.v, cuts: [...this.cuts] };
    this.node.port.postMessage(m);
    for (const w of this.workers) w.postMessage(m);
  }

  private report(part: number, m: FromAmp): void {
    this.meters[part] = m;
    if (part !== 0) return;
    const parts = this.meters.slice(0, this.cuts.length + 1);
    const merged: FromAmp = {
      ...m,
      levels: parts.flatMap((x) => x?.levels ?? []),
      load: Math.max(...parts.map((x) => x?.load ?? 0)),
      misses: parts.reduce((a, x) => a + (x?.misses ?? 0), 0),
      scope: parts.find((x) => x?.scope)?.scope,
    };
    this.watch(m);
    this.onMeter(merged);
  }

  /** One thread over budget for a third of a second: cut it where the work shares out best. */
  private watch(m: FromAmp): void {
    if (this.cuts.length || !this.can || !this.settings || this.settings.bypass) return;
    this.over = m.load > BUDGET ? this.over + 1 : 0;
    if (this.over < OVER_REPORTS || !m.work?.length) return;
    this.over = 0;
    const cuts = planCuts(m.work, partsFor(m.load), cutPoints(rigSpec(this.settings).spec));
    if (cuts.length) this.split(cuts);
  }
}
