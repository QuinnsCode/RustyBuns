// Every engine must give the same answer: Rust via bun:ffi (blocking and on its
// own thread), Rust compiled to wasm, and the TS twin. And the spatial index
// must match brute force exactly, on a real tscircuit board and on generated ones.
// Rust tests skip (not fail) until `bun native/build.ts` has been run.
import { test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { analyze } from "../src/analysis/analyze.ts";
import { loadWasm, runWasm } from "../src/analysis/wasm.ts";
import { analyzeNative, analyzeNativeAsync, nativeAvailable } from "../desktop/native.ts";
import fixture from "../fixtures/small-board.json";
import { syntheticBoard, randomBoard } from "../scripts/synthetic.ts";

const close = (a: unknown, b: unknown): void => {
  if (typeof a === "number" && typeof b === "number") { expect(Math.abs(a - b)).toBeLessThan(1e-9); return; }
  if (a && typeof a === "object") {
    expect(Object.keys(b as object).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a)) close((a as any)[k], (b as any)[k]);
    return;
  }
  expect(b).toEqual(a);
};

const wasmPath = join(import.meta.dir, "..", "public", "native", "tsci_analysis.wasm");
const wasm = existsSync(wasmPath) ? await loadWasm(readFileSync(wasmPath)) : null;

if (!nativeAvailable) console.warn("[tscircuit-desktop] Rust engine not built: skipping native parity tests. Run `bun native/build.ts` in apps/tscircuit-desktop.");
if (!wasm) console.warn("[tscircuit-desktop] wasm engine not built: skipping wasm parity tests. `rustup target add wasm32-unknown-unknown`, then `bun native/build.ts`.");
const withRust = test.skipIf(!nativeAvailable);
const withWasm = test.skipIf(!wasm);

const boards: [string, any[], number][] = [
  ["the real board", fixture as any[], 0.1],
  ["a synthetic board with violations", syntheticBoard(400, 0.3), 0.2],
  ["a sparse random board", randomBoard(1, 60, 200), 0.15],
  ["a dense random board", randomBoard(2, 300, 20), 0.15],
];

test("real tscircuit board: sane numbers", () => {
  const r = analyze(fixture as any[], 0.1);
  expect(r.board.width_mm).toBe(30);
  expect(r.counts.components).toBe(5);
  expect(r.counts.pcb_traces).toBe(5);
  expect(r.routing.total_length_mm).toBeGreaterThan(0);
  expect(r.routing.unrouted_nets).toBe(0);
  expect(r.longest_nets.some((n) => n.name === "GND")).toBe(true);
});

test("violations name the nets on both sides", () => {
  const r = analyze(fixture as any[], 1);
  expect(r.clearance.violation_count).toBeGreaterThan(0);
  for (const v of r.clearance.violations) {
    expect(v.net_a).toBeString();
    expect(v.net_b).toBeString();
    expect(v.net_a).not.toBe(v.net_b);
  }
});

test("the spatial index is exact: same answer as brute force", () => {
  for (let seed = 1; seed <= 6; seed++) {
    for (const [n, size] of [[80, 10], [80, 200], [300, 40]] as const) {
      for (const min of [0, 0.15, 2]) {
        const els = randomBoard(seed, n, size);
        const { pairs_checked, search_radius_mm, ...fast } = analyze(els, min).clearance;
        const { pairs_checked: all, search_radius_mm: _, ...slow } = analyze(els, min, true).clearance;
        expect(fast).toEqual(slow);
        expect(pairs_checked).toBeLessThanOrEqual(all);
        expect(all).toBe(fast.pairs_possible);
      }
    }
  }
});

test("the index skips most pairs on a big board", () => {
  const c = analyze(syntheticBoard(4000, 0.3), 0.2).clearance;
  expect(c.pairs_checked * 50).toBeLessThan(c.pairs_possible);
});

for (const [name, els, min] of boards) {
  withRust(`native parity on ${name}`, () => {
    close(analyze(els, min), JSON.parse(analyzeNative(JSON.stringify(els), min)!));
  });
  withWasm(`wasm parity on ${name}`, () => {
    close(analyze(els, min), JSON.parse(runWasm(wasm!, JSON.stringify(els), min)));
  });
}

withRust("async native: same answers, many in flight at once", async () => {
  const outs = await Promise.all(boards.map(([, els, min]) => analyzeNativeAsync(JSON.stringify(els), min)!));
  outs.forEach((out, i) => close(analyze(boards[i]![1], boards[i]![2]), JSON.parse(out)));
});

withRust("async native: the event loop keeps running while Rust works", async () => {
  const text = JSON.stringify(syntheticBoard(3000, 0.3));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  await analyzeNativeAsync(text, 0.2);
  clearInterval(timer);
  expect(ticks).toBeGreaterThan(0);
});

withRust("bad input is an error object, not a crash", async () => {
  expect(JSON.parse(analyzeNative("{not json", 0.1)!).error).toMatch(/bad json/);
  expect(JSON.parse(analyzeNative("{}", 0.1)!).error).toMatch(/array/);
  expect(JSON.parse((await analyzeNativeAsync("{}", 0.1))!).error).toMatch(/array/);
});
