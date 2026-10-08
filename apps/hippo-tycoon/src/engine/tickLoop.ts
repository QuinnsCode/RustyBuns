// A fixed-step loop: an accumulator, absolute deadlines (so timer overshoot
// does not drift), a catch-up cap, and a guard so one throwing tick is logged
// instead of freezing the room forever. It knows nothing about the game.
import { TICK_HZ } from "../sim/rules.ts";
import type { Clock } from "./ports.ts";

export const TICK_MS = 1000 / TICK_HZ;
export const MAX_CATCHUP = 5;

export interface TickCallbacks {
  /** One fixed step. */
  step(): void;
  /** Once per wake after the step burst, even when no step was due. */
  wakeEnd(steps: number): void;
  /** A throw escaped step() or wakeEnd(). The loop already survived it. */
  fail(err: unknown): void;
}

export class TickLoop {
  private running = false;
  private timer: unknown = null;
  private acc = 0;
  private last = 0;
  private due = 0;

  constructor(private clock: Clock, private cb: TickCallbacks) {}

  get active() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true;
    this.acc = 0;
    this.last = this.due = this.clock.now();
    this.arm();
  }

  stop() {
    this.running = false;
    if (this.timer !== null) { this.clock.clear(this.timer); this.timer = null; }
  }

  private arm() {
    this.due += TICK_MS;
    const now = this.clock.now();
    if (this.due < now - TICK_MS * MAX_CATCHUP) this.due = now;   // far behind: resync, do not sprint
    this.timer = this.clock.schedule(() => this.wake(), Math.max(0, this.due - now));
  }

  private wake() {
    if (!this.running) return;
    const now = this.clock.now();
    this.acc += now - this.last; this.last = now;
    try {
      let steps = 0;
      while (this.acc >= TICK_MS && steps < MAX_CATCHUP) { this.cb.step(); steps++; this.acc -= TICK_MS; }
      this.cb.wakeEnd(steps);
      if (steps >= MAX_CATCHUP && this.acc > TICK_MS) this.acc = TICK_MS;
    } catch (err) {
      this.acc = 0;                           // do not retry the same doomed burst
      try { this.cb.fail(err); } catch { /* the reporter must never kill the loop */ }
    }
    if (this.running) this.arm();
  }
}
