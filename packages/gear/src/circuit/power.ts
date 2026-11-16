// The back end of the amp: a push-pull pair (or two) of output tubes, the output
// transformer and the supply that feeds them. Behavioural, not a netlist: each
// tube is a plate-current curve on its grid, so the power stage costs a few `exp`s
// a sample instead of another Newton solve. What it gets right:
//
// - Class AB: each tube idles at a little current and carries its half of the
//   wave; the transformer hears the difference. Where one hands over to the
//   other, the curves bend (crossover), and driven hard, the grids conduct and
//   flatten the top.
// - The plate can't swing below the knee, so the ceiling is the supply minus it.
// - Sag: the supply has a resistance (a tube rectifier more than diodes), so a
//   loud chord pulls the supply down, lowers the ceiling and the amp compresses,
//   then it recovers over a tenth of a second.
// - The speaker is the transformer's load. Mismatch it and the plates see more or
//   less (16 ohms on the 8 ohm tap clips sooner); take it away and there is nothing to dump the energy into: the plate
//   voltage flies up past the tubes' rating the first time you play, and the
//   amp is broken (`fault`) and silent until it is rebuilt. Idle hiss alone won't do it.
//
// apps/fm-daw/native/crates/fm_daw/src/circuit.rs `PushPull` is this, step for step.

/** The supply at idle, volts. */
export const B_PLUS = 450;
/** The plate's knee: it can't swing closer to the cathode than this. */
const KNEE = 50;
/** The grid's resting bias, and where the tube cuts off, volts. */
const BIAS = -36, CUTOFF = -45, WIDTH = 3;
/** Plate current scale, amps: about 35 mA at idle, near 0.4 A with the grid at 0 V. */
const K = 6.6e-3;
/** Plate-to-plate load one pair wants, ohms, on the transformer's 8 ohm tap. */
const ZAA = 4300, TAP = 8;
/**
 * With nothing on the jack, the plates' signal current has nowhere to go: past
 * this many amps of swing the transformer's kick runs to thousands of volts and
 * arcs over. Idle hiss is a few milliamps; a note played at all is hundreds.
 */
export const FLYBACK_AMPS = 0.1;
/** Grid volts for one preamp volt at drive 1 (the old `tanh` stage's scale: 40 V at drive 1 is the grids at 0 V). */
const GRID = 0.9;

export interface PowerSpec {
  /** Output tube pairs: 1 is a 50 W amp's pair, 2 a 100 W amp's quad. */
  pairs: number;
  /** The supply's resistance, ohms: about 250 for a tube rectifier, 60 for diodes. */
  sag: number;
  /** Ohms on the speaker jack; 0 is nothing plugged in. */
  load: number;
}

export const DEFAULT_POWER: PowerSpec = { pairs: 1, sag: 120, load: 8 };

const softplus = (x: number) => (x > 30 ? x : Math.log1p(Math.exp(x)));
/** One output tube's plate current for a grid voltage, amps. The grid conducts above 0 V and won't go much past it. */
const plate = (g: number) => {
  const gg = g - softplus(g);
  return K * softplus((gg - CUTOFF) / WIDTH) ** 1.5;
};
const IDLE = plate(BIAS);

export type Fault = "open-load";

export class PushPull {
  private pairs: number;
  private sag: number;
  private load: number;
  /** The supply's current, smoothed, amps (what the rectifier and filter caps see). */
  private draw: number;
  private readonly attack: number;
  private readonly release: number;
  /** The transformer: one-pole high-pass for the primary's inductance, one-pole low-pass for its leakage. */
  private hpX = 0;
  private hpY = 0;
  private lp = 0;
  private readonly hpA: number;
  private readonly lpA: number;
  /** The supply now, volts. */
  supply = B_PLUS;
  fault: Fault | null = null;

  constructor(spec: PowerSpec, sampleRate: number) {
    this.pairs = spec.pairs; this.sag = spec.sag; this.load = spec.load;
    this.draw = 2 * IDLE * spec.pairs;
    this.attack = 1 - Math.exp(-1 / (0.015 * sampleRate));
    this.release = 1 - Math.exp(-1 / (0.12 * sampleRate));
    this.hpA = Math.exp((-2 * Math.PI * 35) / sampleRate);
    this.lpA = Math.exp((-2 * Math.PI * 9000) / sampleRate);
  }

  /** A speaker plugged in (ohms) or pulled out (0). Doesn't mend a blown amp. */
  setLoad(ohms: number): void { this.load = ohms; }

  /** Preamp volts in, `drive` the Master; volts across the speaker out. */
  step(x: number, drive: number): number {
    if (this.fault) return 0;
    const d = x * drive * GRID;
    const a = plate(BIAS + d), b = plate(BIAS - d);
    const n = this.pairs;
    // Sag: the supply follows its current, quickly down and slowly back.
    const now = (a + b) * n;
    this.draw += (now - this.draw) * (now > this.draw ? this.attack : this.release);
    const supply = B_PLUS - this.sag * (this.draw - 2 * IDLE * n);
    this.supply = supply;
    const swing = (a - b) * n;
    if (this.load <= 0) {
      if (Math.abs(swing) > FLYBACK_AMPS) this.fault = "open-load";
      return 0; // nothing on the jack, nothing to hear
    }
    // The plates' load: the speaker through the transformer's turns ratio, shared between the pairs.
    const raw = (swing * (ZAA / n) * (this.load / TAP)) / 2;
    const ceiling = 2 * Math.max(supply - KNEE, 1);
    const vp = ceiling * Math.tanh(raw / ceiling);
    // The transformer: no DC through it, and the top rolls off.
    const hp = this.hpA * (this.hpY + vp - this.hpX);
    this.hpX = vp; this.hpY = hp;
    this.lp = hp + this.lpA * (this.lp - hp);
    // Down the turns ratio to the speaker.
    return this.lp / Math.sqrt(ZAA / n / TAP);
  }
}
