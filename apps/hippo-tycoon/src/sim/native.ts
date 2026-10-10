// The Rust build of step() and the bots (native/crates/hippo_sim, as WebAssembly).
// Two ways to drive it:
//  - step(): the TypeScript State stays the source of truth; each step copies it
//    in, steps, and copies it back (a drop-in, but the copy costs more than the step saves).
//  - resident: load() a round and its bots once, then tick() and view() every
//    tick; save() brings it back. Match does this (src/engine/match.ts).
// One instance holds one round, so each Match gets its own (instantiate()).
import type { BotMem } from "./bots.ts";
import { SEATS, type Personality } from "./rules.ts";
import type { Rng } from "./rng.ts";
import type { Event, Hippo, Input, State } from "./types.ts";

export type StepFn = (s: State, inputs: readonly Input[]) => Event[];

interface SimExports {
  memory: WebAssembly.Memory;
  sim_new(seed: number, roundTicks: number): void;
  sim_input(seat: number, move: number, gulp: number, bellow: number): void;
  sim_step(): number;
  sim_events(): number;
  sim_hash(): number;
  sim_save(): number;
  sim_buf(): number;
  sim_reserve(len: number): number;
  sim_load(len: number): number;
  sim_tick(): number;
  sim_over(): number;
  sim_view(): number;
  sim_bot_load(seat: number, len: number): number;
  sim_bot_save(seat: number): number;
}

/** What a renderer needs from a resident round (src/engine/match.ts's Snapshot, minus the match's own fields). */
export interface SimView {
  tick: number;
  roundTicks: number;
  over: boolean;
  hippos: Hippo[];
  drops: { id: number; kind: number; x: number; y: number }[];
  slicks: { id: number; x: number; y: number; life: number }[];
}

export interface NativeSim {
  readonly engine: "rust";
  /** Drop-in for step(): copies `s` in and the result back out. */
  step: StepFn;
  /** For benchmarks: a step that keeps the state inside the module and only syncs `s.over`. */
  residentStep(): StepFn;
  /** newState() inside the module (a resident round starts here). */
  newRound(seed: number, roundTicks: number): void;
  /** hashState() of the module's state. */
  hash(): number;
  readonly memoryBytes: number;

  // ---- resident play ----
  /** Replace the module's state with `s`. */
  load(s: State): void;
  /** Copy the module's state into `s`. */
  save(s: State): void;
  /** A seat's bot memory and RNG; `p` null = a human drives the seat. */
  loadBot(seat: number, p: Personality | null, mem: BotMem, rng: Rng): void;
  /** Copy a seat's bot memory and RNG back out. */
  saveBot(seat: number, mem: BotMem, rng: Rng): void;
  /** A human seat's input for the next tick. */
  input(seat: number, x: Input): void;
  /** The bots press theirs, then one step. */
  tick(): Event[];
  readonly over: boolean;
  view(): SimView;
}

const HEAD = 10, HIPPO = 10, DROP = 7, SLICK = 4, EV = 6, BOT = 10, VIEW = 5, VDROP = 4;

/** Compile once; instantiate() per round holder. */
export const compileSim = (bytes: BufferSource): Promise<WebAssembly.Module> => WebAssembly.compile(bytes);

export async function simFromWasm(bytes: BufferSource): Promise<NativeSim> {
  return instantiateSim(await compileSim(bytes));
}

/** `mod` if it is the hippo_sim module, else null (the empty stand-in a build without cargo bundles). */
export const simModule = (mod: WebAssembly.Module | null | undefined): WebAssembly.Module | null =>
  mod && WebAssembly.Module.exports(mod).some((x) => x.name === "sim_step") ? mod : null;

export function instantiateSim(mod: WebAssembly.Module): NativeSim {
  const e = new WebAssembly.Instance(mod, {}).exports as unknown as SimExports;
  if (typeof e.sim_step !== "function" || !e.memory) throw new Error("not the hippo_sim module");
  const f64 = (ptr: number, len: number) => new Float64Array(e.memory.buffer, ptr, len);

  const load = (s: State) => {
    const len = HEAD + s.hippos.length * HIPPO + s.drops.length * DROP + s.slicks.length * SLICK;
    const o = f64(e.sim_reserve(len), len);
    o.set([s.tick, s.seed, s.rng, s.roundTicks, +s.over, s.nextId, s.spawnCd, s.burst, s.drops.length, s.slicks.length]);
    let p = HEAD;
    for (const h of s.hippos) { o.set([h.seat, h.slide, h.gulp, h.cooldown, h.sputter, h.sore, +h.flooded, +h.dud, h.score, h.bellow], p); p += HIPPO; }
    for (const d of s.drops) { o.set([d.id, d.kind, d.x, d.y, d.vx, d.vy, d.age], p); p += DROP; }
    for (const k of s.slicks) { o.set([k.id, k.x, k.y, k.life], p); p += SLICK; }
    if (!e.sim_load(len)) throw new Error("hippo_sim rejected the state");
  };

  const save = (s: State) => {
    const len = e.sim_save(), i = f64(e.sim_buf(), len);
    s.tick = i[0]!; s.rng = i[2]!; s.over = i[4] !== 0; s.nextId = i[5]!; s.spawnCd = i[6]!; s.burst = i[7]!;
    const nd = i[8]!, ns = i[9]!;
    let p = HEAD;
    for (const h of s.hippos) { Object.assign(h, hippo(i, p)); p += HIPPO; }
    s.drops = [];
    for (let k = 0; k < nd; k++, p += DROP) s.drops.push({ id: i[p]!, kind: i[p + 1]!, x: i[p + 2]!, y: i[p + 3]!, vx: i[p + 4]!, vy: i[p + 5]!, age: i[p + 6]! });
    s.slicks = [];
    for (let k = 0; k < ns; k++, p += SLICK) s.slicks.push({ id: i[p]!, x: i[p + 1]!, y: i[p + 2]!, life: i[p + 3]! });
  };

  const events = (n: number): Event[] => {
    const v = f64(e.sim_events(), n * EV), out: Event[] = [];
    for (let k = 0; k < n; k++) out.push(decode(v, k * EV));
    return out;
  };
  const run = (inputs: readonly Input[]): Event[] => {
    inputs.forEach((x, seat) => e.sim_input(seat, x.move, +x.gulp, +x.bellow));
    return events(e.sim_step());
  };

  return {
    engine: "rust",
    step(s, inputs) {
      if (s.over) return [];
      load(s);
      const out = run(inputs);
      save(s);
      return out;
    },
    residentStep() {
      let cur: State | null = null;
      return (s, inputs) => {
        if (s !== cur) { load(s); cur = s; }
        const out = run(inputs);
        if (out.some((x) => x.t === "end")) s.over = true;
        return out;
      };
    },
    newRound: (seed, roundTicks) => e.sim_new(seed >>> 0, roundTicks),
    hash: () => e.sim_hash() >>> 0,
    get memoryBytes() { return e.memory.buffer.byteLength; },

    load, save,
    loadBot(seat, p, mem, rng) {
      const known = [...mem.known], len = BOT + known.length;
      const o = f64(e.sim_reserve(len), len);
      o.set([p ? 1 : 0, p?.reaction ?? 0, p?.aimError ?? 0, p?.greed ?? 0, p?.caution ?? 0, mem.target, mem.err, mem.nextPlan, rng.rng, known.length]);
      o.set(known, BOT);
      if (!e.sim_bot_load(seat, len)) throw new Error("hippo_sim rejected the bot");
    },
    saveBot(seat, mem, rng) {
      const len = e.sim_bot_save(seat), i = f64(e.sim_buf(), len);
      mem.target = i[5]!; mem.err = i[6]!; mem.nextPlan = i[7]!; rng.rng = i[8]!;
      mem.known = new Set(i.subarray(BOT));
    },
    input: (seat, x) => e.sim_input(seat, x.move, +x.gulp, +x.bellow),
    tick: () => events(e.sim_tick()),
    get over() { return e.sim_over() !== 0; },
    view() {
      const len = e.sim_view(), i = f64(e.sim_buf(), len);
      const nd = i[3]!, ns = i[4]!, hippos: Hippo[] = [], drops: SimView["drops"] = [], slicks: SimView["slicks"] = [];
      let p = VIEW;
      for (let k = 0; k < SEATS; k++, p += HIPPO) hippos.push(hippo(i, p));
      for (let k = 0; k < nd; k++, p += VDROP) drops.push({ id: i[p]!, kind: i[p + 1]!, x: i[p + 2]!, y: i[p + 3]! });
      for (let k = 0; k < ns; k++, p += SLICK) slicks.push({ id: i[p]!, x: i[p + 1]!, y: i[p + 2]!, life: i[p + 3]! });
      return { tick: i[0]!, roundTicks: i[1]!, over: i[2] !== 0, hippos, drops, slicks };
    },
  };
}

const hippo = (i: Float64Array, p: number): Hippo => ({
  seat: i[p]!, slide: i[p + 1]!, gulp: i[p + 2]!, cooldown: i[p + 3]!, sputter: i[p + 4]!, sore: i[p + 5]!,
  flooded: i[p + 6] !== 0, dud: i[p + 7] !== 0, score: i[p + 8]!, bellow: i[p + 9]!,
});

function decode(v: Float64Array, o: number): Event {
  const seat = v[o + 1]!;
  switch (v[o]) {
    case 0: return { t: "gulp", seat };
    case 1: return { t: "bellow", seat };
    case 2: return { t: "dud", seat };
    case 3: return { t: "eat", seat, kind: v[o + 2]!, pts: v[o + 3]!, x: v[o + 4]!, y: v[o + 5]! };
    case 4: return { t: "sputter", seat };
    case 5: return { t: "sore", seat };
    case 6: return { t: "flood", seat };
    case 7: return { t: "spawn", kind: v[o + 2]! };
    case 8: return { t: "slick", x: v[o + 4]!, y: v[o + 5]! };
    case 9: return { t: "overflow" };
    default: return { t: "end" };
  }
}
