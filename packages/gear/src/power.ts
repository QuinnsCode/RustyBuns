// Amps and the speakers hung on them, the mains circuits and generators that feed it all,
// and what a run of speaker cable costs.

import { gear, type AmpSpec, type Gear } from "./catalog.ts";

/** Ohms of cabinets wired in parallel (daisy-chained off one amp channel): two 8s make 4. */
export function parallel(...ohms: number[]): number {
  return 1 / ohms.reduce((sum, r) => sum + 1 / r, 0);
}

/** Ohms of cabinets wired in series: two 8s make 16. */
export function series(...ohms: number[]): number {
  return ohms.reduce((sum, r) => sum + r, 0);
}

/** The lowest load an amp is rated for. */
export function minLoad(amp: AmpSpec): number {
  return amp.watts[2] === undefined ? 4 : 2;
}

/** What one channel puts into a load: watts, or a problem when the load is below the amp's minimum. */
export function ampWatts(amp: AmpSpec, ohms: number): { watts: number; problem?: string } {
  const min = minLoad(amp);
  if (ohms < min) return { watts: 0, problem: `${round(ohms)} ohms is below this amp's ${min} ohm minimum: it will overheat and shut down` };
  const w8 = amp.watts[8];
  const w4 = amp.watts[4];
  const w2 = amp.watts[2] ?? w4;
  // Above 8 ohms the amp's voltage holds, so watts fall as 1/R; between ratings, interpolate on 1/R.
  if (ohms >= 8) return { watts: (w8 * 8) / ohms };
  if (ohms >= 4) return { watts: between(1 / ohms, 1 / 8, 1 / 4, w8, w4) };
  return { watts: between(1 / ohms, 1 / 4, 1 / 2, w4, w2) };
}

function between(t: number, t0: number, t1: number, a: number, b: number): number {
  return a + ((t - t0) / (t1 - t0)) * (b - a);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ohms per metre of one copper conductor of an AWG gauge. */
export function ohmsPerMetre(awg: number): number {
  const d = 0.127e-3 * 92 ** ((36 - awg) / 39);
  return 1.724e-8 / ((Math.PI * d * d) / 4);
}

/** dB lost in a speaker cable run (both conductors, out and back) into a load. */
export function cableLoss(awg: number, metres: number, loadOhms: number): number {
  const r = 2 * metres * ohmsPerMetre(awg);
  return -20 * Math.log10(loadOhms / (loadOhms + r));
}

/** A wall circuit: volts and its breaker's amps. */
export type Circuit = { volts: number; amps: number };

export const CIRCUIT_15A: Circuit = { volts: 120, amps: 15 };
export const CIRCUIT_20A: Circuit = { volts: 120, amps: 20 };

/** What plugs in: ids or gear, one entry per box. */
export type Plugged = readonly (string | Gear)[];

/** Mains watts the gear draws, idle or at show level. */
export function drawWatts(items: Plugged, loud: boolean): number {
  let w = 0;
  for (const it of items) {
    const g = typeof it === "string" ? gear(it) : it;
    if (g.draw) w += loud ? g.draw.loud : g.draw.idle;
  }
  return w;
}

/** How a feed holds up: `trips` past its rating, `warn` past 80% (the continuous-load rule). */
export type Feed = { watts: number; limit: number; amps: number; trips: boolean; warn: boolean };

function feed(watts: number, limit: number, volts: number): Feed {
  return { watts, limit, amps: watts / volts, trips: watts > limit, warn: watts > 0.8 * limit };
}

/** A breaker under load: a 15 A circuit at 120 V carries 1800 W and trips past it. */
export function circuitLoad(items: Plugged, circuit: Circuit, loud = true): Feed {
  return feed(drawWatts(items, loud), circuit.volts * circuit.amps, circuit.volts);
}

/** A generator under load: its kVA times power factor is the watts it can run. */
export function generatorLoad(gen: Gear | string, items: Plugged, loud = true, volts = 120): Feed {
  const g = typeof gen === "string" ? gear(gen) : gen;
  if (!g.generator) throw new Error(`${g.id} is not a generator`);
  return feed(drawWatts(items, loud), g.generator.kva * 1000 * g.generator.powerFactor, volts);
}
