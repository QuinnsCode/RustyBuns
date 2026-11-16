// Q Amp's pedalboard: slots in any order, with the amp itself as one of them.
// Whatever sits after the amp goes in its effects loop, between the preamp
// (tubes, then tone stack) and the power stage, as on a real amp. The chain is
// mono until the first stereo effect and two channels after it: a mono pedal or
// the preamp past that point runs twice, once a side, and costs twice.
//
// Only what clips is oversampled (ANALOG.md section 2): pedals, tubes and the
// power stage at 2× or 4×, the tone stack and the loop's time effects at 1×.
// Each slot's share of the audio thread is timed as it runs, so the board can
// show what costs what.
import { PEDALS, ampParts, type AmpDef, type Knobs } from "../circuit/amps.ts";
import { PowerStage, Rig, type Link } from "../circuit/rig.ts";
import { Space } from "../engine/space.ts";
import { AMP_SLOT, EFFECTS, tidyBoard, type Slot } from "./slots.ts";

/** Volts in the loop that the time effects (made for ±1) see as 1: a preamp's swing is tens of volts. */
const LOOP_VOLTS = 100;
/** Volts at the input for a full-scale sample: a guitar pickup peaks around 0.1 to 1 V. */
const INPUT_VOLTS = 0.5;

/** A link in the running chain. `wide` ones run on both channels. */
interface Stage {
  /** Same key, same thing: a rebuilt board keeps the stage (and its state) instead of making a new one. */
  readonly key: string;
  /** Whose load this counts toward: an effect's id, or the amp's slot for the preamp, tone stack and power stage. */
  readonly slot: string;
  readonly wide: boolean;
  run(l: Float32Array, r: Float32Array, n: number): void;
  readonly misses: number;
}

/** Circuits (a pedal, the tubes, the tone stack): a rig per channel, each just the circuits, swing in and swing out. */
class CircuitStage implements Stage {
  private rigs: Rig[];
  private nets: string[];
  constructor(readonly key: string, readonly slot: string, readonly wide: boolean, links: Link[], sampleRate: number, oversample: number) {
    const make = () => new Rig({ inputVolts: 1, links, power: 0, cab: false }, sampleRate, oversample);
    this.rigs = wide ? [make(), make()] : [make()];
    this.nets = links.map((l) => JSON.stringify(l.net));
  }
  /** New knob settings: a link whose parts changed is rebuilt, its pot is just set. */
  set(links: Link[], noise: number) {
    links.forEach((l, i) => {
      const net = JSON.stringify(l.net);
      if (net !== this.nets[i]) { this.nets[i] = net; for (const r of this.rigs) r.setLink(i, l.net); }
      for (const r of this.rigs) r.setGain(i, l.gain ?? 1);
    });
    for (const r of this.rigs) r.setNoise(noise);
  }
  run(l: Float32Array, r: Float32Array, n: number) {
    this.rigs[0].process(l, l, n);
    if (this.wide) this.rigs[1].process(r, r, n);
  }
  /** Each link's biggest swing since the last call (the left side's). */
  levels(): number[] { const out = this.rigs[0].levels(); this.rigs[1]?.levels(); return out; }
  get misses() { return this.rigs.reduce((s, r) => s + r.misses, 0); }
}

/** Q Space: always two channels out, at 1×. */
class SpaceStage implements Stage {
  readonly wide = true;
  readonly misses = 0;
  private space: Space;
  private buf = new Float32Array(256);
  private send = new Float32Array(256);
  constructor(readonly key: string, readonly slot: string, sampleRate: number) { this.space = new Space(sampleRate); }
  set(knob: number) { this.space.setAmount(knob / 10); }
  run(l: Float32Array, r: Float32Array, n: number) {
    if (this.buf.length < 2 * n) { this.buf = new Float32Array(2 * n); this.send = new Float32Array(2 * n); }
    const { buf, send } = this;
    for (let i = 0; i < n; i++) { buf[2 * i] = send[2 * i] = l[i] / LOOP_VOLTS; buf[2 * i + 1] = send[2 * i + 1] = r[i] / LOOP_VOLTS; }
    this.space.process(buf, send, n);
    for (let i = 0; i < n; i++) { l[i] = buf[2 * i] * LOOP_VOLTS; r[i] = buf[2 * i + 1] * LOOP_VOLTS; }
  }
}

/** The power tubes and cabinet, a pair once the chain is stereo. */
class PowerStageLink implements Stage {
  readonly misses = 0;
  private sides: PowerStage[];
  constructor(readonly key: string, readonly slot: string, readonly wide: boolean, drive: number, sampleRate: number, oversample: number) {
    this.sides = wide ? [new PowerStage(drive, sampleRate, oversample), new PowerStage(drive, sampleRate, oversample)] : [new PowerStage(drive, sampleRate, oversample)];
  }
  set(drive: number) { for (const s of this.sides) s.drive = drive; }
  run(l: Float32Array, r: Float32Array, n: number) {
    this.sides[0].process(l, l, n);
    if (this.wide) this.sides[1].process(r, r, n);
  }
}

type AnyStage = CircuitStage | SpaceStage | PowerStageLink;

const now: () => number = typeof performance === "object" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();

/** What a board runs from: the amp and its knobs, the slots in order, and the oversampling for what clips. */
export interface BoardSpec { amp: AmpDef; knobs: Knobs; slots: Slot[]; oversample: number }

export class Board {
  /** The stages' keys in order: the same chain means only knobs moved. */
  readonly chain: string;
  /** It ends in two channels. */
  readonly stereo: boolean;
  private stages: AnyStage[];
  private tubes: CircuitStage | null = null;
  private l = new Float32Array(128);
  private r = new Float32Array(128);
  private busy = new Map<string, number>();

  /** `prev`'s stages with the same key are taken over, so a reorder keeps a delay's tail and a tube's warm state. */
  constructor(spec: BoardSpec, readonly sampleRate = 48000, prev?: Board) {
    const { amp, knobs, oversample } = spec;
    const parts = ampParts(amp, knobs);
    const old = new Map(prev?.stages.map((s) => [s.key, s]));
    const stages: AnyStage[] = [];
    let wide = false;
    const take = <S extends AnyStage>(key: string, make: () => S, is: (s: AnyStage) => s is S): S => {
      const had = old.get(key);
      old.delete(key);
      return had && is(had) ? had : make();
    };
    const isCircuit = (s: AnyStage) => s instanceof CircuitStage, isSpace = (s: AnyStage) => s instanceof SpaceStage;
    for (const slot of tidyBoard(spec.slots)) {
      if (slot.id === AMP_SLOT) {
        const tk = `tubes:${amp.id}:${oversample}:${wide}`, sk = `tone:${amp.id}:${wide}`;
        const tubes = take(tk, () => new CircuitStage(tk, AMP_SLOT, wide, parts.tubes, sampleRate, oversample), isCircuit);
        const tone = take(sk, () => new CircuitStage(sk, AMP_SLOT, wide, [parts.tone], sampleRate, 1), isCircuit);
        tubes.set(parts.tubes, parts.noise);
        tone.set([parts.tone], parts.noise);
        stages.push(tubes, tone);
        this.tubes = tubes;
        continue;
      }
      if (!slot.on) continue;
      const def = EFFECTS.find((e) => e.id === slot.id);
      const pedal = PEDALS.find((p) => p.id === slot.id);
      if (def?.stereo) {
        wide = true;
        const st = take(`space:${slot.id}`, () => new SpaceStage(`space:${slot.id}`, slot.id, sampleRate), isSpace);
        st.set(slot.knob);
        stages.push(st);
      } else if (pedal) {
        const key = `pedal:${pedal.id}:${oversample}:${wide}`, links = [{ net: pedal.net(slot.knob) }];
        const st = take(key, () => new CircuitStage(key, pedal.id, wide, links, sampleRate, oversample), isCircuit);
        st.set(links, parts.noise);
        stages.push(st);
      }
    }
    const pk = `power:${oversample}:${wide}`;
    const power = take(pk, () => new PowerStageLink(pk, AMP_SLOT, wide, parts.power, sampleRate, oversample), (s): s is PowerStageLink => s instanceof PowerStageLink);
    power.set(parts.power);
    stages.push(power);
    this.stages = stages;
    this.stereo = wide;
    this.chain = stages.map((s) => s.key).join(" > ");
  }

  /** Full-scale mono `input` (±1) through the board to volts at the speaker on each side (`right` = `left` while it's mono). */
  process(input: Float32Array, left: Float32Array, right: Float32Array, n = input.length): void {
    if (this.l.length < n) { this.l = new Float32Array(n); this.r = new Float32Array(n); }
    const { l, r, busy } = this;
    for (let i = 0; i < n; i++) l[i] = input[i] * INPUT_VOLTS;
    let split = false;
    for (const st of this.stages) {
      if (st.wide && !split) { r.set(l.subarray(0, n)); split = true; }
      const t0 = now();
      st.run(l, r, n);
      busy.set(st.slot, (busy.get(st.slot) ?? 0) + now() - t0);
    }
    left.set(l.subarray(0, n));
    right.set((split ? r : l).subarray(0, n));
  }

  /** Each slot's time (ms) since the last call, then cleared: the slots that ran, in chain order. */
  times(): { id: string; ms: number }[] {
    const out = [...this.busy].map(([id, ms]) => ({ id, ms }));
    this.busy.clear();
    return out;
  }

  /** Each tube's biggest swing (volts) since the last call: what lights it. */
  levels(): number[] { return this.tubes?.levels() ?? []; }

  get misses(): number { return this.stages.reduce((s, st) => s + st.misses, 0); }
}

