// A festival site's physics: what makes two stages in one field harder than one stage in a room.
//
// - Bleed: each stage is heard at the other's audience. Highs beam and the air eats a little of them over distance
//   (ISO 9613-1), so aiming the stages apart and using a narrow pattern is what keeps them apart.
// - Bass travels: lows don't beam and air barely touches them, so the subs are what the neighbours hear. A cardioid
//   block (one sub of three turned round, delayed by the depth it sits back and flipped in polarity) cancels behind.
// - The licence: a limit at the mix position and at the nearest house as a 15-minute LAeq (an energy average, so a
//   loud song can be paid back by a quieter one), and a curfew.
// - Power: three-phase feeders from the generator compound. Each phase conductor drops I x R x L; an unbalanced load
//   also sends the difference home on the neutral, which drops the same way. Keep the drop under 5% and each feeder
//   under its ampacity.
// Plain functions over the Source and AWG math in sound.ts and power.ts; the festival level (apps/load-in) plays them.

import { type Source, type Vec3, SPEED_OF_SOUND, source } from "./sound.ts";
import { ohmsPerMetre } from "./power.ts";
import { gear } from "./catalog.ts";

// ---- air ----

/** Air absorption, dB per km, at 20 C and 70% relative humidity: ISO 9613-1's table at octave centres. */
export const AIR_DB_PER_KM: readonly (readonly [hz: number, db: number])[] = [
  [63, 0.1], [125, 0.4], [250, 1.0], [500, 1.9], [1000, 3.7], [2000, 9.7], [4000, 32.8], [8000, 117],
];

/** dB the air takes out over `metres` at `hz` (log-interpolated between octaves). */
export function airLoss(hz: number, metres: number): number {
  const t = AIR_DB_PER_KM;
  if (hz <= t[0]![0]) return (t[0]![1] * metres) / 1000;
  for (let k = 1; k < t.length; k++) {
    const [h1, d1] = t[k]!, [h0, d0] = t[k - 1]!;
    if (hz <= h1) return ((d0 + ((d1 - d0) * Math.log2(hz / h0)) / Math.log2(h1 / h0)) * metres) / 1000;
  }
  return (t[t.length - 1]![1] * metres) / 1000;
}

/** The band the mids-and-highs map stands for, Hz: where the A-weighted level of music sits. */
export const HIGH_HZ = 2000;

// ---- the sub block ----

export type SubMode = "omni" | "cardioid";

/**
 * A ground stack of three subs at `at`, facing `yaw`: all three forward ("omni"), or the third turned to face back,
 * set back by its depth, delayed by that depth's travel time and flipped in polarity ("cardioid"). Behind, its sound
 * meets the forward pair's at the same moment, upside down, and cancels; in front the two arrive a little apart and
 * mostly add.
 */
export function subBlock(id: string, at: Vec3, yaw: number, mode: SubMode, watts?: number): Source[] {
  const { w: width, d: depth } = gear(id).size;
  const across = { x: Math.cos(yaw), z: -Math.sin(yaw) }, ahead = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const side = (k: number, y = at.y): Vec3 => ({ x: at.x + across.x * k, y, z: at.z + across.z * k });
  const w = width + 0.05;
  if (mode === "omni") return [-w, 0, w].map((k) => source(id, side(k), { yaw, watts }));
  const back = { x: at.x - ahead.x * depth, y: at.y, z: at.z - ahead.z * depth };
  return [
    source(id, side(-w / 2), { yaw, watts }),
    source(id, side(w / 2), { yaw, watts }),
    source(id, back, { yaw: yaw + Math.PI, watts, invert: true, delayMs: (1000 * depth) / SPEED_OF_SOUND }),
  ];
}

// ---- the licence ----

/** One stretch of the show at a steady level: `seconds` long, `db` at the meter. */
export type Stretch = { seconds: number; db: number };

/** The equivalent continuous level of stretches: the energy average, 10 log10 (sum of t 10^(L/10) / sum of t). */
export function leq(stretches: readonly Stretch[]): number {
  let e = 0, t = 0;
  for (const s of stretches) { if (s.seconds > 0 && Number.isFinite(s.db)) e += s.seconds * 10 ** (s.db / 10); t += Math.max(0, s.seconds); }
  return t > 0 && e > 0 ? 10 * Math.log10(e / t) : -Infinity;
}

/** The LAeq over the last `window` seconds of a log (oldest first); quiet before the log started counts as silence. */
export function runningLeq(log: readonly Stretch[], window = 900): number {
  const out: Stretch[] = [];
  let left = window;
  for (let k = log.length - 1; k >= 0 && left > 0; k--) {
    const s = log[k]!, take = Math.min(s.seconds, left);
    out.push({ seconds: take, db: s.db });
    left -= take;
  }
  if (left > 0) out.push({ seconds: left, db: -Infinity });
  return leq(out);
}

/** The worst 15-minute LAeq anywhere in a log: what an officer with a meter would have written down. */
export function worstLeq(log: readonly Stretch[], window = 900): number {
  let worst = -Infinity;
  for (let k = 1; k <= log.length; k++) worst = Math.max(worst, runningLeq(log.slice(0, k), window));
  return worst;
}

// ---- power ----

/** Phase currents in amps, L1 L2 L3. */
export type Phases = readonly [number, number, number];

/** The neutral's current: the phasor sum of three phase currents 120 degrees apart (0 when balanced). */
export function neutralAmps([a, b, c]: Phases): number {
  return Math.sqrt(Math.max(0, a * a + b * b + c * c - a * b - b * c - c * a));
}

/** The worst phase's share over the average, 0 balanced: (max - mean) / mean. */
export function imbalance(p: Phases): number {
  const mean = (p[0] + p[1] + p[2]) / 3;
  return mean > 0 ? (Math.max(...p) - mean) / mean : 0;
}

/** Ampacity of a single flexible feeder conductor by AWG (-1 is 2/0): NEC Table 400.5(A)(1)-style cord values, and
 * type W single conductor for 2/0 (rounded down for a hot day in the sun). */
export const AMPACITY: Readonly<Record<number, number>> = { 10: 30, 8: 40, 6: 55, 4: 70, 2: 95, [-1]: 195 };

/** A feeder's voltage drop on its worst phase, as a share of the phase voltage: its own current and the neutral's
 * return, each through `metres` of conductor. */
export function feederDrop(awg: number, metres: number, p: Phases, volts = 120): number {
  const r = ohmsPerMetre(awg) * metres;
  return (Math.max(...p) * r + neutralAmps(p) * r) / volts;
}

/** The limit everyone works to: no more than 5% drop from the generator to the furthest load. */
export const MAX_DROP = 0.05;
