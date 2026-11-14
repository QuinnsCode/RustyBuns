// The amp's live chain, apart from the audio thread so a test can play it:
// settings in, a rig out (rebuilding only what changed), and the speaker limiter.
import { AMPS, PEDALS, buildRig } from "../circuit/amps.ts";
import { POWER_VOLTS, Rig } from "../circuit/rig.ts";
import type { AmpSettings } from "./messages.ts";

/** Volts at the speaker for full scale: the power stage's ceiling plus the cabinet's bumps. */
export const FULL_SCALE = POWER_VOLTS * 1.5;
const CEILING = 0.89; // −1 dBFS

/** Under 0.7 untouched, then a soft knee that never passes −1 dBFS. NaN comes out as silence. */
export function limit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + (CEILING - 0.7) * Math.tanh((a - 0.7) / (CEILING - 0.7)));
}

/** The rig playing now, and what it was built from. */
export interface Live { rig: Rig; chain: string; keys: string[] }

/**
 * The rig for these settings. A different amp, a pedal in or out, or a new
 * oversampling builds a new chain; otherwise only links whose parts changed are
 * rebuilt (a tone knob: the tone stack; Drive: the pedal), and pots and the
 * power stage are just set.
 */
export function applySettings(s: AmpSettings, live: Live | null, sampleRate: number): Live {
  const amp = AMPS.find((a) => a.id === s.amp) ?? AMPS[0];
  const def = PEDALS.find((p) => p.id === s.pedal);
  const spec = buildRig(amp, s.knobs, def && { def, drive: s.drive });
  const chain = `${amp.id}|${def?.id ?? ""}|${s.oversample}`;
  const keys = spec.links.map((l) => JSON.stringify(l.net));
  if (!live || live.chain !== chain) return { rig: new Rig(spec, sampleRate, s.oversample), chain, keys };
  spec.links.forEach((l, i) => {
    if (keys[i] !== live.keys[i]) live.rig.setLink(i, l.net);
    live.rig.setGain(i, l.gain ?? 1);
  });
  live.rig.setPower(spec.power);
  live.rig.setNoise(spec.noise ?? 0);
  return { rig: live.rig, chain, keys };
}
