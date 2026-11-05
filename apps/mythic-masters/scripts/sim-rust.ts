// The Rust copy of the fight sim and bot (sim-rs/, #3628): build it, hand it the TS roster, and check it still
// plays the TS sim's fights bit for bit. The TS (sim.ts, bot.ts, roster.ts, balance.json) is the source of truth
// and the reference; the Rust is the fast path `tune.ts --rust` takes, native over every core or one wasm module.
//
//   bun scripts/sim-rust.ts            build native and wasm (cargo, release), then check 24 fights tick for tick
//   bun scripts/sim-rust.ts --check    just the check, against what is built
//
// A fight's state is hashed after every tick, the same way on both sides (`hashMatch`, sim-rs/src/hash.rs), so a
// change to sim.ts or bot.ts that the Rust doesn't have shows up as the first tick where the hashes part.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { arr, int, num, obj } from "@rustybuns/util/guard";
import { bot } from "../src/bot.ts";
import { FIELDS, STRONG, type Field } from "../src/fields.ts";
import { body, ROSTER, SLOTS } from "../src/roster.ts";
import { newMatch, step, type Match } from "../src/sim.ts";

const CRATE = join(import.meta.dir, "../sim-rs");
export const BIN = join(CRATE, "target/release/mythic-sim");
export const WASM = join(CRATE, "target/wasm32-unknown-unknown/release/mythic_sim.wasm");

/** The roster as sim-rs reads it (data.rs): each creature's numbers, its body and its six moves, edges as they stand. */
export function rosterJson() {
  const field = (f: Field) => FIELDS.indexOf(f);
  return {
    strong: FIELDS.map((f) => STRONG[f].map(field)),
    creatures: ROSTER.map((c) => {
      const s = c.stats, moves = SLOTS.map((slot) => c.moves.find((m) => m.slot === slot)!);
      return {
        archetype: c.archetype, fields: c.fields.map(field), stats: [s.vigor, s.might, s.guard, s.focus, s.will, s.speed], edge: c.edge,
        body: body(c), moves: moves.map((m) => ({ field: field(m.field), power: m.power, ranged: m.ranged, drain: m.drain, delivery: m.delivery, tempo: m.tempo })),
      };
    }),
  };
}

export type Pair = [number, number];
/** One fight's answer from a trace: who won, how long it ran, and the state hash before it and after every tick. */
export const Trace = obj({ winner: int(0, 1), ticks: int(0, 1e6), hashes: arr(int(0, 2 ** 32 - 1), 1e6) });
export type Trace = ReturnType<typeof Trace>;
const Traces = arr(Trace, 1e6);
/** A pairing's rate, as tune.ts `rate` gives it: [wins, ring-outs, time-outs, seconds a fight]. */
const Rates = arr(arr(num(0, 1e6), 4, { min: 4 }), 1e6);

type Command = { cmd: "rates"; pairs: Pair[]; n: number; threads?: number } | { cmd: "trace"; pairs: Pair[]; seeds: number[]; threads?: number };

/** The native binary: the command on stdin, the answer on stdout. */
export async function native(c: Command): Promise<unknown> {
  if (!existsSync(BIN)) throw new Error(`no ${BIN}: build it with \`bun scripts/sim-rust.ts\``);
  const p = Bun.spawn([BIN], { stdin: new TextEncoder().encode(JSON.stringify({ roster: rosterJson(), ...c })), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`mythic-sim exited ${code}: ${err.trim()}`);
  return JSON.parse(out);
}

/** The wasm module, one call: the command goes into its memory, the answer comes back out (lib.rs `run`). */
export async function wasm(c: Command): Promise<unknown> {
  if (!existsSync(WASM)) throw new Error(`no ${WASM}: build it with \`bun scripts/sim-rust.ts\``);
  const { instance } = await WebAssembly.instantiate(await Bun.file(WASM).arrayBuffer());
  const x = instance.exports, alloc = x.alloc, run = x.run, outLen = x.out_len, memory = x.memory;
  if (typeof alloc !== "function" || typeof run !== "function" || typeof outLen !== "function" || !(memory instanceof WebAssembly.Memory))
    throw new Error("mythic_sim.wasm: no alloc, run, out_len or memory export");
  const input = new TextEncoder().encode(JSON.stringify({ roster: rosterJson(), ...c }));
  const at = Number(alloc(input.length));
  new Uint8Array(memory.buffer, at, input.length).set(input);
  const out = Number(run(at, input.length)), len = Number(outLen());
  const got: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(memory.buffer, out, len)));
  if (got && typeof got === "object" && "error" in got) throw new Error(`mythic_sim.wasm: ${String(got.error)}`);
  return got;
}

/** tune.ts `rate` for each pairing, on the native binary over every core. */
export const rustRates = async (pairs: Pair[], n: number) =>
  Rates(await native({ cmd: "rates", pairs, n })).map(([wins, ringOuts, time, seconds]) => ({ wins: wins!, ringOuts: ringOuts!, time: time!, seconds: seconds! }));

export const nativeTrace = async (pairs: Pair[], seeds: number[]) => Traces(await native({ cmd: "trace", pairs, seeds }));
export const wasmTrace = async (pairs: Pair[], seeds: number[]) => Traces(await wasm({ cmd: "trace", pairs, seeds }));

// FNV-1a over every number's f64 bits, in sim-rs/src/hash.rs's order.
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
let h = 0;
const word = (w: number) => { h = Math.imul(h ^ w, 16777619) >>> 0; };
const n = (x: number) => { if (x !== x) { word(0); word(0x7ff80000); return; } f64[0] = x; word(u32[0]!); word(u32[1]!); };
const flag = (b: boolean) => n(b ? 1 : 0);
const KEYS = ["up", "down", "light", "heavy", "special", "ultimate", "guard", "dash", "big"] as const;
const STATES = ["free", "attack", "stun", "guard", "dash", "ledge"] as const;
const SHAPES = ["touch", "column", "wall", "cone", "blast", "nova"] as const;
const key = (k: string) => KEYS.indexOf(k as (typeof KEYS)[number]);
const slot = (s: string) => SLOTS.indexOf(s as (typeof SLOTS)[number]);

/** The whole of a Match as one 32-bit hash: the TS half of the tick-for-tick check. */
export function hashMatch(m: Match): number {
  h = 2166136261;
  n(m.tick); flag(m.over); n(m.winner ?? -1);
  for (const f of m.f) {
    for (const x of [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z, f.yaw, f.hp, f.launch, f.stamina, f.energy]) n(x);
    n(STATES.indexOf(f.state)); n(f.t); n(f.stun); n(f.clipped); flag(f.flying); flag(f.onGround); n(f.airJumps); flag(f.rise); flag(f.exhausted); n(f.invuln);
    n(f.buf ? key(f.buf.k) : -1); n(f.buf ? f.buf.left : 0);
    flag(f.hop);
    for (const x of [f.ring, f.spin, f.orbit, f.bearing, f.red, f.hurt]) n(x);
    flag(f.fresh); n(f.drop);
    const k = f.marks;
    n(k.dot); n(k.dotPer); n(k.dotField ? FIELDS.indexOf(k.dotField) : -1); n(k.chill); n(k.root);
    const p = f.prev;
    n(p.mx); n(p.mz);
    for (const b of KEYS) flag(p[b]);
    const a = f.act;
    if (!a) n(-1);
    else {
      n(slot(a.move.slot)); flag(a.hit); flag(a.dive); flag(!!a.tired);
      if (a.aim) { n(1); n(a.aim.yaw); n(a.aim.pitch); } else n(0);
      n(a.key ? key(a.key) : -1); n(a.hold ?? 0); n(a.lead ?? 0);
      n(a.area ? m.areas.indexOf(a.area) : -2);
    }
  }
  n(m.areas.length);
  for (const a of m.areas) {
    n(a.owner); n(slot(a.move.slot));
    for (const x of [a.power, a.at.x, a.at.y, a.at.z, a.from.x, a.from.y, a.from.z, a.dir.x, a.dir.y, a.dir.z, a.t, a.life, a.land, a.every, a.ramp, a.hits[0], a.hits[1]]) n(x);
    flag(a.struck[0]); flag(a.struck[1]);
    const d = a.d;
    n(SHAPES.indexOf(d.shape));
    if (d.shape === "column") { n(d.length); n(d.width); n(d.speed); }
    else if (d.shape === "wall") { n(d.width); n(d.depth); n(d.travel); n(d.speed); }
    else if (d.shape === "cone") { n(d.angle); n(d.length); }
    else if (d.shape === "blast") { n(d.range); n(d.radius); n(d.flight); }
    else n(d.radius);
  }
  n(m.events.length);
  for (const e of m.events) {
    if (e.kind === "hit") { n(0); n(e.by); n(e.on); n(slot(e.slot)); n(FIELDS.indexOf(e.field)); n(e.damage); flag(e.guarded); flag(e.rear); flag(e.spike); n(e.at.x); n(e.at.y); n(e.at.z); }
    else if (e.kind === "move") { n(1); n(e.by); n(slot(e.move.slot)); for (const x of [e.at.x, e.at.y, e.at.z, e.yaw, e.target.x, e.target.y, e.target.z]) n(x); }
    else if (e.kind === "land") { n(2); n(e.who); n(e.speed); }
    else if (e.kind === "clipped") { n(3); n(e.who); }
    else if (e.kind === "ledge") { n(4); n(e.who); }
    else { n(5); n(e.who); n(e.how === "hp" ? 0 : e.how === "ring-out" ? 1 : 2); }
  }
  return h;
}

/** tune.ts `play` on the TS sim, hashing the state before the first tick and after every one. */
export function tsTrace(pairs: Pair[], seeds: number[]): Trace[] {
  return pairs.flatMap(([i, j]) => seeds.map((seed) => {
    const m = newMatch(ROSTER[i]!, ROSTER[j]!), bots = [bot(0, seed), bot(1, seed * 7 + 1)] as const, hashes = [hashMatch(m)];
    while (!m.over) { step(m, [bots[0](m), bots[1](m)]); hashes.push(hashMatch(m)); }
    return { winner: m.winner!, ticks: m.tick, hashes };
  }));
}

/** Where two traces of the same fights first part: fight k at tick t, or null when every hash matches. */
export function parted(a: Trace[], b: Trace[]): { fight: number; tick: number } | null {
  for (let k = 0; k < Math.max(a.length, b.length); k++) {
    const x = a[k]?.hashes ?? [], y = b[k]?.hashes ?? [];
    for (let t = 0; t < Math.max(x.length, y.length); t++) if (x[t] !== y[t]) return { fight: k, tick: t };
  }
  return null;
}

/** A spread of pairings for the check: every archetype against every other, light and heavy, flyers in the air. */
export function samplePairs(count: number): Pair[] {
  const out: Pair[] = [], len = ROSTER.length;
  for (let k = 0; out.length < count; k++) out.push([(k * 7) % len, (k * 13 + 5) % len]);
  return out.map(([i, j]) => (i === j ? [i, (j + 1) % len] : [i, j]));
}

/** Does the native build still play `pairs` x `seeds` exactly as sim.ts does? The first tick it doesn't, if any. */
export async function drift(pairs = samplePairs(8), seeds = [1, 2, 3]) {
  const ts = tsTrace(pairs, seeds), rs = await nativeTrace(pairs, seeds), at = parted(ts, rs);
  if (!at) return null;
  const k = at.fight, [i, j] = pairs[Math.floor(k / seeds.length)]!;
  return { ...at, pair: [ROSTER[i]!.id, ROSTER[j]!.id] as const, seed: seeds[k % seeds.length]! };
}

async function cargo(...args: string[]) {
  const p = Bun.spawn(["cargo", "build", "--release", "--manifest-path", join(CRATE, "Cargo.toml"), ...args], { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`cargo build ${args.join(" ")} failed`);
}

if (import.meta.main) {
  if (process.argv[2] !== "--check") { await cargo(); await cargo("--target", "wasm32-unknown-unknown", "--lib"); }
  const pairs = samplePairs(8), seeds = [1, 2, 3], ts = tsTrace(pairs, seeds);
  const ticks = ts.reduce((t, f) => t + f.hashes.length, 0);
  for (const [name, rs] of [["native", await nativeTrace(pairs, seeds)], ["wasm", await wasmTrace(pairs, seeds)]] as const) {
    const at = parted(ts, rs);
    console.log(at ? `${name}: parts from sim.ts in fight ${at.fight} at tick ${at.tick}` : `${name}: ${ts.length} fights, ${ticks} ticks, every hash the same as sim.ts`);
    if (at) process.exitCode = 1;
  }
}
