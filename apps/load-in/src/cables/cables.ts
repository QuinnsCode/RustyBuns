// Cables: take one out of the road case, walk its end out (it drags behind you as a rope, and at its full length it
// stops you), plug it into a jack of its kind, and lay a cable ramp over it where it crosses a walkway. The patch
// (who is fed, what is wrong) is @rustybuns/gear's `compile`; the jacks are where the models in @rustybuns/models put them.
import { assist } from "../assists.ts";
import { CIRCUIT_15A, CIRCUIT_20A, cableFor, compile, gear, jackKind, jackNames, type Cable, type CableKind, type End, type Placed } from "@rustybuns/gear";
import { GEAR_SIZES, gear as model, gearJacks, type GearId } from "@rustybuns/models/gear";
import { Vector3 } from "three";
import { EYE, EYE_CROUCH, LOW, REACH, dims, facing, holdPose, walkTo, type Answer, type Item, type World } from "../sim.ts";
import { switchedOnIsFed, type Fed } from "../audio/hear.ts";
import { THICK, newRope, pathLength, stepRope, type Rope, type Solid, type Vec } from "./rope.ts";

/** Where a cable's end is: in a jack, in your hand, lying loose, or still coiled in the case. */
export type EndAt = { plug: End } | { hand: true } | { loose: true } | { case: true };
export interface Run { key: string; kind: CableKind; lengthM: number; a: EndAt; b: EndAt; rope: Rope | null }
export interface Cables { runs: Run[]; caseKey: string | null }

/** What the road case holds when you open it. */
export const CASE_LOAD: readonly { key: string; kind: CableKind; lengthM: number }[] = [
  { key: "power-10", kind: "power", lengthM: 10 },
  { key: "speaker-10", kind: "speaker", lengthM: 10 },
  { key: "inst-6", kind: "instrument", lengthM: 6 },
];

export function newCables(w: World): Cables {
  return {
    caseKey: w.items.find((i) => i.gear === "road-case-m")?.key ?? null,
    runs: (w.level.caseLoad ?? CASE_LOAD).map((c) => ({ ...c, a: { case: true }, b: { case: true }, rope: null })),
  };
}

const isPlug = (e: EndAt): e is { plug: End } => "plug" in e;
const isHand = (e: EndAt) => "hand" in e;
const inCase = (e: EndAt) => "case" in e;
/** The run whose end is in your hand, and which end. */
export function inHand(c: Cables): { run: Run; end: "a" | "b" } | null {
  for (const run of c.runs) {
    if (isHand(run.a)) return { run, end: "a" };
    if (isHand(run.b)) return { run, end: "b" };
  }
  return null;
}
/** Whether your hands hold anything: a piece of gear or a cable end. */
export const handsFull = (w: World, c: Cables) => !!w.held || !!inHand(c);

/** Whether @rustybuns/models has a model for this gear id. */
export const hasModel = (id: string): id is GearId => Object.hasOwn(GEAR_SIZES, id);

// Each model's jacks, in its own frame: where a plug goes in, a touch out from the panel.
const jackCache = new Map<string, Map<string, Vec>>();
function jacksOf(gearId: string): Map<string, Vec> {
  let m = jackCache.get(gearId);
  if (!m) {
    m = new Map();
    if (hasModel(gearId)) for (const [name, o] of gearJacks(model(gearId))) {
      const out = new Vector3(0, 0, 1).applyQuaternion(o.quaternion);
      m.set(name, { x: o.position.x + out.x * 0.03, y: o.position.y + out.y * 0.03, z: o.position.z + out.z * 0.03 });
    }
    jackCache.set(gearId, m);
  }
  return m;
}

const poseOf = (w: World, i: Item) => (i.key === w.held?.key ? holdPose(w) ?? i : i);

/** Every jack in the level, where it is now: the gear's (moving with it when carried) and the wall outlets'. */
export function jacks(w: World): { owner: string; jack: string; at: Vec }[] {
  const out: { owner: string; jack: string; at: Vec }[] = [];
  for (const i of w.items) {
    const p = poseOf(w, i), c = Math.cos(p.rot), s = Math.sin(p.rot);
    for (const [jack, l] of jacksOf(i.gear)) out.push({ owner: i.key, jack, at: { x: p.x + l.x * c + l.z * s, y: p.y + l.y, z: p.z - l.x * s + l.z * c } });
  }
  for (const o of w.level.outlets) for (const [n, dy] of [[1, 0.03], [2, -0.03]] as const) out.push({ owner: o.key, jack: `power-out-${n}`, at: { x: o.x, y: o.y + dy, z: o.z + 0.02 } });
  return out;
}
const jackAt = (w: World, owner: string, jack: string) => jacks(w).find((j) => j.owner === owner && j.jack === jack)?.at ?? null;

/** Where your hand holds a cable end. */
export const handAt = (w: World): Vec => {
  const f = facing(w.you.yaw);
  return { x: w.you.x + f.x * 0.35, y: w.you.crouch ? 0.55 : 0.95, z: w.you.z + f.z * 0.35 };
};
function caseTop(w: World, c: Cables): Vec | null {
  const i = w.items.find((x) => x.key === c.caseKey);
  if (!i) return null;
  const p = poseOf(w, i);
  return { x: p.x, y: p.y + dims(i)[1] + THICK, z: p.z };
}
function pinOf(w: World, c: Cables, e: EndAt): Vec | undefined {
  if (isHand(e)) return handAt(w);
  if (inCase(e)) return caseTop(w, c) ?? undefined;
  if (isPlug(e)) return jackAt(w, e.plug[0], e.plug[1]) ?? undefined;
  return undefined;
}
/** Where an end is now: its pin, or the rope's last point if it lies loose. */
function endAt(w: World, c: Cables, run: Run, end: "a" | "b"): Vec | null {
  const pin = pinOf(w, c, run[end]);
  if (pin) return pin;
  const pts = run.rope?.pts;
  return pts ? (end === "a" ? pts[0]! : pts[pts.length - 1]!) : null;
}
const near = (w: World, p: Vec, reach = REACH) => Math.hypot(p.x - w.you.x, p.z - w.you.z) <= reach;

const solids = (w: World): Solid[] =>
  w.items.filter((i) => i.key !== w.held?.key).map((i) => { const [sw, h, d] = dims(i); return { x: i.x, y: i.y, z: i.z, rot: i.rot, w: sw, h, d }; });

/** One tick: a held end can't go farther than the cable reaches (it stops you), then every laid-out cable settles. */
export function stepCables(w: World, c: Cables, dt: number) {
  const h = inHand(c);
  if (h) {
    const other = pinOf(w, c, h.run[h.end === "a" ? "b" : "a"]);
    if (other) {
      // Measure from your hand: past the cable's length, you are pulled back to it.
      const hand = handAt(w), reach = h.run.lengthM * 0.98 + assist("cableSlack"), dx = hand.x - other.x, dz = hand.z - other.z;
      const flat = Math.sqrt(Math.max(0, reach * reach - (hand.y - other.y) ** 2)), d = Math.hypot(dx, dz);
      if (d > flat) { w.you.x -= (dx / d) * (d - flat); w.you.z -= (dz / d) * (d - flat); }
    }
  }
  const s = solids(w);
  for (const run of c.runs) if (run.rope) stepRope(run.rope, dt, { a: pinOf(w, c, run.a), b: pinOf(w, c, run.b) }, s);
}

/** Walk to (x, z) with the cables dragging behind you; the seconds it took. */
export const walkWith = (w: World, c: Cables, x: number, z: number) => walkTo(w, x, z, 120, (dt) => stepCables(w, c, dt));

/** Stand still for `seconds` while the cables settle. */
export function settle(w: World, c: Cables, seconds = 2) {
  for (let t = 0; t < seconds; t += 1 / 60) stepCables(w, c, 1 / 60);
}

/** Take the next coiled cable out of the case, its `a` end in your hand (or the one of `kind`). */
export function takeCable(w: World, c: Cables, kind?: CableKind): Answer {
  const top = caseTop(w, c);
  if (!top) return { ok: false, why: "no cable case here" };
  if (handsFull(w, c)) return { ok: false, why: "your hands are full" };
  if (!near(w, top)) return { ok: false, why: "the cable case is out of reach" };
  const run = c.runs.find((r) => !r.rope && (!kind || r.kind === kind));
  if (!run) return { ok: false, why: kind ? `no ${kind} cable left in the case` : "the case is empty" };
  run.rope = newRope(run.lengthM, top);
  run.a = { hand: true };
  run.b = { case: true };
  return { ok: true };
}

/** Pick up a cable's end where it is: still in the case, lying loose, or in a jack (that unplugs it). */
export function grabEnd(w: World, c: Cables, key: string, end: "a" | "b"): Answer {
  const run = c.runs.find((r) => r.key === key);
  if (!run?.rope) return { ok: false, why: `no ${key} laid out` };
  if (handsFull(w, c)) return { ok: false, why: "your hands are full" };
  const at = endAt(w, c, run, end);
  if (!at || !near(w, at)) return { ok: false, why: `that end of ${key} is out of reach` };
  run[end] = { hand: true };
  return { ok: true };
}

/** Plug the end in your hand into `owner`'s `jack`: in reach, free, and the kind this cable fits. */
export function plug(w: World, c: Cables, owner: string, jack: string): Answer {
  const h = inHand(c);
  if (!h) return { ok: false, why: "no cable in your hand" };
  const at = jackAt(w, owner, jack);
  if (!at) return { ok: false, why: `no ${jack} on ${owner}` };
  if (!near(w, at)) return { ok: false, why: `${owner} ${jack} is out of reach` };
  const fits = cableFor(jackKind(jack));
  if (fits !== h.run.kind) return { ok: false, why: `a ${h.run.kind} cable doesn't fit ${jack} (it takes ${fits})` };
  const taken = c.runs.some((r) => [r.a, r.b].some((e) => isPlug(e) && e.plug[0] === owner && e.plug[1] === jack));
  if (taken) return { ok: false, why: `${owner} ${jack} already has a cable in it` };
  h.run[h.end] = { plug: [owner, jack] };
  return { ok: true };
}

/** Pull a plug out of `owner`'s `jack` into your hand. */
export function unplug(w: World, c: Cables, owner: string, jack: string): Answer {
  for (const run of c.runs) for (const end of ["a", "b"] as const) {
    const e = run[end];
    if (isPlug(e) && e.plug[0] === owner && e.plug[1] === jack) return grabEnd(w, c, run.key, end);
  }
  return { ok: false, why: `nothing plugged into ${owner} ${jack}` };
}

/** Let go of the end in your hand: it drops where it is, or (the autoCoil assist) with neither end plugged in, it coils itself back into the case. */
export function dropEnd(c: Cables): Answer {
  const h = inHand(c);
  if (!h) return { ok: false, why: "no cable in your hand" };
  h.run[h.end] = { loose: true };
  if (assist("autoCoil") && !isPlug(h.run.a) && !isPlug(h.run.b)) Object.assign(h.run, { rope: null, a: { case: true }, b: { case: true } });
  return { ok: true };
}

/** Coil a cable back into the case: neither end in a jack, and you by the case. */
export function coil(w: World, c: Cables, key: string): Answer {
  const run = c.runs.find((r) => r.key === key), top = caseTop(w, c);
  if (!run?.rope) return { ok: false, why: `${key} is already coiled` };
  if (isPlug(run.a) || isPlug(run.b)) return { ok: false, why: `unplug ${key} first` };
  if (!top || !near(w, top)) return { ok: false, why: "the cable case is out of reach" };
  Object.assign(run, { rope: null, a: { case: true }, b: { case: true } });
  return { ok: true };
}

/** Lay a ramp you just set down end to end with one it was put next to: same line, ends touching. */
export function linkRamp(w: World, key: string): boolean {
  const r = w.items.find((i) => i.key === key);
  if (!r || r.gear !== "cable-ramp-2ch" || !assist("rampSnap")) return false;
  const len = dims(r)[0];
  for (const o of w.items) {
    if (o === r || o.gear !== "cable-ramp-2ch" || Math.abs(o.y - r.y) > 0.01) continue;
    const ax = { x: Math.cos(o.rot), z: -Math.sin(o.rot) }, dx = r.x - o.x, dz = r.z - o.z;
    const along = dx * ax.x + dz * ax.z, across = -dx * ax.z + dz * ax.x;
    const turn = Math.abs(Math.sin(r.rot - o.rot));
    if (Math.abs(Math.abs(along) - len) > 0.35 || Math.abs(across) > 0.3 || turn > 0.5) continue;
    const side = Math.sign(along) || 1;
    Object.assign(r, { rot: o.rot, x: o.x + ax.x * side * len, z: o.z + ax.z * side * len });
    return true;
  }
  return false;
}

/** Cables lying across a walkway with no ramp over them: trip hazards, one per cable per walkway. */
export function hazards(w: World, c: Cables): { cable: string; walkway: string; x: number; z: number }[] {
  const ramps = w.items.filter((i) => i.gear === "cable-ramp-2ch" && i.key !== w.held?.key && dims(i)[1] < LOW);
  const covered = (p: Vec) => ramps.some((r) => {
    const [rw, , rd] = dims(r), cs = Math.cos(r.rot), sn = Math.sin(r.rot), dx = p.x - r.x, dz = p.z - r.z;
    return Math.abs(dx * cs - dz * sn) <= rw / 2 + 0.1 && Math.abs(dx * sn + dz * cs) <= rd / 2 + 0.1;
  });
  const out: { cable: string; walkway: string; x: number; z: number }[] = [];
  for (const run of c.runs) {
    if (!run.rope) continue;
    for (const way of w.level.walkways ?? []) {
      const on = run.rope.pts.filter((p) => p.y < 0.03 && p.x >= way.x0 && p.x <= way.x1 && p.z >= way.z0 && p.z <= way.z1 && !covered(p));
      if (!on.length) continue;
      const m = on[Math.floor(on.length / 2)]!;
      out.push({ cable: run.key, walkway: way.name, x: cm(m.x), z: cm(m.z) });
    }
  }
  return out;
}

/** What compile reads: the gear with jacks, and every cable with both ends in jacks. */
export function plugged(w: World, c: Cables): { placed: Placed[]; runs: Cable[] } {
  const runs: Cable[] = [];
  for (const r of c.runs) if (isPlug(r.a) && isPlug(r.b)) runs.push({ kind: r.kind, lengthM: r.lengthM, from: r.a.plug, to: r.b.plug });
  return { placed: w.items.filter((i) => jackNames(gear(i.gear)).length).map((i) => ({ id: i.key, gear: i.gear })), runs };
}

/** The free jacks that would take the cable in your hand: what the jackGlow assist lights up. */
export function glowing(w: World, c: Cables): Vec[] {
  const h = inHand(c);
  if (!h || !assist("jackGlow")) return [];
  const used = new Set(c.runs.flatMap((r) => [r.a, r.b].filter(isPlug).map((e) => e.plug.join(" "))));
  return jacks(w).filter((j) => cableFor(jackKind(j.jack)) === h.run.kind && !used.has(`${j.owner} ${j.jack}`)).map((j) => j.at);
}

/** A breaker nothing in a small venue can trip, for the stops where breakers don't. */
const NO_TRIP = { volts: 120, amps: 1000 };

/** The patch as @rustybuns/gear reads it: what is fed, and what is wrong (only cables with both ends in jacks count). */
export function patch(w: World, c: Cables) {
  const { placed, runs } = plugged(w, c);
  const outlets = w.level.outlets.map((o) => ({ id: o.key, circuit: o.circuit ?? w.level.name, breaker: !assist("breakersTrip") ? NO_TRIP : o.amps === 20 ? CIRCUIT_20A : CIRCUIT_15A }));
  const { fed, problems } = compile(placed, runs, { outlets });
  return { fed: Object.fromEntries(fed), problems: problems.map((p) => p.message) };
}

/**
 * Who plays, for `hear()`: a speaker switched on with no cable in it plays (the cozy way, a switch is enough); once a
 * cable goes into one of its jacks, the patch must feed it too (power and signal, the amp holding, nothing tripped).
 */
export function fedBy(w: World, c: Cables): Fed {
  const { fed } = patch(w, c);
  const cabled = new Set(c.runs.flatMap((r) => [r.a, r.b]).filter(isPlug).map((e) => e.plug[0]));
  return (world, key, on) => switchedOnIsFed(world, key, on) && (!cabled.has(key) || fed[key] === true);
}

/** The jack you look at, in reach: what a click plugs into or pulls out of. */
export function aimedJack(w: World): { owner: string; jack: string } | null {
  const eye = { x: w.you.x, y: w.you.crouch ? EYE_CROUCH : EYE, z: w.you.z }, f = facing(w.you.yaw), cp = Math.cos(w.you.pitch);
  const look = { x: f.x * cp, y: Math.sin(w.you.pitch), z: f.z * cp };
  let best: { owner: string; jack: string } | null = null, bestDot = 0.96;
  for (const j of jacks(w)) {
    if (j.owner === w.held?.key) continue;
    const dx = j.at.x - eye.x, dy = j.at.y - eye.y, dz = j.at.z - eye.z, d = Math.hypot(dx, dy, dz);
    if (d > REACH + 0.6 || d < 1e-3) continue;
    const dot = (dx * look.x + dy * look.y + dz * look.z) / d;
    if (dot > bestDot) best = { owner: j.owner, jack: j.jack }, bestDot = dot;
  }
  return best;
}

/** The F key for cables: plug, unplug, pick up an end, coil, take one from the case. Null when it's a job for the gear. */
export function use(w: World, c: Cables, aimedItem: Item | null): Answer | null {
  const h = inHand(c), j = aimedJack(w);
  if (h) {
    if (j) return plug(w, c, j.owner, j.jack);
    if (aimedItem?.key === c.caseKey && !isPlug(h.run.a) && !isPlug(h.run.b)) return coil(w, c, h.run.key);
    return dropEnd(c);
  }
  if (w.held) return null;
  if (j && c.runs.some((r) => [r.a, r.b].some((e) => isPlug(e) && e.plug[0] === j.owner && e.plug[1] === j.jack))) return unplug(w, c, j.owner, j.jack);
  for (const run of c.runs) for (const end of ["a", "b"] as const) {
    const at = run.rope && "loose" in run[end] ? endAt(w, c, run, end) : null;
    if (at && near(w, at, 1.0)) return grabEnd(w, c, run.key, end);
  }
  if (aimedItem?.key === c.caseKey) {
    const left = c.runs.find((r) => !r.rope);
    if (left) return takeCable(w, c);
    const wait = c.runs.find((r) => r.rope && inCase(r.b));
    if (wait) return grabEnd(w, c, wait.key, "b");
  }
  return null;
}

const cm = (v: number) => Math.round(v * 100) / 100;
const endName = (e: EndAt) => (isPlug(e) ? `${e.plug[0]} ${e.plug[1]}` : isHand(e) ? "hand" : inCase(e) ? "case" : "loose");

/** What `loadIn.state()` says about cables: each run's ends and slack, the hazards, and the patch. */
export function cableState(w: World, c: Cables) {
  return {
    cables: c.runs.map((r) => ({
      key: r.key, kind: r.kind, lengthM: r.lengthM, coiled: !r.rope, a: endName(r.a), b: endName(r.b),
      slack: r.rope ? cm(r.lengthM - Math.hypot(...(["x", "y", "z"] as const).map((k) => r.rope!.pts[0]![k] - r.rope!.pts[r.rope!.pts.length - 1]![k]))) : null,
      laid: r.rope ? cm(pathLength(r.rope)) : 0,
    })),
    hazards: hazards(w, c),
    ...patch(w, c),
  };
}
