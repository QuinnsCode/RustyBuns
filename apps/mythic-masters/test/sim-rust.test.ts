import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import * as d from "../src/dmath.ts";
import { BIN, nativeTrace, rustRates, samplePairs, tsTrace, WASM, wasmTrace } from "../scripts/sim-rust.ts";
import { allPairs, rates } from "../scripts/tune.ts";
import { bot } from "../src/bot.ts";
import { ROSTER } from "../src/roster.ts";
import { hashMatch, tsSim, wasmSim } from "../src/sim-wasm.ts";
import { ARENA, type Match } from "../src/sim.ts";

setDefaultTimeout(120_000);

const bits = new Float64Array(1), word = new BigInt64Array(bits.buffer);
const ulps = (a: number, b: number) => { bits[0] = a; const x = word[0]!; bits[0] = b; const y = word[0]!; return Number(x > y ? x - y : y - x); };

describe("deterministic math (src/dmath.ts)", () => {
  test("lands within a few last bits of Math, and exactly on the signed zeros and quadrants atan2 turns on", () => {
    const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
    const table: [string, () => [number, number], (x: number, y: number) => number, (x: number, y: number) => number, number][] = [
      ["sin", () => [rnd(-40, 40), 0], d.sin, Math.sin, 1],
      ["cos", () => [rnd(-40, 40), 0], d.cos, Math.cos, 1],
      ["tan", () => [rnd(0, 1.5), 0], d.tan, Math.tan, 4],
      ["atan2", () => [rnd(-30, 30), rnd(-30, 30)], d.atan2, Math.atan2, 1],
      ["exp", () => [rnd(-5, 5), 0], d.exp, Math.exp, 1],
      ["pow", () => [rnd(0.1, 400), rnd(0.2, 1)], d.pow, Math.pow, 8],
    ];
    for (const [name, gen, mine, ref, most] of table) {
      let worst = 0;
      for (let k = 0; k < 20_000; k++) { const [x, y] = gen(); worst = Math.max(worst, ulps(mine(x, y), ref(x, y))); }
      expect([name, worst <= most]).toEqual([name, true]);
    }
    for (const [y, x] of [[0, -1], [-0, -1], [0, 0], [-0, 0], [0, -0], [-0, -0], [1, 0], [-1, -0], [Infinity, 1], [1, -Infinity]] as const)
      expect(Object.is(d.atan2(y, x), Math.atan2(y, x))).toBe(true);
  });
});

// The page's fight (#3657): src/sim.wasm is checked in, so CI plays it here against sim.ts the way main.ts does, a tick
// at a time with the bots reading the Match it hands back, and the page writing into a fighter now and then.
describe("the page's fight on sim.wasm", () => {
  test("is sim.ts's fight, tick for tick, through a fight's worth of page writes", async () => {
    const wasm = await wasmSim(await Bun.file(WASM).arrayBuffer());
    const fights = samplePairs(10).flatMap(([i, j]) => [1, 2].map((seed) => ({ a: ROSTER[i]!, b: ROSTER[j]!, seed })));
    // What main.ts writes: health carried into a fight, a foe worn down to try a bind, a fighter put on the ledge.
    const writes: Record<number, (m: Match) => void> = {
      0: (m) => { m.f[0].hp = m.f[0].b.hp * 0.6; m.f[1].hp = 31.5; },
      200: (m) => { m.f[1].hp = m.f[1].b.hp * 0.25; },
      400: (m) => {
        const f = m.f[0], r = ARENA.radius + f.b.radius * 0.6;
        Object.assign(f, { pos: { x: -r, y: -0.6, z: 0 }, vel: { x: 0, y: 0.5, z: 0 }, onGround: false, state: "free", act: null, drop: 0, fresh: true });
      },
    };
    let ticks = 0, ledges = 0;
    for (const { a, b, seed } of fights) {
      const ts = tsSim(a, b), rs = wasm(a, b), bots = [[bot(0, seed), bot(1, seed + 1)], [bot(0, seed), bot(1, seed + 1)]] as const;
      expect(rs.engine).toBe("wasm");
      while (!ts.m.over) {
        writes[ts.m.tick]?.(ts.m); writes[rs.m.tick]?.(rs.m);
        ts.step([bots[0][0](ts.m), bots[0][1](ts.m)]);
        rs.step([bots[1][0](rs.m), bots[1][1](rs.m)]);
        if (hashMatch(rs.m) !== hashMatch(ts.m)) throw new Error(`${a.id} vs ${b.id}, seed ${seed}: parts at tick ${ts.m.tick}`);
        ledges += ts.m.events.filter((e) => e.kind === "ledge").length;
        ticks++;
      }
      expect([rs.m.over, rs.m.winner, rs.m.events]).toEqual([true, ts.m.winner, ts.m.events]);
    }
    expect(ticks).toBeGreaterThan(5000);
    expect(ledges).toBeGreaterThan(0); // the ledge write took: someone caught the lip
  });
});

// The Rust copy's native build (sim-rs/) isn't built in CI: `bun scripts/sim-rust.ts` builds it, and `tune.ts --rust`
// checks it against sim.ts before every run.
describe.skipIf(!existsSync(BIN))("the Rust sim (sim-rs/)", () => {
  test("plays the TS sim's fights tick for tick, native and wasm: the same state hash before every tick and after it", async () => {
    const pairs = samplePairs(12), seeds = [1, 2, 3], ts = tsTrace(pairs, seeds);
    const [native, wasm] = await Promise.all([nativeTrace(pairs, seeds), wasmTrace(pairs, seeds)]);
    expect(native).toEqual(ts);
    expect(wasm).toEqual(ts);
  });

  test("gives the whole roster's table the same rates as the TS tuner", async () => {
    const pairs = allPairs();
    expect(await rustRates(pairs, 2)).toEqual(await rates(pairs, 2));
  });
});
