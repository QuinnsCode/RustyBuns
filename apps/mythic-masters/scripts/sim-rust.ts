// The Rust copy of the fight sim and bot (sim-rs/, #3628): build it, hand it the TS roster, and check it still
// plays the TS sim's fights bit for bit. The TS (sim.ts, bot.ts, roster.ts, balance.json) is the source of truth
// and the reference; the Rust is the fast path `tune.ts --rust` takes, native over every core or one wasm module,
// and the page's fight (src/sim.wasm, which src/sim-wasm.ts plays a tick at a time, #3657).
//
//   bun scripts/sim-rust.ts            build native and wasm (cargo, release), copy the wasm to src/sim.wasm, check 24 fights
//   bun scripts/sim-rust.ts --check    just the check, against what is built
//   bun scripts/sim-rust.ts --bench    a tick on sim.ts against a tick on sim.wasm read back into a Match, as the page plays it
//
// A fight's state is hashed after every tick, the same way on both sides (`hashMatch`, sim-rs/src/state.rs), so a
// change to sim.ts or bot.ts that the Rust doesn't have shows up as the first tick where the hashes part.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { arr, int, num, obj } from "@rustybuns/util/guard";
import { bot } from "../src/bot.ts";
import { ROSTER } from "../src/roster.ts";
import { hashMatch, rosterJson as rosterOf, tsSim, wasmSim } from "../src/sim-wasm.ts";
import { newMatch, newTeamMatch, step } from "../src/sim.ts";

const CRATE = join(import.meta.dir, "../sim-rs");
export const BIN = join(CRATE, "target/release/mythic-sim");
const BUILT = join(CRATE, "target/wasm32-unknown-unknown/release/mythic_sim.wasm");
/** The wasm the page ships (src/main.ts), copied here from the build so it is checked in, and checked in CI. */
export const WASM = join(import.meta.dir, "../src/sim.wasm");
const rosterJson = () => rosterOf(ROSTER);

export type Pair = [number, number];
/** A fight in a trace: a pair one on one, or a team a side as roster indices (#3929: two against one). */
export type Fight = Pair | [number[], number[]];
/** One fight's answer from a trace: who won, how long it ran, and the state hash before it and after every tick. */
export const Trace = obj({ winner: int(0, 1), ticks: int(0, 1e6), hashes: arr(int(0, 2 ** 32 - 1), 1e6) });
export type Trace = ReturnType<typeof Trace>;
const Traces = arr(Trace, 1e6);
/** A pairing's rate, as tune.ts `rate` gives it: [wins, ring-outs, time-outs, seconds a fight]. */
const Rates = arr(arr(num(0, 1e6), 4, { min: 4 }), 1e6);

type Command = { cmd: "rates"; pairs: Pair[]; n: number; threads?: number } | { cmd: "trace"; pairs: Fight[]; seeds: number[]; threads?: number };

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

export const nativeTrace = async (pairs: Fight[], seeds: number[]) => Traces(await native({ cmd: "trace", pairs, seeds }));
export const wasmTrace = async (pairs: Fight[], seeds: number[]) => Traces(await wasm({ cmd: "trace", pairs, seeds }));
/** tune.ts `play` on the TS sim, hashing the state before the first tick and after every one. A bot a fighter: the
 * first seeded `seed`, fighter k `seed * 7 + k` (lib.rs play_teams). */
export function tsTrace(pairs: Fight[], seeds: number[]): Trace[] {
  return pairs.flatMap(([i, j]) => seeds.map((seed) => {
    const m = typeof i === "number" && typeof j === "number" ? newMatch(ROSTER[i]!, ROSTER[j]!) : newTeamMatch([[i].flat().map((k) => ROSTER[k]!), [j].flat().map((k) => ROSTER[k]!)]);
    const bots = m.f.map((_, k) => bot(k, k ? seed * 7 + k : seed)), hashes = [hashMatch(m)];
    while (!m.over) { step(m, bots.map((b) => b(m))); hashes.push(hashMatch(m)); }
    return { winner: m.winner!, ticks: m.tick, hashes };
  }));
}
/** Two friends against a wild one, spread over the roster like samplePairs: three different creatures a fight. */
export function sampleTeams(count: number): [number[], number[]][] {
  const len = ROSTER.length, out: [number[], number[]][] = [];
  for (let k = 0; out.length < count; k++) {
    const a = (k * 11 + 2) % len, b = (k * 5 + 9) % len, c = (k * 17 + 3) % len;
    if (a !== b && b !== c && a !== c) out.push([[a, b], [c]]);
  }
  return out;
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

/** Microseconds a tick, bots included, over the sample's fights: on sim.ts, and on sim.wasm as the page plays it. */
export async function bench(pairs = samplePairs(8), seeds = [1, 2, 3]) {
  const sims = [["sim.ts", tsSim], ["sim.wasm", await wasmSim(await Bun.file(WASM).arrayBuffer())]] as const;
  return Object.fromEntries(sims.map(([name, sim]) => {
    let ticks = 0;
    const t0 = performance.now();
    for (const [i, j] of pairs) for (const seed of seeds) {
      const live = sim(ROSTER[i]!, ROSTER[j]!), bots = [bot(0, seed), bot(1, seed * 7 + 1)] as const;
      while (!live.m.over) { live.step([bots[0](live.m), bots[1](live.m)]); ticks++; }
    }
    return [name, +(((performance.now() - t0) * 1000) / ticks).toFixed(2)];
  }));
}

if (import.meta.main) {
  if (process.argv[2] === "--bench") { console.log("µs a tick, two bots included:", await bench()); process.exit(0); }
  if (process.argv[2] !== "--check") {
    await cargo(); await cargo("--target", "wasm32-unknown-unknown", "--lib");
    await Bun.write(WASM, Bun.file(BUILT));
  }
  const pairs = samplePairs(8), seeds = [1, 2, 3], ts = tsTrace(pairs, seeds);
  const ticks = ts.reduce((t, f) => t + f.hashes.length, 0);
  for (const [name, rs] of [["native", await nativeTrace(pairs, seeds)], ["wasm", await wasmTrace(pairs, seeds)]] as const) {
    const at = parted(ts, rs);
    console.log(at ? `${name}: parts from sim.ts in fight ${at.fight} at tick ${at.tick}` : `${name}: ${ts.length} fights, ${ticks} ticks, every hash the same as sim.ts`);
    if (at) process.exitCode = 1;
  }
}
