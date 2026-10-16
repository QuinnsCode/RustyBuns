// The gesture layer: a mouse drag or the right stick, resolved into the plain sim inputs (an ollie,
// a flick trick) before step() ever sees them. No DOM here, so the tests drive it with numbers.
import type { Input } from "./sim.ts";

export const MIN_DRAG = 30; // pixels of drag (or 0.6 of stick travel, scaled by the caller) before it counts

/** Screen-space drag, y down. Up is the ollie; across and down are flicks: right kickflip, left heelflip, down shove-it. */
export function resolve(dx: number, dy: number): Partial<Pick<Input, "jump" | "flick">> {
  if (Math.hypot(dx, dy) < MIN_DRAG) return {};
  if (Math.abs(dx) > Math.abs(dy)) return { flick: dx > 0 ? "kickflip" : "heelflip" };
  return dy < 0 ? { jump: true } : { flick: "shove-it" };
}

/** Collects a drag or a stick push and hands back what it resolved to, once. */
export class Gestures {
  private start: [number, number] | null = null;
  private pending: Partial<Pick<Input, "jump" | "flick">> | null = null;
  private pushed = false;

  down(x: number, y: number) { this.start = [x, y]; }
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
  /** What the gesture asked for since the last call. The caller applies it to one step only. */
  take(): Partial<Pick<Input, "jump" | "flick">> {
    const p = this.pending ?? {};
    this.pending = null;
    return p;
  }
}

