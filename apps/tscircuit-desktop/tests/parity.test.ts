// Rust (via bun:ffi) and the TS twin must give the same answer, on a real
// tscircuit board and on a big synthetic one with known violations.
// Rust tests skip (not fail) until `bun native/build.ts` has been run.
import { test, expect } from "bun:test";
import { analyze } from "../src/analysis/analyze.ts";
import { analyzeNative, nativeAvailable } from "../desktop/native.ts";
import fixture from "../fixtures/small-board.json";
import { syntheticBoard } from "../scripts/synthetic.ts";

const close = (a: unknown, b: unknown): void => {
  if (typeof a === "number" && typeof b === "number") { expect(Math.abs(a - b)).toBeLessThan(1e-9); return; }
  if (a && typeof a === "object") {
    expect(Object.keys(b as object).sort()).toEqual(Object.keys(a).sort());
    for (const k of Object.keys(a)) close((a as any)[k], (b as any)[k]);
    return;
  }
  expect(b).toEqual(a);
};

if (!nativeAvailable) {
  console.warn("[tscircuit-desktop] Rust engine not built: skipping parity tests. Run `bun native/build.ts` in apps/tscircuit-desktop.");
}
const withRust = test.skipIf(!nativeAvailable);

test("real tscircuit board: sane numbers", () => {
  const r = analyze(fixture as any[], 0.1);
  expect(r.board.width_mm).toBe(30);
  expect(r.counts.components).toBe(5);
  expect(r.counts.pcb_traces).toBe(5);
  expect(r.routing.total_length_mm).toBeGreaterThan(0);
  expect(r.routing.unrouted_nets).toBe(0);
  expect(r.longest_nets.some((n) => n.name === "GND")).toBe(true);
});

withRust("parity on the real board", () => {
  const ts = analyze(fixture as any[], 0.1);
  close(ts, JSON.parse(analyzeNative(JSON.stringify(fixture), 0.1)!));
});

withRust("parity on a synthetic board with violations", () => {
  const els = syntheticBoard(400, 0.3);
  const ts = analyze(els, 0.2);
  expect(ts.clearance.violation_count).toBeGreaterThan(0);
  close(ts, JSON.parse(analyzeNative(JSON.stringify(els), 0.2)!));
});

withRust("bad input is an error object, not a crash", () => {
  expect(JSON.parse(analyzeNative("{not json", 0.1)!).error).toMatch(/bad json/);
  expect(JSON.parse(analyzeNative("{}", 0.1)!).error).toMatch(/array/);
});