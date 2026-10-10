// The Rust build of step() (rust/crates/hippo_sim, as WebAssembly), behind the
// same signature as the TypeScript one. The TypeScript State stays the source
// of truth: each step copies it in, steps, and copies it back, so a caller can
// swap engines between ticks and nothing else changes.
import type { Event, Input, State } from "./types.ts";

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
}

const HEAD = 10, HIPPO = 10, DROP = 7, SLICK = 4, EV = 6;

export async function simFromWasm(bytes: BufferSource): Promise<NativeSim> {
  const { instance } = (await WebAssembly.instantiate(bytes, {})) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  const e = instance.exports as unknown as SimExports;
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
    for (const h of s.hippos) {
      h.slide = i[p + 1]!; h.gulp = i[p + 2]!; h.cooldown = i[p + 3]!; h.sputter = i[p + 4]!; h.sore = i[p + 5]!;
      h.flooded = i[p + 6] !== 0; h.dud = i[p + 7] !== 0; h.score = i[p + 8]!; h.bellow = i[p + 9]!;
      p += HIPPO;
    }
    s.drops = [];
    for (let k = 0; k < nd; k++, p += DROP) s.drops.push({ id: i[p]!, kind: i[p + 1]!, x: i[p + 2]!, y: i[p + 3]!, vx: i[p + 4]!, vy: i[p + 5]!, age: i[p + 6]! });
    s.slicks = [];
    for (let k = 0; k < ns; k++, p += SLICK) s.slicks.push({ id: i[p]!, x: i[p + 1]!, y: i[p + 2]!, life: i[p + 3]! });
  };

  const run = (inputs: readonly Input[]): Event[] => {
    inputs.forEach((x, seat) => e.sim_input(seat, x.move, +x.gulp, +x.bellow));
    const n = e.sim_step(), v = f64(e.sim_events(), n * EV), out: Event[] = [];
    for (let k = 0; k < n; k++) out.push(decode(v, k * EV));
    return out;
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
  };
}

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
