// The parameter layout both engines share. native/crates/fm_daw/src/lib.rs has
// the same indices and the same RANGES; set_param clamps to them, so no slider,
// preset, MIDI CC or bad message can push a value outside what's been heard.

export const TRACKS = 12;
export const OPS = 4;
export const OP_FIELDS = 6; // ratio, level, attack, decay, sustain, release

export const P = {
  ratio: (op: number) => op * OP_FIELDS,
  level: (op: number) => op * OP_FIELDS + 1,
  attack: (op: number) => op * OP_FIELDS + 2,
  decay: (op: number) => op * OP_FIELDS + 3,
  sustain: (op: number) => op * OP_FIELDS + 4,
  release: (op: number) => op * OP_FIELDS + 5,
  ALGO: 24,
  FEEDBACK: 25,
  PITCH_AMT: 26,
  PITCH_DECAY: 27,
  NOISE: 28,
  NOISE_DECAY: 29,
  NOISE_TONE: 30,
  GAIN: 31,
  PAN: 32,
  VEL: 33,
  // The analog voice (MODE 1): two detuned saws and a sub through a resonant
  // low-pass, a filter envelope, one free-running LFO per track, glide and
  // drive. Its amp envelope is operator 1's attack/decay/sustain/release and
  // its level is operator 1's level, so note-off works the same in both modes.
  MODE: 34,
  DETUNE: 35,
  SUB: 36,
  CUTOFF: 37,
  RES: 38,
  FENV_AMT: 39,
  FENV_ATTACK: 40,
  FENV_DECAY: 41,
  LFO_RATE: 42,
  LFO_CUT: 43,
  LFO_PITCH: 44,
  GLIDE: 45,
  DRIVE: 46,
  /** How much of this track goes to Space (the shared reverb and delay). */
  SEND: 47,
  /**
   * Velocity to tone: how much harder hits brighten the note. Analog: the
   * cutoff moves up to 3 octaves either way. FM: modulation depth (and
   * feedback) scales from nothing to double.
   */
  VEL_TONE: 48,
  /**
   * The track's own filters, after its voices, before gain and pan. 0 is open
   * (and costs nothing). HICUT closes a low-pass from 20 kHz down to 20 Hz;
   * LOCUT raises a high-pass from 20 Hz up to 20 kHz. Automate them for
   * sweeps across sections, or set them to carve room for another part.
   */
  HICUT: 49,
  LOCUT: 50,
  /**
   * The analog voice's filter: 0 the 12 dB state-variable low-pass, 1 a 4-pole
   * transistor ladder (24 dB, saturating input, the fat old-school bass
   * filter), 2 a vowel filter (two formant band-passes; cutoff sweeps the vowel
   * from "oo" through "ah" to "ee", so an LFO on cutoff makes it talk).
   */
  FILTER: 51,
  /** Oscillator shape: 0 saws, 1 pulses; in between, a mix. */
  WAVE: 52,
  /** LFO to pulse width: 0 a steady square, 1 sweeping down to a thin 5% pulse. */
  PWM: 53,
  /** LFO shape: 0 sine, 1 triangle, 2 saw down, 3 square. */
  LFO_SHAPE: 54,
  /** 0: LFO_RATE in Hz. 1..8: locked to the tempo, LFO_DIVS beats per cycle. */
  LFO_SYNC: 55,
  /** 1: every note-on restarts the track's LFO (a wobble that starts on the note). */
  LFO_RETRIG: 56,
  /** The 80s polysynth bucket-brigade chorus: 0 off, 1 mode I, 2 mode II, 3 both (fast, shallow). */
  CHORUS: 57,
} as const;
export const NPARAMS = 58;

const OP_RANGES: [number, number][] = [[0.25, 16], [0, 1], [0.0005, 4], [0.005, 8], [0, 1], [0.005, 8]];
export const RANGES: [number, number][] = [
  ...Array.from({ length: OPS }, () => OP_RANGES).flat(),
  [0, 3],        // algo
  [0, 1],        // feedback
  [0, 48],       // pitch env amount, semitones
  [0.005, 2],    // pitch env decay, s
  [0, 1],        // noise level
  [0.005, 2],    // noise decay, s
  [0, 1],        // noise tone
  [0, 1],        // gain
  [-1, 1],       // pan
  [0, 1],        // velocity sensitivity
  [0, 1],        // mode: 0 FM, 1 analog
  [0, 1],        // saw detune, 0..50 cents either way
  [0, 1],        // sub (sine, octave down) level
  [0, 1],        // cutoff: 20 Hz * 2^(10 * x)
  [0, 1],        // resonance
  [-1, 1],       // filter envelope amount, +-6 octaves
  [0.0005, 4],   // filter envelope attack, s
  [0.005, 8],    // filter envelope decay, s
  [0.02, 20],    // LFO rate, Hz
  [0, 1],        // LFO to cutoff, +-4 octaves
  [0, 1],        // LFO to pitch, +-half a semitone
  [0, 1],        // glide, s
  [0, 1],        // drive after the filter
  [0, 1],        // send to Space
  [0, 1],        // velocity to tone
  [0, 1],        // hi-cut: 0 open, 1 closed down to 20 Hz
  [0, 1],        // low-cut: 0 open, 1 up to 20 kHz
  [0, 2],        // filter: 0 SVF, 1 ladder, 2 vowel
  [0, 1],        // wave: saw..pulse
  [0, 1],        // LFO to pulse width
  [0, 3],        // LFO shape
  [0, 8],        // LFO sync: 0 free, else LFO_DIVS[n]
  [0, 1],        // LFO retrigger
  [0, 3],        // chorus mode
];

/** Beats per LFO cycle for LFO_SYNC 1..8: 1 bar, 1/2, 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/32. */
export const LFO_DIVS = [0, 4, 2, 1, 2 / 3, 0.5, 1 / 3, 0.25, 0.125];
export const LFO_DIV_LABELS = ["free", "1/1", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/32"];
/** Pitch bend reaches this many semitones either way (a performance control, not saved). */
export const BEND_RANGE = 12;

export const clampParam = (i: number, v: number) => {
  const [lo, hi] = RANGES[i] ?? [0, 0];
  return Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo;
};

/** Which operators are carriers (heard) and who modulates whom, per algorithm. */
export const ALGOS = [
  { name: "Stack", diagram: "4 → 3 → 2 → 1", carriers: [0] },
  { name: "Two pairs", diagram: "(2 → 1) + (4 → 3)", carriers: [0, 2] },
  { name: "Three into one", diagram: "(2 + 3 + 4) → 1", carriers: [0] },
  { name: "Organ", diagram: "1 + 2 + 3 + 4", carriers: [0, 1, 2, 3] },
] as const;

// Engine limits, kept in step with the Rust crate.
export const VOICES = 8;
/** Peak output, -1 dBFS. The limiter never lets a sample past this. */
export const CEILING = 0.891;
/** Full modulator level = this many cycles of phase deviation (about 9.4 rad). */
export const MOD_DEPTH = 1.5;
/** Full feedback = this many cycles. Past ~0.5 FM feedback turns to noise. */
export const FB_DEPTH = 0.4;
