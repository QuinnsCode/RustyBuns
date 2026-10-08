import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CAP, FluidTS, STRIDE, fluidFromWasm, type Fluid } from "../src/client/render/fluid.ts";

const WASM = join(import.meta.dir, "../public/hippo_fluid.wasm");
const DT = 1 / 60;

/** A scripted gush: a trickle, a surge, a golden burst, then quiet. */
function drive(f: Fluid, steps: number, onStep?: (i: number) => void) {
  for (let i = 0; i < steps; i++) {
    const surge = i >= 60 && i < 100, gold = i >= 140 && i < 160, quiet = i >= 220;
    const emit = quiet ? 0 : surge ? 6 : gold ? 5 : i % 3 === 0 ? 1 : 0;
    f.step(DT, emit, surge ? 8.5 : 5, gold ? 1 : 0);
    onStep?.(i);
  }
}

describe("the TypeScript fluid", () => {
  test("it gushes, stays in the basin, and every particle eventually soaks in", () => {
    const f = new FluidTS(7);
    let peak = 0;
    drive(f, 400, () => {
      peak = Math.max(peak, f.count);
      const o = f.out;
      for (let k = 0; k < f.count; k++) {
        const x = o[k * STRIDE]!, y = o[k * STRIDE + 1]!, z = o[k * STRIDE + 2]!, r = o[k * STRIDE + 3]!;
        expect(Number.isFinite(x + y + z + r)).toBe(true);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(7.001);
        expect(y).toBeGreaterThanOrEqual(0.12 - 1e-6);
        expect(y).toBeLessThan(12);
        expect(r).toBeGreaterThan(0);
      }
    });
    expect(peak).toBeGreaterThan(150);
    expect(peak).toBeLessThanOrEqual(CAP);
    expect(f.count).toBe(0);                          // quiet for 180 steps: all gone
  });

  test("the same seed gives the same gush, another seed another", () => {
    const run = (seed: number) => { const f = new FluidTS(seed); drive(f, 150); return Array.from(f.out); };
    expect(run(3)).toEqual(run(3));
    expect(run(3)).not.toEqual(run(4));
  });

  test("a surge throws it higher and gold is tinted", () => {
    const maxY = (speed: number) => { const f = new FluidTS(1); let m = 0; for (let i = 0; i < 90; i++) { f.step(DT, 3, speed, 0); for (let k = 0; k < f.count; k++) m = Math.max(m, f.out[k * STRIDE + 1]!); } return m; };
    expect(maxY(9)).toBeGreaterThan(maxY(4) + 1);
    const g = new FluidTS(1); g.step(DT, 4, 6, 1);
    expect(Array.from({ length: g.count }, (_, k) => g.out[k * STRIDE + 4])).toEqual([1, 1, 1, 1]);
  });

  test("the pool is bounded: flooding it never exceeds the capacity or throws", () => {
    const f = new FluidTS(2);
    for (let i = 0; i < 300; i++) f.step(DT, 40, 8, 0);
    expect(f.count).toBeLessThanOrEqual(CAP);
  });
});

describe.skipIf(!existsSync(WASM))("the Rust twin (run `bun run build:native`)", () => {
  test("Rust and TypeScript agree bit for bit through the whole scripted gush", async () => {
    const ts = new FluidTS(11), rs = await fluidFromWasm(readFileSync(WASM), 11);
    expect(rs.engine).toBe("rust");
    let compared = 0;
    for (let i = 0; i < 400; i++) {
      const surge = i >= 60 && i < 100, gold = i >= 140 && i < 160, quiet = i >= 220;
      const emit = quiet ? 0 : surge ? 6 : gold ? 5 : i % 3 === 0 ? 1 : 0;
      for (const f of [ts, rs]) f.step(DT, emit, surge ? 8.5 : 5, gold ? 1 : 0);
      expect(rs.count).toBe(ts.count);
      if (i % 5 === 0 || i === 399) { expect(Array.from(rs.out)).toEqual(Array.from(ts.out)); compared += ts.count; }
    }
    expect(compared).toBeGreaterThan(5000);          // it compared real particles, not an empty pool
  });
});
