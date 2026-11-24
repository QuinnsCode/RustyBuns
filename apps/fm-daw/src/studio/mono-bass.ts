// The bass seat's sound: a fat filtered analog bass, one voice at a time with glide, as the mono synth it sits at
// would play. The jam room's groove starts with it on the bass track; a held note gives way to the next one pressed
// on the same track at the bass seat, and the engine's glide slides from one to the other. Pure.
import { patch } from "../presets.ts";
import type { Project } from "../project.ts";

/** Two saws a little apart and a sub through the 4-pole ladder, a snappy filter envelope, some drive and a short glide. */
export const MONO_BASS = patch({
  ops: { 0: [1, 1, 0.003, 0.45, 0.75, 0.09] },
  analog: { detune: 0.14, sub: 0.55, cutoff: 0.3, res: 0.42, fenv: [0.5, 0.002, 0.28], glide: 0.06, drive: 0.35, filter: 1 },
  vel: 0.5, velTone: 0.3, gain: 0.5, send: 0,
});

/** The bass-line box's: one saw through the diode ladder, the resonance high and the cutoff low, a short sharp filter
 *  decay so each note squelches, a quick slide from note to note and the drive that makes it bite. */
export const BOX_BASS = patch({
  ops: { 0: [1, 1, 0.002, 0.3, 0.6, 0.06] },
  analog: { detune: 0, sub: 0, cutoff: 0.22, res: 0.72, fenv: [0.62, 0.001, 0.16], glide: 0.09, drive: 0.45, filter: 3 },
  vel: 0.6, velTone: 0.55, gain: 0.95, send: 0,
});

/** The groove with its bass track (the first named bass) on the bass seat's patch: the mono's, or the box's. */
export function withMonoBass(p: Project, kind: "mono" | "box" = "mono"): Project {
  const i = p.tracks.findIndex((t) => t.kind === "synth" && t.name.toLowerCase().includes("bass"));
  if (i < 0) return p;
  return { ...p, tracks: p.tracks.map((t, k) => (k === i ? { ...t, params: (kind === "box" ? BOX_BASS : MONO_BASS).slice() } : t)) };
}

/** What a new note on `track` takes over from: the notes you hold on that track (by what holds them), to let up first. */
export const monoSteal = (holding: ReadonlyMap<string, { track: number }>, track: number): string[] =>
  [...holding].filter(([, h]) => h.track === track).map(([by]) => by);
