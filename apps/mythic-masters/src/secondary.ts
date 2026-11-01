// Secondary motion: the small, late, overlapping movement that makes a body read as alive. Head tips, ears
// and the tail follow their goals through damped springs (they lag the body, overshoot a little and settle),
// the chest breathes, the eyes blink and an ear flicks now and then, all tuned by archetype: a tank is slow
// and heavy, a skirmisher twitchy, a flyer light. The springs also take the raw per-tick goal terms (a sine
// at tick * 0.7, the idle glance) so they no longer reach the IK solver as steps. Nothing here allocates per
// frame: state lives in two preallocated arrays and results are written into the caller's vector.
import type { Archetype } from "./roster.ts";

/** Per archetype: spring stiffness (rad/s squared) and damping ratio (under 1 overshoots), breaths per second
 * and their depth, seconds between blinks, seconds between ear flicks, and how hard a flick kicks. */
const FEEL: Record<Archetype, { k: number; zeta: number; hz: number; depth: number; blink: number; flick: number; kick: number }> = {
  tank: { k: 55, zeta: 0.85, hz: 0.28, depth: 0.014, blink: 6, flick: 9, kick: 0.5 },
  bruiser: { k: 90, zeta: 0.6, hz: 0.4, depth: 0.011, blink: 4.5, flick: 6, kick: 0.8 },
  flyer: { k: 80, zeta: 0.55, hz: 0.55, depth: 0.007, blink: 4, flick: 5, kick: 0.9 },
  skirmisher: { k: 150, zeta: 0.4, hz: 0.75, depth: 0.008, blink: 2.8, flick: 3, kick: 1.3 },
};

/** The slowest step a spring takes, so a hitch in the frame rate can't blow it up. */
const MAX_DT = 1 / 30;
const BLINK_TIME = 0.14;

export class Secondary {
  private readonly feel;
  /** Spring state, three numbers a spring: heads first, the tail last. */
  private readonly x: Float64Array;
  private readonly v: Float64Array;
  private readonly heads: number;
  private clock = 0;
  private seed: number;
  private nextBlink: number;
  private nextFlick: number;
  private blinkAt = -1;
  private ready = false;

  constructor(archetype: Archetype, heads: number, seed = 1) {
    this.feel = FEEL[archetype];
    this.heads = heads;
    this.x = new Float64Array((heads + 1) * 3);
    this.v = new Float64Array((heads + 1) * 3);
    this.seed = (seed * 2654435761) >>> 0 || 1;
    this.nextBlink = this.feel.blink * (0.3 + this.rand());
    this.nextFlick = this.feel.flick * (0.3 + this.rand());
  }

  private rand(): number {
    this.seed = (this.seed ^ (this.seed << 13)) >>> 0; this.seed = (this.seed ^ (this.seed >>> 17)) >>> 0; this.seed = (this.seed ^ (this.seed << 5)) >>> 0;
    return this.seed / 4294967296;
  }

  /** Advance the clock and the random events (a blink, an ear flick); call once a frame before the springs. */
  step(dt: number) {
    dt = Math.min(dt, MAX_DT);
    this.clock += dt;
    if (this.clock >= this.nextBlink) { this.blinkAt = this.clock; this.nextBlink = this.clock + this.feel.blink * (0.5 + this.rand()); }
    if (this.clock >= this.nextFlick) {
      this.nextFlick = this.clock + this.feel.flick * (0.5 + this.rand());
      // a flick kicks one tip other than the first (the first is the head itself): the ears and horns
      if (this.heads > 1) { const i = 1 + Math.floor(this.rand() * (this.heads - 1)); this.v[i * 3 + 2]! += (this.rand() < 0.5 ? -1 : 1) * this.feel.kick; this.v[i * 3 + 1]! += this.feel.kick * 0.4; }
    }
  }

  /** Spring `slot` (a head tip, or `heads` for the tail) toward `(tx, ty, tz)` in units of `h`, written to `out`.
   * `soft` loosens the spring (the tail is slower than the head). */
  follow(slot: number, tx: number, ty: number, tz: number, dt: number, h: number, out: { x: number; y: number; z: number }, soft = 1) {
    dt = Math.min(dt, MAX_DT);
    const i = slot * 3, x = this.x, v = this.v, k = this.feel.k * soft, c = 2 * this.feel.zeta * Math.sqrt(k);
    if (!this.ready) { x[i] = tx; x[i + 1] = ty; x[i + 2] = tz; }
    // a kick is in units of h (so a big beast flicks big)
    v[i] = v[i]! + (k * (tx - x[i]!) - c * v[i]!) * dt;
    v[i + 1] = v[i + 1]! + (k * (ty - x[i + 1]!) - c * v[i + 1]!) * dt;
    v[i + 2] = v[i + 2]! + (k * (tz - x[i + 2]!) - c * v[i + 2]!) * dt;
    x[i] = x[i]! + v[i]! * dt; x[i + 1] = x[i + 1]! + v[i + 1]! * dt; x[i + 2] = x[i + 2]! + v[i + 2]! * dt;
    out.x = x[i]!; out.y = x[i + 1]!; out.z = x[i + 2]!;
    void h;
  }

  /** Call after the last `follow` of a frame: the springs now hold real state. */
  settle() { this.ready = true; }

  /** The chest's breath, -1 to 1 slowly; times `feel.depth` for the scale. */
  breath(): number { return Math.sin(this.clock * Math.PI * 2 * this.feel.hz); }
  get depth() { return this.feel.depth; }

  /** How shut the eyes are, 0 open to 1 closed: a quick triangle. */
  lids(): number {
    const t = (this.clock - this.blinkAt) / BLINK_TIME;
    return this.blinkAt < 0 || t > 1 ? 0 : 1 - Math.abs(t * 2 - 1);
  }
}
