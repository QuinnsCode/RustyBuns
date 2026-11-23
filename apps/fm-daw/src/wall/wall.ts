// The sound wall at work (WALL.md): the modules in the case, the patch cables between their jacks, and the room's
// gear cabled between a mixer's send and its return, run a sample at a time. Each module reads its inputs (a cable's
// other end, else the input its jack is normalled to, else 0 V) and writes its outputs; modules run in cable order, so
// a cable carries this sample, and one that loops back (feedback) carries the last. A mixer's send goes out to its
// gear a block at a time (Q Amp's rig, at line level), so its return comes back a block (2.7 ms at 48 kHz) later.
// What the wall plays into the room is every Q Out's line out. Pure, no DOM: the gear room's audio thread runs it
// (src/room/wall-worklet.ts), and the tests render it straight.
import { RigReturn } from "../mixer.ts";
import type { AmpSettings } from "../amp/messages.ts";
import { panel } from "../../circuits/wall-panels.ts";
import { makeSim, type Sim } from "./sims.ts";

/** One module in the case: its id in the patch, its kind (a panel's id) and its knobs, 0 to 1. */
export interface WallModule { id: string; kind: string; knobs: Record<string, number> }
/** A patch cable, an output jack to an input jack: [module id, jack name]. */
export interface WallCable { from: [string, string]; to: [string, string] }
/** The room's gear cabled between a mixer's send and return (Q Amp's rig settings for it). */
export interface WallReturn { mixer: string; aux: "a" | "b"; settings: AmpSettings }
export interface WallSpec { modules: WallModule[]; cables: WallCable[]; returns: WallReturn[] }

/** Modular level to line level and back, either side of a send's gear: 5 V is a hot 1 V line. */
export const LINE = 0.2;

type Source = { t: "out"; node: number; out: number } | { t: "normal"; input: number } | { t: "ret"; ret: number } | null;
interface Node { id: string; kind: string; sim: Sim; x: Float64Array; y: Float64Array; from: Source[] }
interface Ret { mixer: number; send: number; rig: RigReturn; aux: "a" | "b"; out: Float32Array; back: Float32Array; wet: Float32Array; key: string }

export class Wall {
  private nodes: Node[] = [];
  private rets: Ret[] = [];
  /** Each Q Out's out-l and out-r, by node. */
  private outs: [number, number, number][] = [];
  constructor(readonly sampleRate: number) {}

  /** The wall as the room has it now. A module that stays keeps its sound (its oscillator's phase, its filter's charge). */
  set(spec: WallSpec): void {
    const had = new Map(this.nodes.map((n) => [n.id, n]));
    const nodes = spec.modules.map((m): Node => {
      const old = had.get(m.id);
      if (old && old.kind === m.kind) { old.sim.knobs(m.knobs); return { ...old, from: [] }; }
      const sim = makeSim(m.kind, this.sampleRate, m.knobs);
      return { id: m.id, kind: m.kind, sim, x: new Float64Array(sim.ins.length), y: new Float64Array(sim.outs.length), from: [] };
    });
    const at = new Map(nodes.map((n, i) => [n.id, i]));
    // Returns: the mixer's send out to the rig, back into its return.
    const hadRets = new Map(this.rets.map((r) => [`${this.nodes[r.mixer]?.id}:${r.aux}`, r]));
    this.rets = spec.returns.flatMap((r): Ret[] => {
      const mixer = at.get(r.mixer), node = mixer === undefined ? undefined : nodes[mixer];
      if (mixer === undefined || !node || node.kind !== "mix") return [];
      const key = JSON.stringify(r.settings), old = hadRets.get(`${r.mixer}:${r.aux}`);
      const rig = old?.rig ?? new RigReturn(this.sampleRate, r.settings);
      if (old && old.key !== key) rig.set(r.settings);
      return [{ mixer, send: node.sim.outs.indexOf(`send-${r.aux}`), rig, aux: r.aux, out: new Float32Array(128), back: old?.back ?? new Float32Array(128), wet: new Float32Array(256), key }];
    });
    for (const n of nodes) {
      const p = panel(n.kind);
      n.from = n.sim.ins.map((jack): Source => {
        const c = spec.cables.find((x) => x.to[0] === n.id && x.to[1] === jack);
        const src = c && at.get(c.from[0]);
        if (c && src !== undefined) { const out = nodes[src].sim.outs.indexOf(c.from[1]); if (out >= 0) return { t: "out", node: src, out }; }
        const ret = this.rets.findIndex((r) => nodes[r.mixer] === n && jack === `ret-${r.aux}`);
        if (ret >= 0) return { t: "ret", ret };
        const normal = p.jacks.find((j) => j.name === jack)?.normal;
        return normal ? { t: "normal", input: n.sim.ins.indexOf(normal) } : null;
      });
    }
    // Cable order: a module after the ones that feed it (a loop keeps whatever order it is drawn in).
    const order: number[] = [], seen = new Set<number>(), busy = new Set<number>();
    const visit = (i: number) => {
      if (seen.has(i) || busy.has(i)) return;
      busy.add(i);
      for (const s of nodes[i].from) if (s?.t === "out") visit(s.node);
      busy.delete(i); seen.add(i); order.push(i);
    };
    nodes.forEach((_, i) => visit(i));
    const remap = new Map(order.map((old, i) => [old, i]));
    this.nodes = order.map((i) => nodes[i]);
    for (const n of this.nodes) n.from = n.from.map((s) => (s?.t === "out" ? { ...s, node: remap.get(s.node) ?? s.node } : s));
    for (const r of this.rets) r.mixer = remap.get(r.mixer) ?? r.mixer;
    for (const n of this.nodes) n.sim.plugged?.(n.from.map((x) => x?.t === "out" || x?.t === "ret"));
    this.outs = this.nodes.flatMap((n, i) => (n.kind === "out" ? [[i, n.sim.outs.indexOf("out-l"), n.sim.outs.indexOf("out-r")] as [number, number, number]] : []));
  }

  /** `frames` samples of the room's left and right (line level: 1 V is 1.0). */
  process(left: Float32Array, right: Float32Array, frames: number): void {
    for (const r of this.rets) if (r.out.length < frames) { r.out = new Float32Array(frames); r.wet = new Float32Array(frames * 2); const b = new Float32Array(frames); b.set(r.back.subarray(0, Math.min(frames, r.back.length))); r.back = b; }
    const nodes = this.nodes;
    for (let s = 0; s < frames; s++) {
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k], x = n.x, from = n.from;
        for (let i = 0; i < from.length; i++) {
          const f = from[i];
          x[i] = f === null ? 0 : f.t === "out" ? nodes[f.node].y[f.out] : f.t === "normal" ? x[f.input] : this.rets[f.ret].back[s];
        }
        n.sim.step(x, n.y);
      }
      for (const r of this.rets) r.out[s] = nodes[r.mixer].y[r.send] * LINE;
      let l = 0, rr = 0;
      for (const [i, a, b] of this.outs) { l += nodes[i].y[a]; rr += nodes[i].y[b]; }
      left[s] = l; right[s] = rr;
    }
    // The sends' gear, a block late on the way back.
    for (const r of this.rets) {
      r.rig.process(r.out, r.wet, frames);
      for (let s = 0; s < frames; s++) r.back[s] = r.wet[s * 2] / LINE;
    }
  }

  /** Each module's id, kind, outputs in volts and what its sim reads out (a VCO's pitch, the sequencer's step), for probes and tests. */
  state() {
    return this.nodes.map((n) => ({ id: n.id, kind: n.kind, read: n.sim.read(), outs: Object.fromEntries(n.sim.outs.map((o, i) => [o, Math.round(n.y[i] * 1000) / 1000])) }));
  }
}

/** `seconds` of the wall into the room, left and right: for tests and renders. */
export function renderWall(spec: WallSpec, seconds: number, sampleRate = 48000): { left: Float32Array; right: Float32Array; wall: Wall } {
  const wall = new Wall(sampleRate);
  wall.set(spec);
  const n = Math.round(seconds * sampleRate), left = new Float32Array(n), right = new Float32Array(n);
  for (let at = 0; at < n; at += 128) {
    const m = Math.min(128, n - at), l = new Float32Array(m), r = new Float32Array(m);
    wall.process(l, r, m);
    left.set(l, at); right.set(r, at);
  }
  return { left, right, wall };
}
