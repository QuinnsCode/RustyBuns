// Reads a park's ground before a level is drawn on it: a height map in game coordinates (x east, z south, the
// signature spot at 0,0), the flat benches a street line fits on, and the drops a launch can fly off, found
// by riding each candidate lip with the sim at the speeds the tests use.
//
//   bun scripts/survey.ts zion            the map, benches, bowl spots and gaps, then a plan for template.ts's `streetPark`
//   bun scripts/survey.ts zion --relief 1  with another relief
//   bun scripts/survey.ts zion --quiet     just the plan
//   bun scripts/survey.ts zion --bench 1   the street on the next bench along (when the first does not ride well)
import { heightmapTerrain, loadZone } from "@rustybuns/terrain";
import { parkLevel, TERRAIN_SCALE, RELIEF, type ParkSpec } from "../src/levels/park.ts";
import { kicker } from "../src/levels/pieces.ts";
import { PARKS } from "../src/levels/parks.ts";
import { IDLE, start, step } from "../src/sim.ts";

const quiet = process.argv.includes("--quiet"), id = process.argv[2]!, rel = process.argv.indexOf("--relief");
const row = PARKS.find((p) => p.id === id);
const relief = rel > 0 ? Number(process.argv[rel + 1]) : row?.relief ?? RELIEF;
const zone = await loadZone(id), raw = heightmapTerrain(zone, TERRAIN_SCALE), R = raw.R;
const h = (x: number, z: number) => raw.height(x, z) * relief;
const slope = (x: number, z: number) => Math.hypot(h(x + 1, z) - h(x - 1, z), h(x, z + 1) - h(x, z - 1)) / 2;

// The map: one character per 20 m cell, heights in tenths of the park's range, '#' where it is steeper than 0.5.
const CELL = 20, n = Math.floor((2 * R - 40) / CELL);
let lo = Infinity, hi = -Infinity;
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = h(-R + 20 + i * CELL, -R + 20 + j * CELL); lo = Math.min(lo, v); hi = Math.max(hi, v); }
if (!quiet) console.log(`${id}: ${(2 * R).toFixed(0)} m across, ground ${lo.toFixed(1)} to ${hi.toFixed(1)} m at relief ${relief}\n`);
console.log("      " + Array.from({ length: n }, (_, i) => (i % 5 === 0 ? String(Math.round(-R + 20 + i * CELL)).padEnd(5).slice(0, 5) : "")).join("").slice(0, n * 1));
for (let j = 0; j < n; j++) {
  const z = -R + 20 + j * CELL;
  let line = String(Math.round(z)).padStart(5) + " ";
  for (let i = 0; i < n; i++) { const x = -R + 20 + i * CELL; line += slope(x, z) > 0.5 ? "#" : String(Math.min(9, Math.floor(((h(x, z) - lo) / Math.max(hi - lo, 1e-6)) * 10))); }
  console.log(line);
}

// Benches: a 150 m run along a heading whose height stays within 1.2 m and whose ground is under 0.15 slope, nearest the spot first.
const dirs = [0, 45, 90, 135].map((d) => (d * Math.PI) / 180);
const strips: { x: number; z: number; yaw: number; len: number; y: number }[] = [];
for (let z = -R + 40; z < R - 40; z += 10) for (let x = -R + 40; x < R - 40; x += 10) for (const yaw of dirs) {
  const ux = Math.sin(yaw), uz = Math.cos(yaw), y0 = h(x, z);
  let len = 0;
  for (let t = 0; t <= 200; t += 5) { const px = x + ux * t, pz = z + uz * t; if (Math.abs(px) > R - 20 || Math.abs(pz) > R - 20 || Math.abs(h(px, pz) - y0) > 1.2 || slope(px, pz) > 0.15) break; len = t; }
  if (len >= 150) strips.push({ x, z, yaw, len, y: y0 });
}
strips.sort((a, b) => Math.hypot(a.x + Math.sin(a.yaw) * 75, a.z + Math.cos(a.yaw) * 75) - Math.hypot(b.x + Math.sin(b.yaw) * 75, b.z + Math.cos(b.yaw) * 75));
console.log(`\nbenches (start, heading in degrees, length): ${strips.length} found`);
const shown: typeof strips = [];
for (const s of strips) { if (shown.length < 6 && shown.every((o) => Math.hypot(o.x - s.x, o.z - s.z) > 50)) shown.push(s); }
for (const s of shown) console.log(`  (${s.x}, ${s.z}) yaw ${((s.yaw * 180) / Math.PI).toFixed(0)} len ${s.len} y ${s.y.toFixed(1)}`);

// Bowl spots: a 44 m disc that is level (spread under 1.5 m, nowhere steeper than 0.12).
const discs: { x: number; z: number }[] = [];
for (let z = -R + 50; z < R - 50; z += 10) for (let x = -R + 50; x < R - 50; x += 10) {
  let ok = true;
  for (let a = 0; a < 16 && ok; a++) for (const r of [11, 22]) { const px = x + Math.cos(a * Math.PI / 8) * r, pz = z + Math.sin(a * Math.PI / 8) * r; if (Math.abs(h(px, pz) - h(x, z)) > 1.5 || slope(px, pz) > 0.12) { ok = false; break; } }
  if (ok) discs.push({ x, z });
}
discs.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));

// Gaps: a kicker on the lip of every drop of 5 m or more, ridden from 70 m back the way levels.test.ts rides a gap
// (steer at the launch, jump 3 to 8 m past its centre) at 24, 27 and 32 m/s.
const bare = (extra: ParkSpec["sites"]): ParkSpec => ({ id, name: id, blurb: "", zone: id, relief, scatter: false, earthworks: false, sites: extra, spawns: [{ name: "s", x: 0, z: 0, yaw: 0 }], goals: [] });
type Gap = { at: { x: number; z: number; yaw: number }; run: { x: number; z: number }; land: { x: number; z: number }; rb: number; min: number; flights: number[]; drop: number };
const gaps: Gap[] = [];
for (let z = -R + 90; z < R - 90; z += 20) for (let x = -R + 90; x < R - 90; x += 20) for (const yaw of Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4)) {
  const ux = Math.sin(yaw), uz = Math.cos(yaw);
  let edge = -1;
  for (let t = 0; t < 120; t += 3) if (h(x + ux * t, z + uz * t) - h(x + ux * (t + 30), z + uz * (t + 30)) > 5 && slope(x + ux * t, z + uz * t) < 0.2) { edge = t; break; }
  if (edge < 0) continue;
  const lip = { x: x + ux * edge, z: z + uz * edge }, d = 8 * 1.5, at = { x: Math.round(lip.x - ux * d / 2), z: Math.round(lip.z - uz * d / 2), yaw };
  const run = { x: Math.round(at.x - ux * 70), z: Math.round(at.z - uz * 70) };
  if (Math.abs(run.x) > R - 20 || Math.abs(run.z) > R - 20 || Math.abs(h(run.x, run.z) - h(at.x, at.z)) > 2.5 || [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].some(([dx, dz]) => Math.abs(h(run.x + dx!, run.z + dz!) - h(run.x, run.z)) > 0.5) || gaps.some((g) => Math.hypot(g.at.x - at.x, g.at.z - at.z) < 25)) continue;
  const level = parkLevel(bare([{ parts: [kicker(at, { w: 12, d: 16, h: 3.5, curve: 1.5, name: "k" })] }]), zone, false);
  const lands: { x: number; z: number; far: number }[] = [];
  for (const line of [24, 27, 32]) {
    const s = start(run.x, run.z, yaw, level);
    let air = false, off = { x: 0, z: 0 }, last: (typeof lands)[number] | null = null;
    for (let i = 0; i < 14 * 60; i++) {
      const err = Math.atan2(Math.sin(Math.atan2(at.x - s.x, at.z - s.z) - s.yaw), Math.cos(Math.atan2(at.x - s.x, at.z - s.z) - s.yaw)), along = (s.x - at.x) * ux + (s.z - at.z) * uz;
      step(s, { ...IDLE, throttle: s.speed < line ? 1 : -1, boost: !s.air && s.speed < line, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: along > 3 && along < 8 && !s.air }, { ...level, obstacles: [] });
      if (!air && s.air) off = { x: s.x, z: s.z };
      if (air && !s.air) { last = s.bail > 0 || Math.hypot(off.x - at.x, off.z - at.z) > 16 ? null : { x: s.x, z: s.z, far: Math.hypot(s.x - off.x, s.z - off.z) }; break; }
      air = s.air;
    }
    if (!last) break;
    lands.push(last);
  }
  if (lands.length < 3 || Math.min(...lands.map((l) => l.far)) < 45) continue;
  const mid = lands[1]!, rb = Math.ceil(Math.max(...lands.map((l) => Math.hypot(l.x - mid.x, l.z - mid.z))) + 6);
  gaps.push({ at, run, land: { x: Math.round(mid.x), z: Math.round(mid.z) }, rb, min: Math.floor(Math.min(...lands.map((l) => l.far)) * 0.8), flights: lands.map((l) => Math.round(l.far)), drop: h(at.x, at.z) - h(mid.x, mid.z) });
}
gaps.sort((a, b) => Math.hypot(a.at.x, a.at.z) - Math.hypot(b.at.x, b.at.z));
if (!quiet) {
  console.log(`\nbowl spots: ${discs.length} found, nearest ${discs.slice(0, 5).map((d) => `(${d.x}, ${d.z})`).join(" ")}`);
  console.log(`\ngaps (kicker, run-in, landing at 27 m/s, flights at 24/27/32): ${gaps.length} found`);
  for (const g of gaps.slice(0, 8)) console.log(`  kicker (${g.at.x}, ${g.at.z}) yaw ${((g.at.yaw * 180) / Math.PI).toFixed(0)} run (${g.run.x}, ${g.run.z}) lands (${g.land.x}, ${g.land.z}) rb ${g.rb} min ${g.min} flights ${g.flights.join("/")} drop ${g.drop.toFixed(0)}`);
}

// The plan: the street on the bench nearest the spot, a sky rail on another bench, a bowl and a gap clear of them.
const along = (s: { x: number; z: number; yaw: number }, len: number) => Array.from({ length: Math.floor(len / 15) + 1 }, (_, k) => ({ x: s.x + Math.sin(s.yaw) * k * 15, z: s.z + Math.cos(s.yaw) * k * 15 }));
const clear = (pts: { x: number; z: number }[], from: { x: number; z: number }[], d: number) => pts.every((p) => from.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > d));
const bench = (s: (typeof strips)[number], at: number) => ({ x: Math.round(s.x + Math.sin(s.yaw) * at), z: Math.round(s.z + Math.cos(s.yaw) * at), yaw: Math.round(s.yaw * 1000) / 1000 });
const skip = process.argv.indexOf("--bench"), distinct = strips.filter((s, i) => strips.slice(0, i).every((o) => Math.hypot(o.x - s.x, o.z - s.z) > 50));
const street = distinct[skip > 0 ? Number(process.argv[skip + 1]) : 0], taken = street ? along(street, 160) : [];
const sky = strips.find((s) => street && clear(along(s, 200), taken, 40));
const bowl = discs.find((d) => clear([d], taken, 45) && (!sky || clear([d], along(sky, 200), 45)));
const away = [...taken, ...(sky ? along(sky, 200) : []), ...(bowl ? [bowl] : [])];
const view = discs.find((d) => Math.hypot(d.x, d.z) > 50 && clear([d], away, 40));
const gap = gaps.find((g) => clear([g.at, g.land, g.run, { x: (g.at.x + g.land.x) / 2, z: (g.at.z + g.land.z) / 2 }], away, 40));
console.log(`\nplan for ${id}:`);
console.log(JSON.stringify({ street: street && bench(street, 0), sky: sky && bench(sky, 0), bowl: bowl && { x: Math.round(bowl.x), z: Math.round(bowl.z) }, gap: gap && { at: gap.at, run: gap.run, land: gap.land, rb: gap.rb, min: gap.min }, view: view && { x: Math.round(view.x), z: Math.round(view.z) } }).replace(/\n\s*/g, " "));
