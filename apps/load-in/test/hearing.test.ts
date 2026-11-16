// What you hear in the garage once the head is switched on: the cab gets quieter as you walk away, quieter and duller
// behind it, and goes silent when the head is switched off.
import { expect, test } from "bun:test";
import { hasSwitch, hear } from "../src/audio/hear.ts";
import { newWorld } from "../src/sim.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";

test("the cab falls 6 dB when you double the distance, dull behind, and out when the head goes off", () => {
  const w = newWorld();
  const on = new Set<string>();
  // The cab sits on the driveway at (0.9, 7.9) facing +z; its drivers are two thirds up its 0.76 m.
  const front = (d: number) => ({ x: 0.9, y: 0.49, z: 7.9 + d });
  const cab = (at = front(2)) => hear(w, on, undefined, at).speakers.find((s) => s.key === "cab-4x12")!;

  expect(cab()).toMatchObject({ fed: false, db: null });
  expect(hasSwitch("amp-head")).toBe(true);
  expect(hasSwitch("road-case-m")).toBe(false);

  on.add("amp-head");
  const near = cab().db!;
  expect(near - cab(front(4)).db!).toBeCloseTo(6, 0);
  expect(hear(w, on, undefined, front(2)).high).toBe(near);

  const behind = cab({ x: 0.9, y: 0.49, z: 7.9 - 2 });
  expect(near - behind.db!).toBeGreaterThan(10);
  expect(behind.brightHz).toBeLessThan(cab().brightHz);

  // At your own head, out on the driveway in front of it: it plays; switched off, nothing does.
  expect(hear(w, on).high).toBeGreaterThan(70);
  on.delete("amp-head");
  expect(hear(w, on)).toMatchObject({ high: null, low: null });
});

test("in the dive bar the sub has its own switch until cables, and the master fader moves what you hear", () => {
  const w = newWorld(DIVE_BAR);
  const on = new Set(["top-l", "sub"]);
  const at = { x: 0, y: 1.65, z: 6 };
  const loud = hear(w, on, undefined, at, { master: 0 });
  const quiet = hear(w, on, undefined, at, { master: -14 });
  expect(loud.speakers.filter((s) => s.fed).map((s) => s.key)).toEqual(["top-l", "sub"]);
  expect(loud.high! - quiet.high!).toBeCloseTo(14, 1);
  expect(loud.low).not.toBeNull();
});
