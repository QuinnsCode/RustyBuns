// The gesture layer: a mouse drag or the right stick, resolved into the plain sim inputs (an ollie,
// a flick trick) before step() ever sees them. No DOM here, so the tests drive it with numbers.
import type { Input } from "./sim.ts";

export const HOLD = 0.3; // seconds a press must stay put before it is a manual, not a flick
export const NUDGE = 12; // pixels down while holding: a nose manual instead
export const MIN_DRAG = 30; // pixels of drag (or 0.6 of stick travel, scaled by the caller) before it counts

export const LONG = 110; // pixels: a diagonal this long, down, is a double turn

/** Screen-space drag, y down. Up is the ollie; across and down are flicks: right kickflip, left heelflip, down shove-it.
 * The diagonals are the compound tricks: up-right a varial and up-left a varial heel (both ollie first), down-right a
 * hardflip and down-left an inward heel, or with a long drag a tre flip and a laser flip. */
export function resolve(dx: number, dy: number): Partial<Pick<Input, "jump" | "flick">> {
  const len = Math.hypot(dx, dy);
  if (len < MIN_DRAG) return {};
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 2 * ay) return { flick: dx > 0 ? "kickflip" : "heelflip" };
  if (ay > 2 * ax) return dy < 0 ? { jump: true } : { flick: "shove-it" };
  if (dy < 0) return { jump: true, flick: dx > 0 ? "varial" : "varial heel" };
  if (len >= LONG) return { flick: dx > 0 ? "tre flip" : "laser flip" };
  return { flick: dx > 0 ? "hardflip" : "inward heel" };
}

/** Collects a drag or a stick push and hands back what it resolved to, once. */
export class Gestures {
  private start: [number, number] | null = null;
  private pending: Partial<Pick<Input, "jump" | "flick">> | null = null;
  private pushed = false;
  private at = 0; // when the press began, in seconds
  private cur: [number, number] = [0, 0];
  private triggers: -1 | 0 | 1 = 0;

  down(x: number, y: number, t = 0) { this.start = [x, y]; this.cur = [x, y]; this.at = t; }
  move(x: number, y: number) { this.cur = [x, y]; }
  up(x: number, y: number) {
    if (this.start) this.pending = { ...this.pending, ...resolve(x - this.start[0], y - this.start[1]) };
    this.start = null;
  }
  /** The right stick, -1..1 each way (y down): fires once as it passes out of the dead zone, resets when it comes back. */
  stick(x: number, y: number) {
    const out = Math.hypot(x, y) > 0.7;
    if (out && !this.pushed) this.pending = { ...this.pending, ...resolve(x * 100, y * 100) };
    this.pushed = out;
  }
  /** The pad's triggers, 0..1 each: the right one holds a manual, the left a nose manual. */
  shoulders(left: number, right: number) { this.triggers = right > 0.5 ? 1 : left > 0.5 ? -1 : 0; }
  /** The manual being held at time `t`: a trigger, or a press kept still for HOLD (nudged down for the nose). A hold is not a flick. */
  manual(t: number): -1 | 0 | 1 {
    if (this.triggers) return this.triggers;
    if (!this.start || t - this.at < HOLD || Math.hypot(this.cur[0] - this.start[0], this.cur[1] - this.start[1]) >= MIN_DRAG) return 0;
    return this.cur[1] - this.start[1] > NUDGE ? -1 : 1;
  }
  /** What the gesture asked for since the last call. The caller applies it to one step only. */
  take(): Partial<Pick<Input, "jump" | "flick">> {
    const p = this.pending ?? {};
    this.pending = null;
    return p;
  }
}

