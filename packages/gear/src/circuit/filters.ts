// The rig's filters: an RBJ cookbook biquad, a chain of them, and the 8th-order
// Butterworth the oversampler uses on the way up and down.

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private b0: number, private b1: number, private b2: number, private a1: number, private a2: number) {}
  static make(kind: "lp" | "hp" | "peak", hz: number, q: number, sr: number, db = 0): Biquad {
    const w = (2 * Math.PI * hz) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q);
    if (kind === "peak") {
      const A = 10 ** (db / 40), a0 = 1 + al / A;
      return new Biquad((1 + al * A) / a0, (-2 * cw) / a0, (1 - al * A) / a0, (-2 * cw) / a0, (1 - al / A) / a0);
    }
    const a0 = 1 + al, k = kind === "lp" ? (1 - cw) / 2 : (1 + cw) / 2, s = kind === "lp" ? 1 : -1;
    return new Biquad(k / a0, (s * 2 * k) / a0, k / a0, (-2 * cw) / a0, (1 - al) / a0);
  }
  /** Takes another filter's coefficients and keeps its own state: a sweep without a click. */
  retune(to: Biquad): void { ({ b0: this.b0, b1: this.b1, b2: this.b2, a1: this.a1, a2: this.a2 } = to); }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export const chain = (fs: Biquad[], x: number) => { for (const f of fs) x = f.run(x); return x; };
/** 8th-order Butterworth low-pass as four biquads (the Q of each pole pair). */
export const butter8 = (hz: number, sr: number) => [0.5098, 0.6013, 0.9, 2.5629].map((q) => Biquad.make("lp", hz, q, sr));
