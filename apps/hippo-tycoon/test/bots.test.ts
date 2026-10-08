import { expect, test } from "bun:test";
import { bot, newBotMem, type BotMem } from "../src/sim/bots.ts";
import { hashState } from "../src/sim/hash.ts";
import { PERSONALITIES, type Difficulty } from "../src/sim/rules.ts";
import { seedOf } from "../src/sim/rng.ts";
import { newState, step } from "../src/sim/step.ts";
import { NO_INPUT, type Input } from "../src/sim/types.ts";

type Driver = Difficulty | "idle";

/** Bots own a memory and an RNG per seat, apart from the sim's, so who is human never changes the drops. */
function match(seed: number, drivers: Driver[], secs = 60) {
  const s = newState(seed, secs);
  const mem: BotMem[] = drivers.map(() => newBotMem());
  const rngs = drivers.map((_, i) => ({ rng: seedOf(seed * 7 + i) }));
  while (!s.over) {
    const inputs: Input[] = drivers.map((d, i) => d === "idle" ? NO_INPUT : bot(s, i, PERSONALITIES[d], mem[i]!, rngs[i]!));
    step(s, inputs);
  }
  return s;
}
const scores = (s: ReturnType<typeof match>) => s.hippos.map((h) => h.score);

test("bots are deterministic", () => {
  const a = match(3, ["normal", "normal", "hard", "easy"]);
  const b = match(3, ["normal", "normal", "hard", "easy"]);
  expect(hashState(a)).toBe(hashState(b));
});

test("who is a bot never changes what drips: spawn stream is independent of drivers", () => {
  const spawns = (drivers: Driver[]) => {
    const s = newState(4, 30); const out: number[] = [];
    const mem = drivers.map(() => newBotMem()); const rngs = drivers.map((_, i) => ({ rng: seedOf(i + 1) }));
    while (!s.over) for (const e of step(s, drivers.map((d, i) => d === "idle" ? NO_INPUT : bot(s, i, PERSONALITIES[d], mem[i]!, rngs[i]!)))) if (e.t === "spawn") out.push(e.kind);
    return out;
  };
  // timing can differ (the drop cap), but the order of kinds is the same stream
  const idle = spawns(["idle", "idle", "idle", "idle"]), busy = spawns(["hard", "normal", "easy", "hard"]);
  const n = Math.min(idle.length, busy.length);
  expect(n).toBeGreaterThan(20);
  expect(busy.slice(0, n)).toEqual(idle.slice(0, n));
});

test("a Normal bot beats an idle hippo", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const sc = scores(match(seed, ["idle", "normal", "idle", "idle"]));
    expect(sc[1]!).toBeGreaterThan(sc[0]!);
    expect(sc[1]!).toBeGreaterThan(5);
  }
});

test("difficulty orders the field: hard > normal > easy on average", () => {
  const total = { easy: 0, normal: 0, hard: 0 };
  for (let seed = 1; seed <= 6; seed++) {
    // each difficulty plays every seat position over the seeds, one at a time against idle rivals
    for (const d of ["easy", "normal", "hard"] as const) {
      const drivers: Driver[] = ["idle", "idle", "idle", "idle"];
      drivers[seed % 4] = d;
      total[d] += match(seed, drivers).hippos[seed % 4]!.score;
    }
  }
  expect(total.hard).toBeGreaterThan(total.normal);
  expect(total.normal).toBeGreaterThan(total.easy);
});

test("cautious bots dodge bad drops; easy bots eat them", () => {
  const bad = (d: Difficulty) => {
    let n = 0, all = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const s = newState(seed, 60); const mem = newBotMem(); const rng = { rng: seedOf(seed) };
      while (!s.over) for (const e of step(s, [bot(s, 0, PERSONALITIES[d], mem, rng), NO_INPUT, NO_INPUT, NO_INPUT])) if (e.t === "eat") { all++; if (e.pts < 0 || e.kind === 4) n++; }
    }
    return n / all;
  };
  expect(bad("hard")).toBeLessThan(bad("easy"));
});
