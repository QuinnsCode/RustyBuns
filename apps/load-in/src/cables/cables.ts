// Cables: each comes out of the road case as a roll (roll.ts) at its real weight. Carry the roll to where the run
// starts, plug its end, bowl the coil (it pays out as it goes), pick it up where it stopped, carry the rest and plug it
// in: the spare stays coiled under the jack. Or pull an end off a roll that sits on the case and walk it out. The `b`
// end is the coil's inner end, so wherever `b` is (case, hand, floor, jack), the coil is. At its full length a cable
// stops you, and what it weighs slows you. Lay a ramp over it where it crosses a walkway. The patch (who is fed, what
// is wrong) is @rustybuns/gear's `compile`; the jacks are where the models in @rustybuns/models put them.
import { mulberry32 } from "@rustybuns/util";
import { assist } from "../assists.ts";
import { CABLE, ROLL_R, bowl as bowlRoll, leftM, newRoll, rollKg, rollKind, stepRoll, type Roll } from "./roll.ts";
import { CIRCUIT_15A, CIRCUIT_20A, cableFor, compile, gear, jackKind, jackNames, type Cable, type CableKind, type End, type Placed } from "@rustybuns/gear";
import { GEAR_SIZES, gear as model, gearJacks, type GearId } from "@rustybuns/models/gear";
import { Vector3 } from "three";
import { EYE, EYE_CROUCH, LOW, REACH, dims, facing, holdPose, walkTo, type Answer, type Item, type Mate, type World } from "../sim.ts";
import { switchedOnIsFed, type Fed } from "../audio/hear.ts";
import { THICK, pathLength, type Rope, type Solid, type Vec } from "./rope.ts";

/** Where a cable's end is: in a jack, in your hand, in a friend's (crew/sync.ts), lying loose, or still coiled in the case. */
export type EndAt = { plug: End } | { hand: true } | { mate: string } | { loose: true } | { case: true };
export interface Run {
  key: string; kind: CableKind; lengthM: number; a: EndAt; b: EndAt;
  /** Out of the case: the roll, and its rope (the same one, for the readers that only want the points). */
  roll?: Roll; rope: Rope | null;
  /** Being coiled at the case: the loops so far, over or under, and when the last one went on. */
  coiling?: { ways: Way[]; at: number };
  /** Twists it went into the case with: each one is a knot to work out the next time it comes out. */
  twists?: number;
}

/** One loop of a coil: over-under alternates them, so the cable lies flat when it is thrown out again. */
export type Way = "over" | "under";
/** A loop per this many metres of cable, and the least seconds between two loops. */
export const LOOP_M = 0.6, LOOP_S = 0.4;
/** Seconds it takes to work one twist out of a cable coiled wrong, when it next comes out of the case. */
export const UNTANGLE_S = 15;
/** How many loops coil this cable. */
export const loopsFor = (r: { lengthM: number }) => Math.ceil(r.lengthM / LOOP_M);
/** Twists in a coil: every loop that went the same way as the one before it. */
export const twistsIn = (ways: readonly Way[]) => ways.filter((x, i) => i > 0 && x === ways[i - 1]).length;
/** `rnd` wobbles a bowled coil off its line (seeded, so a test bowls the same way twice). */
export interface Cables { runs: Run[]; caseKey: string | null; rnd: () => number }

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
    rnd: mulberry32(7),
  };
}

/** A run's roll, out of the case at `at`: its outer end wound on (`tailIn`) or already off and paying out. */
function unroll(run: Run, at: Vec, tailIn: boolean): Roll {
  const r = newRoll(rollKind(run.kind, run.lengthM), run.lengthM, at);
  r.y = at.y; r.tailIn = tailIn;
  for (const p of [...r.rope.pts, ...r.rope.prev]) p.y = at.y;
  run.roll = r; run.rope = r.rope;
  return r;
}
/** Whether a run's `b` end is still a coil (not every metre paid out). */
const coiled = (run: Run) => !!run.roll && run.roll.state !== "out";
/** The roll in your arms, if you carry one. */
export function carried(c: Cables): Run | null {
  return c.runs.find((r) => isHand(r.b) && r.roll?.state === "held") ?? null;
}

const isPlug = (e: EndAt): e is { plug: End } => "plug" in e;
const isHand = (e: EndAt) => "hand" in e;
const inCase = (e: EndAt) => "case" in e;
const isMate = (e: EndAt): e is { mate: string } => "mate" in e;
const mateOf = (w: World, e: { mate: string }) => w.crew.find((m) => m.id === e.mate);
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
    else {
      // No model yet (a condenser mic, the passive wedge): the catalog's jacks in a row across the back, at mid-height.
      const { w, h, d } = gear(gearId).size, names = jackNames(gear(gearId));
      names.forEach((name, i) => m!.set(name, { x: names.length > 1 ? -w / 2 + (w * (i + 0.5)) / names.length : 0, y: h / 2, z: -d / 2 - 0.03 }));
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
export const handAt = (w: World): Vec => handOf(w.you);
const handOf = (p: Pick<Mate, "x" | "z" | "yaw" | "crouch">): Vec => {
  const f = facing(p.yaw);
  return { x: p.x + f.x * 0.35, y: p.crouch ? 0.55 : 0.95, z: p.z + f.z * 0.35 };
};
function caseTop(w: World, c: Cables): Vec | null {
  const i = w.items.find((x) => x.key === c.caseKey);
  if (!i) return null;
  const p = poseOf(w, i);
  return { x: p.x, y: p.y + dims(i)[1] + THICK, z: p.z };
}
/** Where a roll taken out of the case sits while you walk its end out: on the floor by the case's side (on the lid,
 * its cable would slide off the edge and pull the coil out under its own weight). */
function caseFoot(w: World, c: Cables): Vec | null {
  const i = w.items.find((x) => x.key === c.caseKey);
  if (!i) return null;
  const p = poseOf(w, i), out = dims(i)[0] / 2 + ROLL_R;
  return { x: p.x + Math.cos(p.rot) * out, y: THICK, z: p.z - Math.sin(p.rot) * out };
}
function pinOf(w: World, c: Cables, e: EndAt): Vec | undefined {
  if (isHand(e)) return handAt(w);
  if (isMate(e)) { const m = mateOf(w, e); return m && handOf(m); }
  if (inCase(e)) return caseTop(w, c) ?? undefined;
  if (isPlug(e)) return jackAt(w, e.plug[0], e.plug[1]) ?? undefined;
  return undefined;
}
/** Where an end is now: its pin, or the rope's last point if it lies loose. */
export function endAt(w: World, c: Cables, run: Run, end: "a" | "b"): Vec | null {
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
  let kg = 0;
  for (const run of c.runs) {
    const roll = run.roll;
    if (!roll) continue;
    const a = pinOf(w, c, run.a), b = coiled(run) && inCase(run.b) ? caseFoot(w, c) ?? undefined : pinOf(w, c, run.b);
    // The coil goes where its inner end is: in a hand, on the case, or lying under the jack it is plugged into.
    if (b && roll.state !== "out") {
      roll.state = isPlug(run.b) ? "tied" : isHand(run.b) || isMate(run.b) ? "held" : "down";
      if (roll.state === "tied") Object.assign(roll, { x: b.x, y: CABLE[roll.kind].radius, z: b.z });
      else Object.assign(roll, b);
    }
    const mine = isHand(run.a) ? "a" : isHand(run.b) ? "b" : undefined;
    stepRoll(roll, dt, { a: roll.tailIn ? undefined : a, b }, s, c.rnd, mine);
    if (mine) kg += roll.pullKg + (mine === "b" && roll.state === "held" ? rollKg(roll) : 0);
  }
  w.cableKg = kg;
}

/** Bowl the roll in your arms along where you face, at `power` (0 to 1): it rolls off paying out cable, slower the
 * heavier it is. If its end isn't plugged in yet, you keep hold of the end. */
export function bowl(w: World, c: Cables, power: number): Answer {
  const run = carried(c);
  if (!run?.roll) return { ok: false, why: "no roll in your hands" };
  const roll = run.roll, h = handAt(w);
  Object.assign(roll, { x: h.x, z: h.z });
  roll.state = "held";
  const tail = roll.tailIn;
  bowlRoll(roll, w.you.yaw + Math.PI, Math.max(0.15, Math.min(1, power)));
  roll.y = ROLL_R;
  run.b = { loose: true };
  if (tail) run.a = { hand: true };
  return { ok: true };
}

/** Walk to (x, z) with the cables dragging behind you; the seconds it took. */
export const walkWith = (w: World, c: Cables, x: number, z: number) => walkTo(w, x, z, 120, (dt) => stepCables(w, c, dt));

/** Stand still for `seconds` while the cables settle (the clock runs on). */
export function settle(w: World, c: Cables, seconds = 2) {
  for (let t = 0; t < seconds; t += 1 / 60) { stepCables(w, c, 1 / 60); w.t += 1 / 60; }
}

/** The next coiled cable in the case (or the one of `kind`), once you are by the case with your hands free. */
function fromCase(w: World, c: Cables, kind?: CableKind): { run: Run; top: Vec } | { ok: false; why: string } {
  const top = caseTop(w, c);
  if (!top) return { ok: false, why: "no cable case here" };
  if (handsFull(w, c)) return { ok: false, why: "your hands are full" };
  if (!near(w, top)) return { ok: false, why: "the cable case is out of reach" };
  const run = c.runs.find((r) => !r.rope && (!kind || r.kind === kind));
  if (!run) return { ok: false, why: kind ? `no ${kind} cable left in the case` : "the case is empty" };
  w.t += (run.twists ?? 0) * UNTANGLE_S;
  run.twists = 0;
  return { run, top };
}

/** Pull the end off the next roll in the case (or the one of `kind`): its `a` end in your hand, the roll left on the
 * case paying out behind you as you walk. */
export function takeCable(w: World, c: Cables, kind?: CableKind): Answer {
  const got = fromCase(w, c, kind);
  if (!("run" in got)) return got;
  unroll(got.run, caseFoot(w, c) ?? got.top, false);
  got.run.a = { hand: true };
  got.run.b = { case: true };
  return { ok: true };
}

/** Lift the next roll out of the case (or the one of `kind`) into your arms, its end still wound on: carry it to where
 * the run starts, `plug` the end, then `bowl` it. */
export function takeRoll(w: World, c: Cables, kind?: CableKind): Answer {
  const got = fromCase(w, c, kind);
  if (!("run" in got)) return got;
  unroll(got.run, handAt(w), true).state = "held";
  got.run.a = { loose: true };
  got.run.b = { hand: true };
  return { ok: true };
}

/** Pick up a cable's end where it is: still in the case, lying loose, or in a jack (that unplugs it). The `b` end of a
 * cable not all paid out is the coil: grabbing it lifts the roll. The `a` end of a roll still wound up comes off it. */
export function grabEnd(w: World, c: Cables, key: string, end: "a" | "b"): Answer {
  const run = c.runs.find((r) => r.key === key);
  if (!run?.rope) return { ok: false, why: `no ${key} laid out` };
  const e = run[end];
  if (isMate(e)) return { ok: false, why: `${mateOf(w, e)?.name ?? "a friend"} has that end` };
  if (handsFull(w, c)) return { ok: false, why: "your hands are full" };
  const at = endAt(w, c, run, end);
  if (!at || !near(w, at)) return { ok: false, why: `that end of ${key} is out of reach` };
  run[end] = { hand: true };
  if (end === "a" && run.roll?.tailIn) run.roll.tailIn = false;
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
  // A roll in your arms with its end still wound on: the end comes off and goes in, and you keep the roll.
  const roll = h.run.roll;
  if (h.end === "b" && roll?.tailIn && roll.state === "held") {
    roll.tailIn = false;
    h.run.a = { plug: [owner, jack] };
    Object.assign(roll.rope.pts[0]!, at); Object.assign(roll.rope.prev[0]!, at);
    return { ok: true };
  }
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
  delete h.run.coiling;
  // A roll you carry is set down at your feet.
  const roll = h.run.roll;
  if (h.end === "b" && roll?.state === "held") { roll.state = "down"; roll.y = CABLE[roll.kind].radius; }
  if (assist("autoCoil") && ![h.run.a, h.run.b].some((e) => isPlug(e) || isMate(e))) stow(h.run, 0);
  return { ok: true };
}

/** Start coiling a cable back into the case: neither end in a jack, and you by the case. Then a `loop` at a time,
 * over and under in turn; the autoCoil assist coils it neatly at once. */
export function coil(w: World, c: Cables, key: string): Answer {
  const run = c.runs.find((r) => r.key === key), top = caseTop(w, c);
  if (!run?.rope) return { ok: false, why: `${key} is already coiled` };
  if (isPlug(run.a) || isPlug(run.b)) return { ok: false, why: `unplug ${key} first` };
  const m = [run.a, run.b].find(isMate);
  if (m) return { ok: false, why: `${mateOf(w, m)?.name ?? "a friend"} has the other end` };
  if (!top || !near(w, top)) return { ok: false, why: "the cable case is out of reach" };
  if (run.coiling) return { ok: false, why: "Q over, E under" };
  if (assist("autoCoil")) return stow(run, 0), { ok: true };
  run.coiling = { ways: [], at: -Infinity };
  return { ok: true };
}

/** The crew room's word on one end of a cable (crew/sync.ts): it comes out of the case as a rope, a loose end lands
 * `at` where it was let go, and with both ends back in the case it is coiled, with the twists it went in with. */
export function setEnd(w: World, c: Cables, key: string, end: "a" | "b", to: EndAt, at?: Vec, twists?: number) {
  const run = c.runs.find((r) => r.key === key);
  if (!run) return;
  const was = run[end];
  run[end] = to;
  if (!isHand(run.a) && !isHand(run.b)) delete run.coiling;
  if (inCase(run.a) && inCase(run.b)) return stow(run, twists ?? run.twists ?? 0);
  if (!run.roll) unroll(run, caseTop(w, c) ?? at ?? { x: 0, y: 0, z: 0 }, false);
  const rope = run.rope!;
  if (at && "loose" in to && !("loose" in was)) {
    const n = end === "a" ? 0 : rope.pts.length - 1;
    rope.pts[n] = { ...at };
    rope.prev[n] = { ...at };
    if (end === "b" && run.roll && coiled(run)) Object.assign(run.roll, { state: "down", x: at.x, z: at.z, y: CABLE[run.roll.kind].radius });
  }
}

function stow(run: Run, twists: number) {
  Object.assign(run, { rope: null, roll: undefined, a: { case: true }, b: { case: true }, twists });
  delete run.coiling;
}

/** The cable being coiled now, if any. */
export const coiling = (c: Cables) => c.runs.find((r) => r.coiling) ?? null;

/** One loop onto the coil (Q over, E under): the last one puts it in the case, with a twist for every loop that went
 * the same way as the one before. */
export function loop(w: World, c: Cables, way: Way): Answer {
  const run = coiling(c), top = caseTop(w, c);
  if (!run?.coiling) return { ok: false, why: "no cable being coiled" };
  if (!top || !near(w, top)) return { ok: false, why: "the cable case is out of reach" };
  if (w.t - run.coiling.at < LOOP_S - 1e-3) return { ok: false, why: "steady: one loop at a time" };
  run.coiling.ways.push(way);
  run.coiling.at = w.t;
  if (run.coiling.ways.length >= loopsFor(run)) stow(run, twistsIn(run.coiling.ways));
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
    // A roll lying with its end wound on is picked up whole (its `b`), not by the end.
    const at = run.rope && "loose" in run[end] && !(end === "a" && run.roll?.tailIn) ? endAt(w, c, run, end) : null;
    if (at && near(w, at, 1.0)) return grabEnd(w, c, run.key, end);
  }
  if (aimedItem?.key === c.caseKey) {
    const left = c.runs.find((r) => !r.rope);
    if (left) return takeRoll(w, c);
    const wait = c.runs.find((r) => r.rope && inCase(r.b));
    if (wait) return grabEnd(w, c, wait.key, "b");
  }
  return null;
}

const cm = (v: number) => Math.round(v * 100) / 100;
const endName = (w: World, e: EndAt) => (isPlug(e) ? `${e.plug[0]} ${e.plug[1]}` : isHand(e) ? "hand" : isMate(e) ? `${mateOf(w, e)?.name ?? "a friend"}'s hand` : inCase(e) ? "case" : "loose");

/** What `loadIn.state()` says about cables: each run's ends and slack, the hazards, and the patch. */
export function cableState(w: World, c: Cables) {
  return {
    cables: c.runs.map((r) => ({
      key: r.key, kind: r.kind, lengthM: r.lengthM, coiled: !r.rope, a: endName(w, r.a), b: endName(w, r.b), twists: r.twists ?? 0,
      ...(r.coiling ? { coiling: `${r.coiling.ways.length} of ${loopsFor(r)}` } : {}),
      slack: r.rope ? cm(r.lengthM - Math.hypot(...(["x", "y", "z"] as const).map((k) => r.rope!.pts[0]![k] - r.rope!.pts[r.rope!.pts.length - 1]![k]))) : null,
      laid: r.rope ? cm(pathLength(r.rope)) : 0,
      ...(r.roll ? { roll: { kind: r.roll.kind, state: r.roll.state, leftM: cm(leftM(r.roll)), kg: cm(rollKg(r.roll)), x: cm(r.roll.x), z: cm(r.roll.z), pullKg: cm(r.roll.pullKg) } } : {}),
    })),
    cableKg: cm(w.cableKg ?? 0),
    hazards: hazards(w, c),
    ...patch(w, c),
  };
}
