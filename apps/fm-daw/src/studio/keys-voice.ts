// The keys seat's sound, from the instrument that stands there (gear-models.ts keysSynth): each of the three families
// sounds as its kind does. Pure.
//   wood-poly  two saws a little apart through a 4-pole low-pass, a soft brassy filter swell, a held, warm body
//   fm-slab    the FM electric piano: two pairs, each a sine carrier with a sine on it, one pair at 14:1 for the tine's
//              bright knock that dies in a tenth of a second, harder hits brighter, a light chorus
//   drawbar    four sines in parallel at the drawbars' 16', 8', 4' and 2 2/3', on at once and held as long as the key is,
//              through the scanner-style chorus
import type { PolyKind } from "@rustybuns/models/polysynth";
import { patch } from "../presets.ts";
import type { Project } from "../project.ts";

export const KEYS_VOICES: Record<PolyKind, number[]> = {
  "wood-poly": patch({
    ops: { 0: [1, 1, 0.012, 1.4, 0.72, 0.45] },
    analog: { detune: 0.18, sub: 0.1, cutoff: 0.42, res: 0.16, fenv: [0.35, 0.03, 0.7], filter: 1, drive: 0.1 },
    vel: 0.45, velTone: 0.35, gain: 0.4, pan: 0.2, send: 0.35,
  }),
  "fm-slab": patch({
    ops: { 0: [1, 1, 0.001, 1.8, 0.2, 0.4], 1: [1, 0.32, 0.001, 0.9, 0.12, 0.3], 2: [1.002, 0.6, 0.001, 1.5, 0.18, 0.4], 3: [14, 0.16, 0.001, 0.09, 0, 0.08] },
    algo: 1, vel: 0.75, velTone: 0.55, gain: 0.45, pan: 0.2, chorus: 1, send: 0.3,
  }),
  drawbar: patch({
    ops: { 0: [0.5, 0.55, 0.003, 0.1, 1, 0.03], 1: [1, 0.8, 0.003, 0.1, 1, 0.03], 2: [2, 0.5, 0.003, 0.1, 1, 0.03], 3: [3, 0.32, 0.003, 0.1, 1, 0.03] },
    algo: 3, fb: 0.04, vel: 0.1, gain: 0.42, pan: 0.2, chorus: 3, send: 0.25,
  }),
};

/** The groove with its keys track (the first named keys) on `kind`'s voice. */
export function withKeysVoice(p: Project, kind: PolyKind | null): Project {
  const i = kind ? p.tracks.findIndex((t) => t.kind === "synth" && t.name.toLowerCase().includes("keys")) : -1;
  if (i < 0 || !kind) return p;
  return { ...p, tracks: p.tracks.map((t, k) => (k === i ? { ...t, params: KEYS_VOICES[kind].slice() } : t)) };
}
