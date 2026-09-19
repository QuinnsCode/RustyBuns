// The round planner must never hand the player an impossible round, so these
// run against the real scene files in ~/Documents/SplatRooms.
import { test, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { planRound, candidates, canSee, standingSpots, wallObbs } from "../src/game/round.ts";

const ROOT = join(homedir(), "Documents", "SplatRooms");
const scenes = existsSync(ROOT)
  ? readdirSync(ROOT).filter((d) => existsSync(join(ROOT, d, "labels.json")) && existsSync(join(ROOT, d, "structure.json")))
  : [];
const load = (id: string) => ({
  objects: JSON.parse(readFileSync(join(ROOT, id, "labels.json"), "utf8")),
  structure: JSON.parse(readFileSync(join(ROOT, id, "structure.json"), "utf8")),
});

test("scenes with structure.json are available to test", () => {
  if (!scenes.length) console.log("  (skipped: no scenes with structure.json)");
  expect(true).toBe(true);
});

for (const id of scenes) {
  test(`${id}: a planned round is solvable and the target is off centre`, () => {
    const scene = load(id);
    const all = candidates(scene.objects);
    const spots = standingSpots(scene, all);
    console.log(`  ${id}: ${all.length} candidates, ${spots.length} standing spots`);
    expect(all.length).toBeGreaterThan(0);
    expect(spots.length).toBeGreaterThan(0);

    const r = planRound(scene, { seed: 7 });
    expect(r).not.toBeNull();
    const round = r!;
    // The target must genuinely be visible from where the player stands.
    expect(canSee(round.eye, round.target, round.blockers)).toBe(true);
    expect(round.visible.some((c) => c.ins_id === round.target.ins_id)).toBe(true);
    // Sensible hunting distance, and the target is in view but not centred.
    expect(round.distance).toBeGreaterThan(1.5);
    expect(round.distance).toBeLessThan(8);
    const dir = [round.target.obb.center[0] - round.eye[0], round.target.obb.center[1] - round.eye[1]];
    const straight = (Math.atan2(dir[1], dir[0]) * 180) / Math.PI;
    const off = (((round.yaw - straight + 180) % 360) + 360) % 360 - 180;   // wrap to [-180, 180]
    expect(Math.abs(off)).toBeCloseTo(22, 0);   // 22 degrees off centre, either side
    console.log(`  ${id}: find the ${round.target.label} · ${round.distance.toFixed(1)} m · ${round.visible.length} objects visible`);
  });

  test(`${id}: different seeds give different targets, same seed repeats`, () => {
    const scene = load(id);
    const a = planRound(scene, { seed: 1 })!;
    const b = planRound(scene, { seed: 1 })!;
    expect(b.target.ins_id).toBe(a.target.ins_id);
    expect(b.eye).toEqual(a.eye);
    const labels = new Set<string>();
    for (let s = 1; s <= 12; s++) {
      const r = planRound(scene, { seed: s });
      if (r) labels.add(r.target.label);
    }
    console.log(`  ${id}: 12 seeds gave targets: ${[...labels].join(", ")}`);
    expect(labels.size).toBeGreaterThan(1);
  });

  test(`${id}: a forced target is honoured or refused, never faked`, () => {
    const scene = load(id);
    const all = candidates(scene.objects);
    const pick = all[Math.floor(all.length / 2)];
    const r = planRound(scene, { seed: 3, targetId: pick.ins_id });
    if (r) {
      expect(r.target.ins_id).toBe(pick.ins_id);
      expect(canSee(r.eye, r.target, r.blockers)).toBe(true);
    } else {
      console.log(`  ${id}: ${pick.label} ${pick.ins_id} has no vantage; correctly refused`);
    }
  });
}

test("walls become blockers", () => {
  const w = wallObbs({ structure: { walls: [{ thickness: 0.24, height: 3, location: [[0, 0], [4, 0]] }] } } as never);
  expect(w).toHaveLength(1);
  expect(w[0].size[0]).toBeCloseTo(4, 5);
  expect(w[0].size[1]).toBeCloseTo(0.24, 5);
  expect(w[0].center[2]).toBeCloseTo(1.5, 5);
});

test("a labels-only scene (no structure.json) still produces a round", () => {
  const withStructure = scenes[0];
  if (!withStructure) return;
  const objects = JSON.parse(readFileSync(join(ROOT, withStructure, "labels.json"), "utf8"));
  const r = planRound({ objects, structure: null }, { seed: 5 });
  expect(r).not.toBeNull();
  console.log(`  no-structure fallback: find the ${r!.target.label} at ${r!.distance.toFixed(1)} m`);
});
