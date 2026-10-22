// Rides every park end to end with a scripted rider and prints a punch list: a tour of each park's spawns, lines,
// gaps and pickups at speed, flicking tricks in the air, with the chase camera running so we can see where it
// loses the board. `bun scripts/ride.ts [park-id]`; `--json` for machine output.
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { Rail } from "../src/level.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { trackRun } from "../src/levels/goals.ts";
import { Chase } from "../src/render/chase.ts";
import { IDLE, start, step, type Input, type State } from "../src/sim.ts";
import { TRICKS, type Flick } from "../src/tricks.ts";

type Pt = { x: number; z: number };
export type Ride = {
  id: string; seconds: number; reached: number; stops: number; bails: number; snags: Pt[]; stuck: string[]; badNumbers: boolean; outOfBounds: number;
  bestCombo: number; chainMax: number; tricks: number; grinds: number; manuals: number; gaps: string[]; missedGaps: string[];
  cameraBelowGround: number; cameraFar: number; goals: string[]; punch: string[];
};

const FLICKS = Object.keys(TRICKS) as Flick[];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A run-in for a rail: a point 16 m back along the bar, then the bar's start, so the rider arrives lined up and can ollie on. */
function runIn(r: Rail): Pt[] {
  const len = Math.hypot(r.b.x - r.a.x, r.b.z - r.a.z) || 1, ux = (r.b.x - r.a.x) / len, uz = (r.b.z - r.a.z) / len;
  return [{ x: r.a.x - ux * 16, z: r.a.z - uz * 16 }, { x: r.a.x + ux * 3, z: r.a.z + uz * 3 }];
}

/** What a rider can see from a spawn: lines, gap launches and pickups within 150 m, nearest first, six at most. */
export function tour(l: ParkLevel, from: Pt): Pt[] {
  const todo: Pt[] = [...l.routes.flatMap((r) => r.points), ...l.gaps.map((g) => g.a), ...l.pickups, ...l.rails.filter((r) => r.kind !== "coping").flatMap(runIn)].filter((p) => Math.hypot(p.x - from.x, p.z - from.z) < 150);
  const out: Pt[] = [];
  let at = from;
  while (todo.length && out.length < 8) {
    todo.sort((p, q) => Math.hypot(p.x - at.x, p.z - at.z) - Math.hypot(q.x - at.x, q.z - at.z));
    at = todo.shift()!; out.push(at);
  }
  return out;
}

/** Snags grouped into 8 m cells, worst first, each with the nearest thing standing there. */
function snagSpots(l: ParkLevel, snags: Pt[]): string[] {
  const cells = new Map<string, { x: number; z: number; n: number }>();
  for (const p of snags) {
    const k = `${Math.round(p.x / 8)},${Math.round(p.z / 8)}`, c = cells.get(k) ?? { x: p.x, z: p.z, n: 0 };
    c.n++; cells.set(k, c);
  }
  const things = [...l.trees.map((t) => ({ x: t.x, z: t.z, name: "tree" })), ...l.pieces.map((p) => ({ x: p.x, z: p.z, name: p.name })), ...l.landmarks.map((m) => ({ x: (m as any).x ?? 0, z: (m as any).z ?? 0, name: m.kind }))];
  return [...cells.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((c) => {
    const t = things.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z))[0];
    return `snag x${c.n} at (${c.x.toFixed(0)}, ${c.z.toFixed(0)}), nearest ${t ? `${t.name} ${Math.hypot(t.x - c.x, t.z - c.z).toFixed(0)} m off` : "nothing"}, ground ${l.height(c.x, c.z).toFixed(1)}`;
  });
}

export function ride(l: ParkLevel, spawns = l.spawns.length): Ride {
  const run = trackRun(l), cam = new THREE.PerspectiveCamera(66, 16 / 9, 0.1, 2000), chase = new Chase(cam), V = new THREE.Vector3();
  const r: Ride = { id: l.id, seconds: 0, reached: 0, stops: 0, bails: 0, snags: [], stuck: [], badNumbers: false, outOfBounds: 0, bestCombo: 0, chainMax: 0, tricks: 0, grinds: 0, manuals: 0, gaps: [], missedGaps: [], cameraBelowGround: 0, cameraFar: 0, goals: [], punch: [] };
  const lv = { ...l, obstacles: l.trees }; // the rider steers by line, not by sensing: a handrail post on the line is not the point
  for (const sp of l.spawns.slice(0, spawns)) {
    const s = start(sp.x, sp.z, sp.yaw, l), walk = tour(l, sp);
    chase.snap(s, "fingerboard");
    r.stops += walk.length;
    let i = 0, since = 0, prevBail = 0, prevGrind = -1, prevManual = 0, flicked = false, lastTrick: State["last"] = null, back = 0, backDir = 1, fast = 0;
    // a spawn with nothing in reach is just ridden straight ahead for 20 s
    for (let f = 0; f < (walk.length ? walk.length * 50 : 20) * 60 && (i < walk.length || !walk.length); f++) {
      const to = walk[i] ?? { x: s.x + Math.sin(s.yaw) * 500, z: s.z + Math.cos(s.yaw) * 500 }, aim = Math.atan2(to.x - s.x, to.z - s.z), err = wrap(aim - s.yaw);
      if (walk.length && Math.hypot(to.x - s.x, to.z - s.z) < 4) { i++; since = 0; r.reached++; continue; }
      since += 1 / 60;
      if (since > 45) { r.stuck.push(`${sp.name}: never got to (${to.x.toFixed(0)}, ${to.z.toFixed(0)}), ended at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}) after ${s.t.toFixed(0)}s`); i++; since = 0; continue; }
      const near = l.gaps.find((g) => Math.hypot(s.x - g.a.x, s.z - g.a.z) < 12), rail = l.rails.find((q) => { const d = Math.hypot(s.x - q.a.x, s.z - q.a.z); return d > 8 && d < 11 && Math.abs(wrap(s.yaw - Math.atan2(q.b.x - q.a.x, q.b.z - q.a.z))) < 0.25; }), hop = !s.air && ((near && Math.hypot(s.x - near.a.x, s.z - near.a.z) < 6) || rail);
      // wedged against something: back out and turn away for a second, then carry on
      if (back > 0) back -= 1 / 60;
      else if (!s.air && s.bail <= 0 && fast > 1 && Math.abs(s.speed) < 1.5) { back = 1; backDir = err > 0 ? -1 : 1; r.snags.push({ x: s.x, z: s.z }); }
      fast = Math.abs(s.speed) > 8 ? 2 : Math.max(0, fast - 1 / 60);
      const inp: Input = back > 0 ? { ...IDLE, throttle: -1, steer: backDir } : {
        ...IDLE, throttle: s.speed < 24 ? 1 : -1, boost: !s.air && s.speed < 24, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: !!hop,
        flick: s.air && s.airTime > 0.25 && !flicked ? FLICKS[(r.tricks + Math.floor(s.t)) % FLICKS.length]! : null,
        manual: !s.air && s.speed > 12 && Math.abs(err) < 0.1 && Math.floor(s.t / 3) % 5 === 0 ? 1 : 0,
      };
      if (s.air && s.airTime > 0.25) flicked = true;
      if (!s.air) flicked = false;
      step(s, inp, lv); run.update(s);
      chase.update(s, "fingerboard", 1 / 60); chase.apply(l.bounds, l.height);
      if (![s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.speed].every(Number.isFinite)) { r.badNumbers = true; break; }
      if (s.x < l.bounds.minX || s.x > l.bounds.maxX || s.z < l.bounds.minZ || s.z > l.bounds.maxZ) r.outOfBounds++;
      if (cam.position.y < l.height(cam.position.x, cam.position.z) + 0.1) r.cameraBelowGround++;
      if (cam.position.distanceTo(V.set(s.x, s.y, s.z)) > 30) r.cameraFar++;
      if (s.bail > 0 && prevBail <= 0) r.bails++;
      if (s.grind >= 0 && prevGrind < 0) r.grinds++;
      if (s.manual && !prevManual) r.manuals++;
      if (s.last && s.last !== lastTrick) { lastTrick = s.last; if (/flip|shove|varial|hard|laser|tre|heel/i.test(s.last.name)) r.tricks++; }
      r.chainMax = Math.max(r.chainMax, s.chain);
      prevBail = s.bail; prevGrind = s.grind; prevManual = s.manual; r.seconds += 1 / 60;
    }
  }
  r.bestCombo = run.bestCombo;
  r.gaps = [...run.gaps.keys()]; r.missedGaps = l.gaps.map((g) => g.name).filter((n) => !run.gaps.has(n));
  r.goals = l.goals.map((g) => `${run.done(g) ? "done" : "open"}: ${"name" in g ? g.name : g.kind} ${run.progress(g)}`);
  const P = r.punch;
  if (r.badNumbers) P.push("sim produced NaN/Infinity");
  if (r.outOfBounds) P.push(`rider left the bounds for ${r.outOfBounds} steps`);
  P.push(...r.stuck.map((x) => `unreachable: ${x}`), ...snagSpots(l, r.snags));
  if (r.cameraBelowGround) P.push(`camera under the ground for ${r.cameraBelowGround} frames`);
  if (r.cameraFar) P.push(`camera more than 30 m from the board for ${r.cameraFar} frames`);
  if (!r.grinds) P.push("no grind caught");
  return r;
}

if (import.meta.main) {
  const only = process.argv.slice(2).find((a) => !a.startsWith("--")), json = process.argv.includes("--json");
  const rides = [];
  for (const e of LEVELS.filter((e) => e.id !== "plaza" && (!only || e.id === only))) rides.push(ride((await e.load()) as ParkLevel));
  if (json) console.log(JSON.stringify(rides, null, 2));
  else for (const r of rides) {
    console.log(`\n${r.id}: ${r.seconds.toFixed(0)}s, ${r.reached}/${r.stops} stops, ${r.bails} bails, ${r.grinds} grinds, ${r.manuals} manuals, ${r.tricks} tricks, chain x${r.chainMax}, combo ${r.bestCombo}`);
    for (const g of r.goals) console.log(`  goal ${g}`);
    for (const p of r.punch) console.log(`  PUNCH ${p}`);
  }
}
