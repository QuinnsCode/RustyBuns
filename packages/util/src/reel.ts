// A reel: a game's dramatic camera, written as takes strung together. Each take is a shot (a camera as a pure
// function of how far through it you are, 0..1) held for some seconds, and joined to the one before by a
// transition. The reel answers one frame for any second, so a director, a test and a screenshot see the same thing.
//
//   const r = reel([
//     { seconds: 3, shot: truck(you, vista) },                      // slide past you, the land behind
//     { seconds: 3.5, shot: crane(you, vista), into: { whip: 0.4 } }, // whip round, then rise over your shoulder
//   ], { handBack: 0.8 });
//   r.at(t) // { from, at, mix, fov, roll, dip, flash, whip, slow, speed }
//
// The shots:
//   truck      the parallax shot: the camera slides sideways, parallel to the horizon, with you close in front
//              and the land far behind, so you slip past while the hills hardly move.
//   orbit      a full turn round a subject, close and low: the slow-motion look round from a ledge.
//   crane      over your shoulder, low, then up and back while the look lifts from you to the land you face.
//   dollyZoom  the camera backs off while the lens narrows: the subject holds its size and the world swells behind.
//   still      one camera, held.
// The transitions (`into`, on the take after the join): a cut, a blend (the camera glides from the last take's
// end), a whip (a fast blend with a blur peaking halfway), a dip to black or a flash to white (cut at the middle).
// A take may run slow (`slow`: 0.3 is a third speed for everything the page lets it slow) and with anime speed lines.
//
// `vista` finds the land worth looking at from where you stand: the bearing whose ground rises highest in your eye.
import { clamp, lerp } from "./index.ts";
import { smoothstep as smooth } from "./motion.ts";
import type { SweepShot, Vec3 } from "./sweep.ts";

/** A camera at an instant. `fov` is the vertical lens in degrees (none: the page's own), `roll` a tilt in radians. */
export interface Cam { from: Vec3; at: Vec3; fov?: number; roll?: number }
/** A camera through a take: `u` 0 at its start to 1 at its end. */
export type Shot = (u: number) => Cam;

export type Into = "cut" | { blend: number } | { whip: number } | { dip: number } | { flash: number };
export interface Take {
  seconds: number;
  shot: Shot;
  /** How it joins the take before (the first take's is ignored). Default: a cut. */
  into?: Into;
  /** 0..1: time runs this fast while it plays (1: normal). */
  slow?: number;
  /** 0..1: anime speed lines over it. */
  speed?: number;
}
/** What the page draws at one second of a reel. */
export interface ReelFrame extends SweepShot {
  fov: number | null;
  roll: number;
  /** 0..1 black over the view, and white. */
  dip: number;
  flash: number;
  /** 0..1: a whip pan's blur. */
  whip: number;
  /** Time's speed (1: normal). */
  slow: number;
  /** 0..1: speed lines. */
  speed: number;
  /** The take playing. */
  take: number;
}
export interface Reel { seconds: number; at(t: number): ReelFrame }

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const mix3 = (a: Vec3, b: Vec3, k: number): Vec3 => v(lerp(a.x, b.x, k), lerp(a.y, b.y, k), lerp(a.z, b.z, k));
/** The level unit vector from `a` toward `b` (north when they stand on each other). */
function heading(a: Vec3, b: Vec3): [number, number] {
  const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
  return d > 1e-6 ? [dx / d, dz / d] : [0, -1];
}
/**
 * A point to look at from `from`, `k` of the way from looking at `a` to looking at `b`: the directions blend, not
 * the points, so a far hill doesn't swamp a near subject halfway through.
 */
function aimBetween(from: Vec3, a: Vec3, b: Vec3, k: number): Vec3 {
  const unit = (p: Vec3) => { const x = p.x - from.x, y = p.y - from.y, z = p.z - from.z, d = Math.hypot(x, y, z) || 1; return v(x / d, y / d, z / d); };
  const d = mix3(unit(a), unit(b), k);
  return v(from.x + d.x * 20, from.y + d.y * 20, from.z + d.z * 20);
}
/** Half linear, half eased: keeps moving through the middle but never starts or stops with a jolt. */
const glide = (u: number) => 0.5 * clamp(u, 0, 1) + 0.5 * smooth(u);

// --- the shots ---------------------------------------------------------------------------------------------------

/**
 * The parallax shot. The camera stands `back` metres behind `subject` on the line from it to `vista`, `height` up,
 * and slides `travel` metres sideways across that line (`side` 1 or -1 for which way), looking level toward the
 * vista. `keep` (0..1) turns it toward the subject too, so it stays in frame rather than passing through.
 */
export function truck(subject: Vec3, vista: Vec3, o: { back?: number; height?: number; travel?: number; side?: number; keep?: number; lens?: number } = {}): Shot {
  const { back = 7, height = 1.4, travel = 9, side = 1, keep = 0.35, lens = 32 } = o;
  const [dx, dz] = heading(subject, vista), nx = -dz * side, nz = dx * side;
  return (u) => {
    const s = lerp(-travel / 2, travel / 2, glide(u));
    const from = v(subject.x - dx * back + nx * s, subject.y + height, subject.z - dz * back + nz * s);
    // Straight ahead, level, at the subject's distance; turned part way to the subject itself.
    const ahead = v(from.x + dx * back, subject.y + height * 0.9, from.z + dz * back);
    return { from, at: mix3(ahead, v(subject.x, subject.y + 1.1, subject.z), keep), fov: lens };
  };
}

/** A full turn (or `turns`) round `focus`, `radius` out and `height` up, rising by `rise` as it goes. */
export function orbit(focus: Vec3, o: { radius?: number; height?: number; turns?: number; start?: number; rise?: number; look?: number; lens?: number } = {}): Shot {
  const { radius = 6, height = 1.6, turns = 1, start = 0, rise = 0, look = 1.2, lens = 42 } = o;
  return (u) => {
    const e = glide(u), a = start + turns * Math.PI * 2 * e;
    return { from: v(focus.x + Math.sin(a) * radius, focus.y + height + rise * e, focus.z + Math.cos(a) * radius), at: v(focus.x, focus.y + look, focus.z), fov: lens };
  };
}

/**
 * The reveal: low over `subject`'s shoulder facing `vista`, then up to `height` and `back` metres behind while the
 * look lifts off the subject toward the land. The lens widens as it rises.
 */
export function crane(subject: Vec3, vista: Vec3, o: { back?: [from: number, to: number]; height?: [from: number, to: number]; shoulder?: number; lens?: [from: number, to: number]; reach?: number } = {}): Shot {
  const { back = [2.6, 9], height = [1.7, 6], shoulder = 0.9, lens = [38, 52], reach = 0.7 } = o;
  const [dx, dz] = heading(subject, vista), nx = -dz, nz = dx;
  return (u) => {
    const e = smooth(u), b = lerp(back[0], back[1], e), sh = shoulder * (1 - e);
    const from = v(subject.x - dx * b + nx * sh, subject.y + lerp(height[0], height[1], e), subject.z - dz * b + nz * sh);
    const head = v(subject.x + nx * sh * 0.3, subject.y + 1.4, subject.z + nz * sh * 0.3);
    return { from, at: aimBetween(from, head, vista, reach * smooth((u - 0.15) / 0.85)), fov: lerp(lens[0], lens[1], e) };
  };
}

/**
 * The vertigo: from `near` to `far` metres off `focus` along the level direction `toward` (radians, 0 is +z),
 * the lens narrowing so the subject keeps the size it had at `lens` degrees and `near` metres.
 */
export function dollyZoom(focus: Vec3, o: { toward?: number; near?: number; far?: number; height?: number; lens?: number; look?: number } = {}): Shot {
  const { toward = 0, near = 4, far = 14, height = 1.2, lens = 55, look = 1 } = o;
  const frame = 2 * near * Math.tan((lens * Math.PI) / 360);
  return (u) => {
    const d = lerp(near, far, smooth(u));
    return { from: v(focus.x + Math.sin(toward) * d, focus.y + height, focus.z + Math.cos(toward) * d), at: v(focus.x, focus.y + look, focus.z), fov: (Math.atan(frame / (2 * d)) * 360) / Math.PI };
  };
}

/** One camera, still. */
export const still = (cam: Cam): Shot => () => cam;

// --- the reel ----------------------------------------------------------------------------------------------------

function blendCam(a: Cam, b: Cam, k: number): Cam {
  const fa = a.fov ?? b.fov, fb = b.fov ?? a.fov;
  return { from: mix3(a.from, b.from, k), at: mix3(a.at, b.at, k), fov: fa === undefined || fb === undefined ? undefined : lerp(fa, fb, k), roll: lerp(a.roll ?? 0, b.roll ?? 0, k) };
}
const lengthOf = (i: Into | undefined) => !i || i === "cut" ? 0 : "blend" in i ? i.blend : "whip" in i ? i.whip : "dip" in i ? i.dip : i.flash;

/**
 * Takes back to back. `handIn` seconds at the start take the view from the player's camera (0: cut straight in),
 * and `handBack` seconds at the end give it back (`mix` falls to 0), so leaving the reel never jumps.
 */
export function reel(takes: readonly Take[], o: { handIn?: number; handBack?: number } = {}): Reel {
  const { handIn = 0, handBack = 0.8 } = o;
  const starts: number[] = [];
  let seconds = 0;
  for (const k of takes) { starts.push(seconds); seconds += k.seconds; }
  return {
    seconds,
    at(t) {
      const tt = clamp(t, 0, seconds);
      let i = 0;
      while (i < takes.length - 1 && tt >= starts[i + 1]!) i++;
      const k = takes[i]!, into = i > 0 ? k.into : undefined, n = lengthOf(into), since = tt - starts[i]!;
      let cam = k.shot(clamp(since / k.seconds, 0, 1)), dip = 0, flash = 0, whip = 0;
      // A glide from where the last take ended, for a blend or a whip.
      if (into && into !== "cut" && ("blend" in into || "whip" in into) && since < n) {
        const e = smooth(since / n);
        cam = blendCam(takes[i - 1]!.shot(1), cam, e);
        if ("whip" in into) whip = Math.sin(Math.PI * clamp(since / n, 0, 1));
      }
      // A dip or a flash straddles the join: the half before it darkens the last take, the half after clears this one.
      const near = (j: number) => {
        const x = j > 0 ? takes[j]!.into : undefined, m = lengthOf(x) / 2;
        if (!x || x === "cut" || !m || !("dip" in x || "flash" in x)) return;
        const d = 1 - smooth(Math.abs(tt - starts[j]!) / m);
        if (d > 0) { if ("dip" in x) dip = Math.max(dip, d); else flash = Math.max(flash, d); }
      };
      near(i); if (i + 1 < takes.length) near(i + 1);
      const mix = Math.min(handIn > 0 ? smooth(tt / handIn) : 1, handBack > 0 ? 1 - smooth((tt - (seconds - handBack)) / handBack) : 1);
      return { from: cam.from, at: cam.at, mix, fov: cam.fov ?? null, roll: cam.roll ?? 0, dip, flash, whip, slow: k.slow ?? 1, speed: k.speed ?? 0, take: i };
    },
  };
}

// --- where to look -----------------------------------------------------------------------------------------------

/**
 * The land worth a look from `at`: of `bearings` directions, the one whose ground at `rings` metres rises highest
 * in your eye (the angle up to it), sea counted as level water. Its point, and the bearing (radians, 0 is +z).
 */
export function vista(groundAt: (x: number, z: number) => number, at: Vec3, o: { bearings?: number; rings?: readonly number[] } = {}): Vec3 & { bearing: number } {
  const { bearings = 16, rings = [180, 420, 800, 1400] } = o;
  let best = { x: at.x, y: at.y, z: at.z - rings[0]!, bearing: Math.PI, score: -Infinity };
  for (let b = 0; b < bearings; b++) {
    const a = (b / bearings) * Math.PI * 2, sx = Math.sin(a), sz = Math.cos(a);
    for (const r of rings) {
      const x = at.x + sx * r, z = at.z + sz * r, y = Math.max(0, groundAt(x, z)), score = Math.atan2(y - at.y, r);
      if (score > best.score) best = { x, y, z, bearing: a, score };
    }
  }
  return { x: best.x, y: best.y, z: best.z, bearing: best.bearing };
}
