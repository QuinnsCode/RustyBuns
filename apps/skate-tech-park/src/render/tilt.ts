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

/** The turns (about x, then z, after yaw: Euler order YXZ) that lay a board on ground rising `pitch` ahead and `roll` to its right. */
export const lieOnGround = (pitch: number, roll: number) => ({ x: -pitch, z: -roll });

/** How far behind the middle the tail meets the floor when an ollie snaps it down. */
export const TAIL: Record<Skin, number> = { fingerboard: 1.9, roadster: 1.45 };

/** An ollie's pop on the view: the nose `up` radians, turned about the tail so the tail stays on the floor as it snaps. */
export function popPose(up: number, skin: Skin, pivotY: number): Tilt {
  if (up <= 0) return { pitch: 0, roll: 0, lift: 0 };
  return { pitch: -up, roll: 0, lift: pivotY * (Math.cos(up) - 1) + TAIL[skin] * Math.sin(up) };
}
