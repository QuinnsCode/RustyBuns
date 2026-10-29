// Checks one park file before it is wired into the picker, the way the tests will: every spawn sits on rideable
// ground inside the bounds, each named gap clears from its `<gap> run` spawn at 28 and 32 m/s with its bonus
// scored, the first spawn's tour (scripts/ride.ts) stays finite with the camera holding the board, and every
// trick on the list lands from the first spawn. Prints what fails and exits 1; `--quiet` prints only failures.
//
//   bun scripts/check.ts src/levels/zion.ts
import { resolve } from "node:path";
import { loadZone } from "@rustybuns/terrain";
import { trackRun } from "../src/levels/goals.ts";
import { parkLevel, type ParkLevel, type ParkSpec } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { TRICKS, type Flick } from "../src/tricks.ts";
import { ride } from "./ride.ts";

const file = process.argv[2], quiet = process.argv.includes("--quiet");
if (!file) { console.error("usage: bun scripts/check.ts src/levels/<park>.ts"); process.exit(2); }
const mod = await import(resolve(file)), spec = Object.values(mod).find((v) => v && typeof v === "object" && "zone" in (v as object)) as ParkSpec | undefined;
if (!spec) { console.error(`${file} exports no park spec`); process.exit(2); }
const l = parkLevel(spec, await loadZone(spec.zone), false), bad: string[] = [], ok: string[] = [];
const say = (good: boolean, line: string) => (good ? ok : bad).push(line);

// Spawns, as levels.test.ts checks them.
for (const sp of l.spawns) {
  const inside = sp.x > l.bounds.minX && sp.x < l.bounds.maxX && sp.z > l.bounds.minZ && sp.z < l.bounds.maxZ, h = l.height(sp.x, sp.z);
  const flat = [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([dx, dz]) => Math.abs(l.height(sp.x + dx!, sp.z + dz!) - h) < 0.75);
  say(inside && Number.isFinite(h) && flat, `spawn "${sp.name}" at (${sp.x}, ${sp.z}): ${inside ? "inside" : "OUTSIDE the bounds"}, ${flat ? "rideable" : "too steep (over 0.5 slope)"}`);
}
say(l.goals.length >= 3 && l.goals.length <= 5, `${l.goals.length} goals (3 to 5)`);
for (const g of l.goals) if (g.kind === "gap") say(l.gaps.some((x) => x.name === g.name), `gap goal "${g.name}" names a gap`);

// Gaps, driven as levels.test.ts drives them: steer at the launch, jump 3 to 8 m past its centre.
function drive(spawn: string, gapName: string, line: number) {
  const sp = l.spawns.find((p) => p.name === spawn)!, g = l.gaps.find((x) => x.name === gapName)!;
  const s = start(sp.x, sp.z, sp.yaw, l), run = trackRun(l), lv = { ...l, obstacles: l.trees };
  for (let i = 0; i < 20 * 60; i++) {
    const aim = Math.atan2(g.a.x - s.x, g.a.z - s.z), err = Math.atan2(Math.sin(aim - s.yaw), Math.cos(aim - s.yaw));
    const along = (s.x - g.a.x) * Math.sin(s.yaw) + (s.z - g.a.z) * Math.cos(s.yaw);
    step(s, { ...IDLE, throttle: s.speed < line ? 1 : -1, boost: !s.air && s.speed < line, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: along > 3 && along < 8 && !s.air }, lv);
    run.update(s);
  }
  return { s, run };
}
for (const g of l.gaps) {
  const spawn = l.spawns.find((p) => p.name === `${g.name} run`)?.name;
  if (!spawn) { say(false, `gap "${g.name}" has no "${g.name} run" spawn`); continue; }
  for (const line of [28, 32]) {
    const { s, run } = drive(spawn, g.name, line), n = run.gaps.get(g.name) ?? 0;
    say(n >= 1 && s.score >= g.bonus && run.bestCombo > 0, `gap "${g.name}" at ${line} m/s: cleared ${n} time${n === 1 ? "" : "s"}, score ${Math.round(s.score)} (bonus ${g.bonus}), best combo ${run.bestCombo}`);
  }
}

// The first spawn's tour, as test/ride.ts checks it.
const r = ride(l, 1);
say(!r.badNumbers && r.outOfBounds === 0 && r.cameraBelowGround === 0 && r.cameraFar === 0 && r.reached > 0 && r.bestCombo > 0,
  `tour from "${l.spawns[0]!.name}": reached ${r.reached}, stops ${r.stops}, bails ${r.bails}, out of bounds ${r.outOfBounds}, camera below ground ${r.cameraBelowGround}, camera far ${r.cameraFar}, best combo ${r.bestCombo}${r.badNumbers ? ", NaN in the sim" : ""}`);
for (const p of r.punch) ok.push(`  punch: ${p}`);

// Every trick from the first spawn, as tricklist.test.ts checks it.
const failed: string[] = [];
for (const trick of Object.keys(TRICKS) as Flick[]) {
  const sp = l.spawns[0]!, s = start(sp.x, sp.z, sp.yaw, l), lv: ParkLevel = { ...l, obstacles: l.trees };
  let jumped = false, flicked = false, bailed = "", landed = false;
  for (let f = 0; f < 60 * 12 && !landed; f++) {
    const rolling = s.speed > 14 && !s.air && !jumped;
    if (rolling) jumped = true;
    const flick = s.air && s.airTime > 0.15 && !flicked ? trick : null;
    if (flick) flicked = true;
    step(s, { ...IDLE, throttle: 1, boost: !s.air && s.speed < 14, jump: rolling, flick }, lv);
    if (s.bail > 0) { bailed = s.last?.name ?? "bail"; break; }
    if (flicked && !s.air) landed = true;
  }
  if (bailed || !landed || !(s.last?.name ?? "").startsWith(trick)) failed.push(`${trick}: ${bailed || (landed ? `scored "${s.last?.name}"` : "never landed")}`);
}
say(failed.length === 0, failed.length ? `tricks from the first spawn: ${failed.join("; ")}` : "every trick lands from the first spawn");

if (!quiet) for (const line of ok) console.log(`ok   ${line}`);
for (const line of bad) console.log(`FAIL ${line}`);
console.log(bad.length ? `\n${spec.id}: ${bad.length} problem${bad.length === 1 ? "" : "s"}` : `\n${spec.id}: all good`);
process.exit(bad.length ? 1 : 0);
