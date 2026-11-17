// Feedback, computed: a mic hears the wedge in front of it, the desk sends that back to the wedge, and round it goes.
// The loop's gain at each frequency is the channel's gain and send, its EQ, the mic's and the wedge's own response,
// how far the wedge is from the mic (6 dB per doubling), how far off the wedge's axis the mic sits, and how much of
// the wedge the mic hears from where it points (a cardioid hears little from behind, and less still of the highs).
// Above 0 dB at a frequency, that frequency rings. A notch there, a lower send, or turning the wedge fixes it.
import { aimTo, type Source, type Vec3, offAxisLoss } from "./sound.ts";

/** How a mic hears round itself: omni hears all round, a cardioid is deaf behind, a supercardioid at the back corners. */
export type Pattern = "omni" | "cardioid" | "supercardioid";

/** A mic on a stand: where its head is and which way it points (yaw 0 is +z, positive turns toward +x; pitch up). */
export type Mic = { pos: Vec3; yaw: number; pitch: number; pattern: Pattern };

/** One band of a channel's EQ: a bell at `hz`, `db` up or down; a narrow one (q 4 and up) is a notch. */
export type EqBand = { hz: number; db: number; q: number };

/** A channel and the wedges it is sent to. `gainDb` is the trim over the singer's nominal; each wedge has its send. */
export type Loop = { mic: Mic; gainDb: number; eq: readonly EqBand[]; wedges: readonly { wedge: Source; sendDb: number }[] };

/** The third-octave bands a ring is looked for in, Hz: the band a graphic EQ or an RTA shows. */
export const BANDS: readonly number[] = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];

/**
 * The loop at unity, dB: with the trim and the send at 0 a voice at the mic comes back out of the wedge this much louder
 * at 1 m, on both axes. A singer at 94 dB SPL on the grille and the wedge at 100 dB a metre out is a usual monitor mix.
 */
export const UNITY_LOOP_DB = 6;

/** The quietest a mic pattern gets, dB: the wedge bounces off the singer and the back wall, so no null is deeper. */
const NULL_FLOOR = -15;

const oct = (f: number, hz: number) => Math.log2(f / hz);
const bell = (f: number, hz: number, db: number, widthOct: number) => db * Math.exp(-0.5 * (oct(f, hz) / widthOct) ** 2);

/**
 * How much of a sound from `angle` radians off axis a pattern hears, dB (0 on axis). Below 250 Hz every pattern widens
 * toward omni, as real ones do, so the back of a cardioid hears the low mids.
 */
export function pickup(pattern: Pattern, angle: number, freq = 1000): number {
  const a0 = pattern === "omni" ? 1 : pattern === "cardioid" ? 0.5 : 0.37;
  const wide = Math.min(1, Math.max(0, oct(250, freq) / 2)) * 0.35;
  const a = a0 + (1 - a0) * wide;
  return Math.max(NULL_FLOOR, 20 * Math.log10(Math.max(1e-6, Math.abs(a + (1 - a) * Math.cos(angle)))));
}

/** A vocal mic's own lift: a presence peak round 5 kHz and the bass rolled off under 200 Hz. */
export function micResponse(freq: number): number {
  return bell(freq, 5000, 5, 0.3) - (freq < 200 ? 6 * oct(200, freq) : 0);
}

/** A wedge's own lift: a bump at the horn's crossover round 2.5 kHz. */
export function wedgeResponse(freq: number): number {
  return bell(freq, 2500, 3, 0.4);
}

/** What a channel's EQ does at `freq`, dB: each band a bell `1 / q` octaves wide. */
export function eqAt(eq: readonly EqBand[], freq: number): number {
  let db = 0;
  for (const b of eq) db += bell(freq, b.hz, b.db, 1 / (2 * Math.max(0.3, b.q)));
  return db;
}

/** The angle between where a mic points and the direction to `p`, radians. */
export function offMicAxis(mic: Mic, p: Vec3): number {
  const { h, v } = aimTo(mic, p);
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(h) * Math.cos(v))));
}

/** The loop gain at `freq` through one wedge, dB. */
function through(l: Loop, w: Loop["wedges"][number], freq: number): number {
  const { h, v, d } = aimTo(w.wedge, l.mic.pos);
  return (
    UNITY_LOOP_DB + l.gainDb + w.sendDb + eqAt(l.eq, freq) + micResponse(freq) + wedgeResponse(freq) +
    pickup(l.mic.pattern, offMicAxis(l.mic, w.wedge.pos), freq) - offAxisLoss(w.wedge.speaker, h, v) - 20 * Math.log10(Math.max(d, 0.3))
  );
}

/** The loop gain at `freq`, dB, every wedge the channel is sent to added as power. Over 0 it rings. */
export function loopGain(l: Loop, freq: number): number {
  let p = 0;
  for (const w of l.wedges) if (Number.isFinite(w.sendDb)) p += 10 ** (through(l, w, freq) / 10);
  return p > 0 ? 10 * Math.log10(p) : -Infinity;
}

export type Feedback = {
  /** Each band's loop gain, dB, in `BANDS` order. */
  bands: number[];
  /** The band nearest to ringing, Hz, and its loop gain. */
  worst: { hz: number; db: number };
  /** The bands over 0 dB, loudest first: what you hear ring. */
  ringing: number[];
  /** How far under ringing the worst band sits, dB (negative when it rings): the gain left before feedback. */
  margin: number;
};

/** The loop over every band: what rings, and how much gain is left before anything does. */
export function feedback(l: Loop): Feedback {
  const bands = BANDS.map((f) => loopGain(l, f));
  let i = 0;
  bands.forEach((db, j) => { if (db > bands[i]!) i = j; });
  const worst = { hz: BANDS[i]!, db: bands[i]! };
  const ringing = BANDS.map((hz, j) => ({ hz, db: bands[j]! })).filter((b) => b.db > 0).sort((a, b) => b.db - a.db).map((b) => b.hz);
  return { bands, worst, ringing, margin: -worst.db };
}
