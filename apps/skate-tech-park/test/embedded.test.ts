// Journeys on the smooth bars: the sim drops a rider on one end and rides it to the other in a single grind,
// on a made-up hillside and on built parks.
import { expect, setDefaultTimeout, test } from "bun:test";
import { type Level, makeLevel, type Rail } from "../src/level.ts";
import { embeddedRail } from "../src/levels/embedded.ts";
import { DT, IDLE, start, step } from "../src/sim.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { level } from "./parks.ts";

setDefaultTimeout(60_000);

/** Put a rider on the first segment of a run of chained rails, steering to hold the balance, and say which segments the grind rode in order. */
function grindRun(lv: Level, rails: Rail[]) {
  const first = rails[0]!, yaw = Math.atan2(first.b.x - first.a.x, first.b.z - first.a.z), sk = start(first.a.x + Math.sin(yaw) * 0.2, first.a.z + Math.cos(yaw) * 0.2, yaw, lv);
  sk.grind = lv.rails.indexOf(first); sk.y = first.y; sk.speed = 26; sk.air = true; // on the bar's first end, as a grind entry leaves a rider
  const base = lv.rails.indexOf(first), seen: number[] = [];
  for (let i = 0; i < 8 / DT; i++) {
    step(sk, { ...IDLE, steer: Math.max(-1, Math.min(1, sk.balance * 3)) }, lv);
    if (sk.grind >= 0 && seen[seen.length - 1] !== sk.grind - base) seen.push(sk.grind - base);
    if (sk.grind < 0 && seen.length) break;
  }
  return seen;
}

test("a smooth bar set into a hillside is ridden end to end in one grind", () => {
  const hill = (x: number, z: number) => 0.2 * z + 0.4 * Math.sin(x / 7); // a slope with a swell across it
  for (const kind of ["contour", "dip", "bank", "emerge"] as const) {
    const bar = embeddedRail(hill, { x: 0, z: 0 }, kind === "dip" || kind === "emerge" ? Math.PI : Math.PI / 2, kind, 30)!;
    expect(bar).not.toBeNull();
    for (const r of bar.rails) expect(Math.min(r.y - hill(r.a.x, r.a.z), r.y2! - hill(r.b.x, r.b.z))).toBeGreaterThan(0.05); // never buried under the earth
    const lv = { ...makeLevel({ name: "t", pieces: [], rails: bar.rails, spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } }), height: hill };
    const seen = grindRun(lv, bar.rails);
    expect(seen).toEqual(bar.rails.map((_, i) => i)); // every segment in order: no drop at a joint
  }
});

test("each park has long smooth bars, and a rider grinds one from end to end", async () => {
  for (const id of ["zion", "yosemite-falls", "glacier", "everglades", "white-sands"]) {
    const lv = await level(id) as ParkLevel;
    const runs: Rail[][] = [];
    for (const r of lv.rails) {
      const run = runs[runs.length - 1], last = run?.[run.length - 1];
      if (r.chain && last && Math.hypot(last.b.x - r.a.x, last.b.z - r.a.z) < 0.05) run!.push(r); else runs.push([r]);
    }
    const long = runs.filter((r) => r.length >= 15 && r[0]!.kind !== "coping" && r.every((q) => q.y - lv.ground.height(q.a.x, q.a.z) < 1.4)); // set into the ground, not on stilts
    expect(long.length).toBeGreaterThanOrEqual(3);
    for (const bar of long.slice(0, 2)) expect(grindRun(lv, bar).length).toBe(bar.length); // one grind, every segment
  }
});
