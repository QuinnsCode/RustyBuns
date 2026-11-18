// How a hand closes on what it holds. `gripFor(what)` says what the hand is round (a cylinder across the palm, a flat
// side, or nothing), in the hand's own frame (skeleton.ts); `HandSolver.pose(grip)` closes the fingers on it with the
// shared IK rig (@rustybuns/rig/ik) and hands back each joint's matrix and how far each fingertip sits from the
// surface. A planar pass picks each fingertip's contact (the most wrapped curl that doesn't pass through the thing),
// then the rig reaches it in 3D within the joints' limits, the thumb trying a few places and keeping the best. One
// solve per grip, cached: a frame never solves. Plain TS, no three.js, no game world.
import { IkRig } from "@rustybuns/rig/ik";
import { FINGERS, type Finger, HAND, PALM, type V3 } from "./skeleton.ts";

/** What the surface is, in the hand frame: a cylinder lying across the palm (its axis along x), or a plane under it. */
export type Surface = { kind: "cylinder"; r: number; y: number; z: number } | { kind: "plane"; y: number };

export type What =
  | { kind: "rest" }
  | { kind: "cable"; radius: number }
  | { kind: "plug" }
  | { kind: "roll" }
  | { kind: "handle" }
  | { kind: "flat" };

/** A cable's radius by kind, metres: a power cord, speaker cable, a mic (XLR) or instrument lead, a feeder. */
export const CABLE_RADIUS: Record<string, number> = { power: 0.0055, speaker: 0.0045, xlr: 0.0032, instrument: 0.003, feeder: 0.014 };
export const REST: What = { kind: "rest" };

export type Grip ={ name: What["kind"]; surface: Surface | null; key: string };

/** Real sizes, in metres: an XLR plug's shell, a cabinet's bar handle, and a 22 cm coil's bundle hooked over the fingers. */
export const SIZES = { plug: 0.0105, handle: 0.0125, roll: 0.022 };

const KNUCKLE_Y = HAND.bones[HAND.chains.index[0]].at[1];
/** A cylinder held in a fist: across the palm, its top on the palm's front face, just behind the knuckle line. */
const fist = (r: number): Surface => ({ kind: "cylinder", r, y: PALM.front - r, z: -0.078 });

export function gripFor(what: What): Grip {
  const g = (surface: Surface | null): Grip => ({ name: what.kind, surface, key: `${what.kind}:${surface ? JSON.stringify(surface) : ""}` });
  switch (what.kind) {
    case "rest": return g(null);
    case "cable": return g(fist(Math.max(0.002, what.radius)));
    case "plug": return g(fist(SIZES.plug));
    case "handle": return g(fist(SIZES.handle));
    // The coil hangs on the fingers' hook, below the first segments, clear of the palm.
    case "roll": return g({ kind: "cylinder", r: SIZES.roll, y: KNUCKLE_Y - 0.0095 - SIZES.roll, z: -0.118 });
    case "flat": return g({ kind: "plane", y: PALM.front });
  }
}

/** Signed distance from a point (y, z) in the hand frame to the surface: positive outside it. */
export function surfaceDistance(s: Surface, y: number, z: number): number {
  return s.kind === "plane" ? y - s.y : Math.hypot(y - s.y, z - s.z) - s.r;
}

export type HandPose = {
  grip: Grip["name"];
  /** Each joint's matrix in the hand frame, column-major, 16 a joint (skeleton order). */
  mats: Float32Array;
  /** Each fingertip's gap to the surface it holds, in metres (its pad touching is 0); null holding nothing. */
  tips: Record<Finger, number | null>;
  /** No joint past its range. */
  limitsHeld: boolean;
};

/** The planar curl (three joint angles, negative curls) that wraps a finger closest round the surface without passing through it. */
function planarCurl(f: Exclude<Finger, "thumb">, s: Surface | null): V3 {
  if (!s) return { index: [-0.3, -0.45, -0.3], middle: [-0.35, -0.55, -0.35], ring: [-0.4, -0.6, -0.4], little: [-0.45, -0.65, -0.45] }[f] as V3;
  const chain = HAND.chains[f].map((j) => HAND.bones[j]);
  const len = [1, 2, 3].map((i) => Math.abs(chain[i].at[2] - chain[i - 1].at[2]));
  const rad = chain.map((b) => b.radius), pad = rad[3];
  const [mn, mx] = [HAND.bones[HAND.chains.index[0]].limit!, HAND.bones[HAND.chains.index[1]].limit!];
  const dipLim = HAND.bones[HAND.chains.index[2]].limit!;
  const score = (a: number, b: number) => {
    const c = Math.max(dipLim.min[0], Math.min(dipLim.max[0], b * 0.75));
    let y = KNUCKLE_Y, z = chain[0].at[2], e = 0, bad = 0;
    for (let seg = 0; seg < 3; seg++) {
      e += seg === 0 ? a : seg === 1 ? b : c;
      const dy = Math.sin(e) * len[seg], dz = -Math.cos(e) * len[seg];
      for (let t = 0.25; t <= 1.001; t += 0.25) {
        const d = surfaceDistance(s, y + dy * t, z + dz * t) - rad[seg] - 0.0008;
        if (d < 0) bad -= d;
      }
      y += dy; z += dz;
    }
    // A wrap: the more curl the snugger; a flat hand: the less curl the flatter.
    return Math.abs(surfaceDistance(s, y, z) - pad) + bad * 4 + (s.kind === "cylinder" ? 0.0006 : -0.002) * (a + b + c);
  };
  // Coarse over the whole range, then fine round the best.
  let best = [0, 0], bestScore = Infinity, spanA = mn.max[0] - mn.min[0], spanB = mx.max[0] - mx.min[0];
  let a0 = mn.min[0], b0 = mx.min[0];
  for (const N of [24, 16, 16]) {
    for (let i = 0; i <= N; i++) for (let k = 0; k <= N; k++) {
      const a = Math.max(mn.min[0], Math.min(mn.max[0], a0 + (spanA * i) / N)), b = Math.max(mx.min[0], Math.min(mx.max[0], b0 + (spanB * k) / N));
      const sc = score(a, b);
      if (sc < bestScore) (bestScore = sc), (best = [a, b]);
    }
    spanA = (spanA / N) * 4; spanB = (spanB / N) * 4;
    a0 = best[0] - spanA / 2; b0 = best[1] - spanB / 2;
  }
  return [best[0], best[1], Math.max(dipLim.min[0], Math.min(dipLim.max[0], best[1] * 0.75))];
}

/** Where the curl puts the fingertip, in the hand frame. */
function curlTip(f: Exclude<Finger, "thumb">, [a, b, c]: V3): V3 {
  const chain = HAND.chains[f].map((j) => HAND.bones[j]);
  let y = KNUCKLE_Y, z = chain[0].at[2], e = 0;
  [a, b, c].forEach((d, i) => { e += d; const l = Math.abs(chain[i + 1].at[2] - chain[i].at[2]); y += Math.sin(e) * l; z -= Math.cos(e) * l; });
  return [chain[0].at[0], y, z];
}

/** Places to try the thumb's tip: round the far side of a cylinder over the index finger, or flat beside it. */
function thumbGoals(s: Surface | null): V3[] {
  if (!s) return [];
  const pad = HAND.bones[HAND.tips.thumb].radius, out: V3[] = [];
  if (s.kind === "plane") {
    for (const z of [-0.055, -0.065, -0.075]) for (const x of [-0.055, -0.045]) out.push([x, s.y + pad + 0.001, z]);
    return out;
  }
  const R = s.r + pad;
  for (const x of [-0.032, -0.02]) for (let deg = 24; deg <= 266; deg += 22) {
    const p = (deg * Math.PI) / 180;
    out.push([x, s.y + R * Math.cos(p), s.z - R * Math.sin(p)]);
  }
  return out;
}

export class HandSolver {
  readonly rig: IkRig;
  private cache = new Map<string, HandPose>();

  constructor() {
    const pos = new Float32Array(HAND.bones.flatMap((b) => b.at));
    const parents = new Int32Array(HAND.bones.map((b) => b.parent));
    this.rig = new IkRig(pos, parents, (j) => HAND.bones[j].limit ?? Math.PI * 0.8);
  }

  /** The hand closed on a grip: solved once, then served from the cache. */
  pose(grip: Grip): HandPose {
    const hit = this.cache.get(grip.key);
    if (hit) return hit;
    const p = this.solve(grip);
    this.cache.set(grip.key, p);
    return p;
  }

  private seed(curls: Map<Finger, V3>) {
    const rig = this.rig;
    rig.reset();
    for (const [f, curl] of curls) {
      HAND.chains[f].slice(0, 3).forEach((j, i) => rig.setAngle(j, 0, curl[i]));
      rig.moveGoal(HAND.tips[f], ...curlTip(f as Exclude<Finger, "thumb">, curl));
    }
    // The thumb half closed to start, its tip where that leaves it unless a goal moves it.
    for (const j of HAND.chains.thumb.slice(1, 3)) rig.setAngle(j, 0, -0.3);
    rig.update();
    rig.moveGoal(HAND.tips.thumb, ...rig.worldPosition(HAND.tips.thumb));
  }

  private solve(grip: Grip): HandPose {
    const rig = this.rig, s = grip.surface, thumb = HAND.tips.thumb;
    const tries = thumbGoals(s);
    const curls = new Map<Finger, V3>(FINGERS.filter((f) => f !== "thumb").map((f) => [f, planarCurl(f, s)]));
    // Each try is solved all the way and scored as it ends, so the pose kept is the one that was scored.
    let best: HandPose | null = null, bestCost = Infinity;
    for (const goal of tries.length ? tries : [null]) {
      this.seed(curls);
      if (goal) rig.moveGoal(thumb, ...goal);
      rig.solve(40, 0.02);
      const cost = goal ? this.thumbCost(goal, s!) : 0;
      if (cost < bestCost) (bestCost = cost), (best = this.read(grip));
    }
    return best!;
  }

  private read(grip: Grip): HandPose {
    const rig = this.rig, s = grip.surface;
    const mats = new Float32Array(HAND.bones.length * 16);
    HAND.bones.forEach((_, j) => mats.set(rig.matrixWorld(j), j * 16));
    const tips = {} as Record<Finger, number | null>;
    for (const f of FINGERS) {
      const t = rig.worldPosition(HAND.tips[f]);
      tips[f] = s ? surfaceDistance(s, t[1], t[2]) - HAND.bones[HAND.tips[f]].radius : null;
    }
    return { grip: grip.name, mats, tips, limitsHeld: rig.withinLimits() };
  }

  /** How far the thumb missed its goal, plus how deep any of it went into the thing: sampled along each segment, not
   * just at the joints, since a segment can pass through a cable with both its ends outside. */
  private thumbCost(goal: V3, s: Surface): number {
    const t = this.rig.worldPosition(HAND.tips.thumb), chain = HAND.chains.thumb;
    let cost = Math.hypot(t[0] - goal[0], t[1] - goal[1], t[2] - goal[2]);
    for (let k = 1; k < chain.length; k++) {
      const a = this.rig.worldPosition(chain[k - 1]), b = this.rig.worldPosition(chain[k]);
      const ra = HAND.bones[chain[k - 1]].radius, rb = HAND.bones[chain[k]].radius;
      for (let u = 0.125; u <= 1.001; u += 0.125) {
        const d = surfaceDistance(s, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u) - (ra + (rb - ra) * u);
        if (d < 0) cost += -d * 12;
      }
    }
    return cost;
  }

}
