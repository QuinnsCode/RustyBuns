// The Rust twin of step() (rust/crates/hippo_sim) against the TypeScript one:
// the same state hash on every tick of scripted rounds. Skips when the wasm is
// not built, so contributors without Rust stay green.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Match } from "../src/engine/match.ts";
import { hashState } from "../src/sim/hash.ts";
import { simFromWasm } from "../src/sim/native.ts";
import { newState, step } from "../src/sim/step.ts";
import { cosSin } from "../src/sim/trig.ts";
import type { Input } from "../src/sim/types.ts";

const WASM = join(import.meta.dir, "../public/hippo_sim.wasm");

function scripted(seed: number) {
  let x = seed >>> 0;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  return (): Input[] => Array.from({ length: 4 }, () => ({ move: r() * 2.4 - 1.2, gulp: r() < 0.12, bellow: r() < 0.01 }));
}

test("cosSin matches Math.cos/sin to within 1e-15 over the sim's range", () => {
  for (let a = -7; a < 7; a += 0.0137) {
    const [c, s] = cosSin(a);
    expect(Math.abs(c - Math.cos(a))).toBeLessThan(1e-15);
    expect(Math.abs(s - Math.sin(a))).toBeLessThan(1e-15);
  }
  expect(cosSin(-Math.PI / 2)).toEqual([0, -1]);              // the seat axes come out exact
});

describe.skipIf(!existsSync(WASM))("the Rust twin (run `bun run build:native`)", () => {
  test("Rust and TypeScript agree on every tick, state hash and events, over whole rounds", async () => {
    const rs = await simFromWasm(readFileSync(WASM));
    let ticks = 0, eats = 0, slicks = 0;
    for (const [seed, secs] of [[1, 90], [7, 60], [0xdeadbeef, 30], [42, 90]] as const) {
      const ts = newState(seed, secs), mirror = newState(seed, secs);
      rs.newRound(seed, ts.roundTicks);
      expect(rs.hash()).toBe(hashState(ts));
      const rstep = rs.residentStep(), inputs = scripted(seed);
      while (!ts.over) {
        const inp = inputs();
        const a = step(ts, inp), b = rstep(mirror, inp);
        expect(rs.hash()).toBe(hashState(ts));
        expect(b).toEqual(a);
        ticks++; eats += a.filter((e) => e.t === "eat").length; slicks += a.filter((e) => e.t === "slick").length;
      }
    }
    expect(ticks).toBe(30 * (90 + 60 + 30 + 90));
    expect(eats).toBeGreaterThan(50);                  // it compared real chomps and slicks, not an empty pan
    expect(slicks).toBeGreaterThan(5);
  });

  test("as a drop-in step(), a whole match with bots ends in the same state", async () => {
    const rs = await simFromWasm(readFileSync(WASM));
    const play = (useRust: boolean) => {
      const m = new Match(1234, { secs: 60, difficulty: "hard" });
      if (useRust) m.stepper = rs.step;
      m.start();
      while (m.phase !== "podium") m.tick();
      return m.sim;
    };
    const a = play(false), b = play(true);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.hippos.some((h) => h.score > 0)).toBe(true);
  });

  test("a malformed module or state is refused", async () => {
    await expect(simFromWasm(readFileSync(join(import.meta.dir, "../public/hippo_fluid.wasm")))).rejects.toThrow("not the hippo_sim module");
    const rs = await simFromWasm(readFileSync(WASM));
    const s = newState(1); s.hippos.pop();
    expect(() => rs.step(s, [])).toThrow("rejected");
  });
});
