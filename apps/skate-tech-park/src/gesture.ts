// The gesture layer: a mouse drag, a finger on the flick pad or the right stick, resolved through a flick profile
// (flick.ts) into the plain sim inputs (an ollie, a nollie, a flick trick) before step() ever sees them. No DOM here,
// so the tests drive it with numbers.
import { matchStroke, type Profile, type Resolved, type Stroke, strokeInput, type Zone, zoneAt } from "./flick.ts";
import { PROFILES } from "./flick-profiles.ts";

/** A drag of `dx, dy` pixels (y down) from `zone` through `profile` (the first in the library unless told otherwise). */
export function resolve(dx: number, dy: number, profile: Profile = PROFILES[0], zone: Zone = "mid", secs = 1): Resolved {
  return strokeInput(matchStroke(profile, zone, dx, dy, secs));
}

const FLICK_GRACE = 20; // steps (a third of a second): a flick that follows the ollie stroke straight on still lands in the air

/** Collects a drag or a stick push and hands back what it resolved to, once. */
export class Gestures {
  private start: [number, number] | null = null;
  private pending: Resolved | null = null;
  private pushed = false;
  private at = 0; // when the press began, in seconds
  private zone: Zone = "mid";
  private cur: [number, number] = [0, 0];
  private triggers: -1 | 0 | 1 = 0;
  private waited = 0; // steps a flick has waited for the board to leave the ground
  /** The stroke the last press matched (or null for none), with the zone it started in: the pad lights its path. */
  last: { stroke: Stroke | null; zone: Zone } | null = null;

  constructor(public profile: Profile = PROFILES[0]) {}

  /** A press at `x, y`. `along` is where it lands along the pad's board, 0 nose to 1 tail, or null off it. */
  down(x: number, y: number, t = 0, along: number | null = null) {
    this.start = [x, y]; this.cur = [x, y]; this.at = t; this.zone = zoneAt(this.profile, along);
  }
  move(x: number, y: number) { this.cur = [x, y]; }
  up(x: number, y: number, t = this.at) {
    if (this.start) {
      const s = matchStroke(this.profile, this.zone, x - this.start[0], y - this.start[1], t - this.at);
      this.last = { stroke: s, zone: this.zone };
      if (s) this.pending = { ...this.pending, ...strokeInput(s) };
    }
    this.start = null;
  }
  /** The right stick, -1..1 each way (y down): fires once as it passes out of the dead zone, resets when it comes back. */
  stick(x: number, y: number) {
    const out = Math.hypot(x, y) > 0.7;
    if (out && !this.pushed) this.pending = { ...this.pending, ...resolve(x * 100, y * 100, this.profile) };
    this.pushed = out;
  }
  /** The pad's triggers, 0..1 each: the right one holds a manual, the left a nose manual. */
  shoulders(left: number, right: number) { this.triggers = right > 0.5 ? 1 : left > 0.5 ? -1 : 0; }
  /** The manual being held at time `t`: a trigger, or a press kept still for the profile's hold (nudged down for the nose). A hold is not a flick. */
  manual(t: number): -1 | 0 | 1 {
    if (this.triggers) return this.triggers;
    const p = this.profile;
    if (!this.start || t - this.at < p.hold || Math.hypot(this.cur[0] - this.start[0], this.cur[1] - this.start[1]) >= p.minDrag) return 0;
    return this.cur[1] - this.start[1] > p.nudge ? -1 : 1;
  }
  /** What the gesture asked for since the last call. The caller applies it to one step only. A flick lifted right after
   * the ollie, while the board is still on the ground (`air` false), waits up to FLICK_GRACE steps for it to leave. */
  take(air = true): Resolved {
    const p = this.pending ?? {};
    this.pending = null;
    if (p.flick && !air && this.waited++ < FLICK_GRACE) { this.pending = { flick: p.flick }; const { flick: _, ...rest } = p; return rest; }
    this.waited = 0;
    return p;
  }
}
