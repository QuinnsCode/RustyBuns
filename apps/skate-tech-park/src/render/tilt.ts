// A manual on the board's view: the nose lifts (or, in a nose manual, the tail) and the board
// balances on two wheels, turning about the wheels that stay down so they keep to the ground. The
// closer the sim's balance gets to either end, the further it tips and the harder it shakes.
import type { Skin } from "./skins.ts";

/** How far behind (or ahead of) the middle the wheels that stay down are. */
export const WHEELBASE: Record<Skin, number> = { fingerboard: 0.95, roadster: 1.45 };
export const REST_TILT = 0.26; // radians, balanced
export const SWING = 0.2; // radians more or less, from balance 0 to either end

export type Tilt = { pitch: number; roll: number; lift: number };

/**
 * The pose for a manual held with `balance` (-1..1, tipping over at either end), `at` seconds in:
 * pitch about the pivot (negative lifts the nose), a shake side to side, and how far up the pivot
 * rises to keep the wheels that stay down on the floor. `pivotY` is the pivot's height off the floor.
 */
export function manualPose(manual: -1 | 0 | 1, balance: number, skin: Skin, pivotY: number, at: number, ease = 1): Tilt {
  if (!manual || ease <= 0) return { pitch: 0, roll: 0, lift: 0 };
  const angle = (REST_TILT + SWING * balance * manual) * ease; // tipping further over means a steeper angle
  const wobble = Math.min(1, Math.abs(balance));
  return {
    pitch: -manual * angle,
    roll: Math.sin(at * 17) * 0.05 * wobble * wobble * ease,
    lift: pivotY * (Math.cos(angle) - 1) + WHEELBASE[skin] * Math.sin(Math.abs(angle)),
  };
}

export const GRAB_TUCK = 0.3; // radians the board tucks up under the rider while a hand holds it
export const GRAB_PITCH = 0.35; // radians the held end lifts (nose up for a nose grab, tail up for a tail grab)

/** The pose for a grab in the air (`grab` 1 holds the tail, -1 the nose): the held end lifts, the board tucks in under the rider; a hand on a rail (`rail` 1 toe side, -1 heel side) tucks it toward that side. */
export function grabPose(grab: -1 | 0 | 1, ease = 1, rail: -1 | 0 | 1 = 0): Tilt {
  if (!grab || ease <= 0) return { pitch: 0, roll: 0, lift: 0 };
  return { pitch: grab * GRAB_PITCH * ease * (rail ? 0.5 : 1), roll: (rail || 1) * GRAB_TUCK * ease, lift: 0.15 * ease };
}

/** Eases the tilt in and out so a manual doesn't snap. */
export class TiltEase {
  ease = 0;
  last: -1 | 0 | 1 = 1;
  update(manual: -1 | 0 | 1, dt: number) {
    if (manual) this.last = manual;
    this.ease += ((manual ? 1 : 0) - this.ease) * (1 - Math.exp(-14 * dt));
    if (!manual && this.ease < 0.01) this.ease = 0;
    return this.ease;
  }
}

/** The sim calls a rise steeper than this (about 72 degrees) a wall, not a ramp (MAX_SLOPE in sim.ts). */
export const RAMP_RISE = 3;

/** The ground's rise `gx`, `gz` as the board can lie on it. The view reads the height a quarter metre either side, which at the
 * foot of a cliff or on its face is a wall, not a ramp (the sim won't ride it either): the board stays level there instead of
 * leaning against it, nose up. */
export function rideableRise(gx: number, gz: number): [number, number] {
  return Math.hypot(gx, gz) > RAMP_RISE ? [0, 0] : [gx, gz];
}

/** The turns (about x, then z, after yaw: Euler order YXZ) that stand a board's up exactly on the ground's normal, given the
 * ground's rise `gx` along +x and `gz` along +z under it. Pitch and roll read off the slope separately are only right on a plane. */
export function lieOnGround(gx: number, gz: number, yaw: number) {
  const len = Math.hypot(gx, 1, gz), nx = -gx / len, ny = 1 / len, nz = -gz / len;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const mx = nx * c - nz * s, mz = nx * s + nz * c; // the normal in the board's own heading frame
  return { x: Math.atan2(mz, ny), z: -Math.asin(mx) };
}

/** How far behind the middle the tail meets the floor when an ollie snaps it down. */
export const TAIL: Record<Skin, number> = { fingerboard: 1.9, roadster: 1.45 };

/** An ollie's pop on the view: the nose `up` radians, turned about the tail so the tail stays on the floor as it snaps. */
export function popPose(up: number, skin: Skin, pivotY: number): Tilt {
  if (up === 0) return { pitch: 0, roll: 0, lift: 0 };
  return { pitch: -up, roll: 0, lift: pivotY * (Math.cos(up) - 1) + TAIL[skin] * Math.sin(Math.abs(up)) }; // a nollie (up < 0) stands on its nose the same way
}
