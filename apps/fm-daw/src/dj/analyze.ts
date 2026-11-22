// The DJ decks' arithmetic, with no Web Audio in it (engine.ts plays it, panel.ts draws it): a track's tempo and where
// its first beat lands, found from the sound; its waveform at any width; where a deck is on the beat, and the pitch and
// jump that bring it into step with the other; loops and beat jumps on the grid; the crossfader's two curves; and what
// the EQ and filter knobs do. A knob is -1 to 1 throughout, 0 in the middle.

/** Tempos a track is read as: anything slower is doubled, anything faster halved (a 70 BPM half-time beat is 140). */
export const BPM_RANGE = [85, 175] as const;
/** The pitch fader's ranges, per cent either way (the button under it steps through them). */
export const PITCH_RANGES = [8, 16, 50] as const;

/** A track's beat grid: its tempo, and the time in seconds of a downbeat near its start. */
export interface Grid { bpm: number; offset: number }

/**
 * The loudness of `samples` in `buckets` slices, each the slice's peak (0 to 1): the waveform, as wide as it is drawn.
 * `from` and `to` pick a stretch (sample indexes) for a zoomed view.
 */
export function peaks(samples: Float32Array, buckets: number, from = 0, to = samples.length): Float32Array {
  const out = new Float32Array(buckets), span = Math.max(1, to - from) / buckets;
  for (let b = 0; b < buckets; b++) {
    const a = Math.max(0, Math.floor(from + b * span)), z = Math.min(samples.length, Math.max(a + 1, Math.floor(from + (b + 1) * span)));
    let m = 0;
    for (let i = a; i < z; i++) { const v = Math.abs(samples[i]!); if (v > m) m = v; }
    out[b] = Math.min(1, m);
  }
  return out;
}

/** The hop of the onset envelope, seconds: 100 frames a second. */
const HOP_S = 0.01;

/**
 * How hard the sound rises in each 10 ms hop: the energy of a low-passed copy (kicks and bass drive dance music),
 * its rise hop to hop and only the rise, so a beat is a spike and the silence after it is nothing.
 */
export function onsets(mono: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(rate * HOP_S)), n = Math.floor(mono.length / hop), env = new Float32Array(n);
  // a one-pole low-pass at about 150 Hz
  const k = 1 - Math.exp((-2 * Math.PI * 150) / rate);
  let lp = 0;
  for (let h = 0; h < n; h++) {
    let e = 0;
    for (let i = h * hop; i < (h + 1) * hop; i++) { lp += k * (mono[i]! - lp); e += lp * lp; }
    env[h] = Math.sqrt(e / hop);
  }
  const out = new Float32Array(n);
  for (let h = 1; h < n; h++) out[h] = Math.max(0, env[h]! - env[h - 1]!);
  return out;
}

/**
 * The tempo and the first downbeat of a track, from its sound (mono, at `rate`): the lag at which the onset envelope
 * best matches itself, read as a tempo within BPM_RANGE and refined to a tenth of a beat a minute, then the phase where
 * beats on that tempo land on the most onsets. Reads at most the first two minutes. Null when it hears no beat.
 */
export function detectGrid(mono: Float32Array, rate: number): Grid | null {
  const env = onsets(mono.subarray(0, Math.min(mono.length, rate * 120)), rate), fps = 1 / HOP_S;
  if (env.length < fps * 4) return null;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  if (mean <= 1e-6) return null;
  // score a tempo by how much onset falls on its beats (and halfway, a little), at the best phase
  const score = (bpm: number) => {
    const per = (60 / bpm) * fps;
    let best = 0;
    for (let ph = 0; ph < per; ph += 1) {
      let s = 0;
      for (let t = ph; t < env.length; t += per) { const i = Math.round(t); s += env[i]! + 0.5 * (env[Math.round(t + per / 2)] ?? 0); }
      if (s > best) best = s;
    }
    return best / (env.length / per);
  };
  let bpm = 0, top = -1;
  for (let b = BPM_RANGE[0]; b <= BPM_RANGE[1]; b += 0.5) { const s = score(b); if (s > top) { top = s; bpm = b; } }
  for (let b = bpm - 0.5; b <= bpm + 0.5; b += 0.05) { const s = score(b); if (s > top) { top = s; bpm = b; } }
  if (top < mean * 1.5) return null;
  bpm = Math.round(bpm * 10) / 10;
  // the phase: the shift, to a hop, where the beats land on the most onsets
  const per = (60 / bpm) * fps;
  let phase = 0, most = -1;
  for (let ph = 0; ph < per; ph += 0.25) {
    let s = 0;
    for (let t = ph; t < env.length; t += per) s += env[Math.round(t)] ?? 0;
    if (s > most) { most = s; phase = ph; }
  }
  // the onset is the hop where the rise is; the beat starts a hop before it
  return { bpm, offset: Math.max(0, (phase - 1) / fps) };
}

/** Where a deck at `pos` seconds is in its beat, 0 to 1. */
export function beatPhase(pos: number, g: Grid): number {
  const b = ((pos - g.offset) * g.bpm) / 60;
  return b - Math.floor(b);
}

/** The playback rate that brings a deck of tempo `bpm` to `target` BPM (1 is the track as made). */
export const syncRate = (bpm: number, target: number) => target / bpm;

/**
 * How far (seconds of the deck's own track) to move a deck so its beat lines up with another's: the shortest way, at
 * most half a beat either way.
 */
export function phaseJump(pos: number, g: Grid, otherPhase: number): number {
  let d = otherPhase - beatPhase(pos, g);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (d * 60) / g.bpm;
}

/** The beat at or before `pos` (seconds), on the grid. */
export function snap(pos: number, g: Grid): number {
  const per = 60 / g.bpm;
  return g.offset + Math.floor((pos - g.offset) / per + 1e-6) * per;
}

/** A loop of `beats` starting on the beat at or before `pos` (the first beat, before it): its start and end, seconds. */
export function loopAt(pos: number, beats: number, g: Grid): { start: number; end: number } {
  const start = snap(Math.max(pos, g.offset), g);
  return { start, end: start + (beats * 60) / g.bpm };
}

/** Where a deck playing a loop is, when the clock says `raw` seconds: inside it, round and round, once it's reached its start. */
export function inLoop(raw: number, loop: { start: number; end: number } | null): number {
  if (!loop || raw < loop.end) return raw;
  const len = loop.end - loop.start;
  return len > 0 ? loop.start + ((raw - loop.start) % len) : raw;
}

/** The loop lengths the buttons offer, in beats. */
export const LOOPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32] as const;

/**
 * The crossfader's gains for A and B at `x` (-1 all A, 1 all B). `smooth` blends at constant power (both at -3 dB in
 * the middle), for mixing; `cut` is a scratch DJ's: both full across the middle, each cut in the last few per cent.
 */
export function crossfade(x: number, curve: "smooth" | "cut" = "smooth"): [number, number] {
  const t = Math.min(1, Math.max(-1, x));
  if (curve === "cut") return [t > 0.94 ? 0 : 1, t < -0.94 ? 0 : 1];
  const a = ((t + 1) / 2) * (Math.PI / 2);
  return [Math.cos(a), Math.sin(a)];
}

/** A channel fader's gain at `v` (0 to 1): a square law, so the top of its travel is where the fine control is. */
export const faderGain = (v: number) => { const c = Math.min(1, Math.max(0, v)); return c * c; };

/** An EQ knob's boost or cut in dB: the middle is flat, up to +6, down to a kill (-40, as good as gone). */
export function eqDb(knob: number): number {
  const k = Math.min(1, Math.max(-1, knob));
  return k >= 0 ? k * 6 : k <= -0.98 ? -40 : k * 26;
}

/**
 * What the one filter knob does: left of the middle a low-pass sweeping down from 20 kHz to 150 Hz, right of it a
 * high-pass sweeping up from 20 Hz to 8 kHz, and a dead zone in the middle where it does nothing.
 */
export function filterAt(knob: number): { type: "lowpass" | "highpass"; freq: number } | null {
  const k = Math.min(1, Math.max(-1, knob));
  if (Math.abs(k) < 0.04) return null;
  const t = (Math.abs(k) - 0.04) / 0.96;
  return k < 0 ? { type: "lowpass", freq: 20000 * Math.pow(150 / 20000, t) } : { type: "highpass", freq: 20 * Math.pow(8000 / 20, t) };
}

/** A time as a deck's screen shows it: minutes, seconds and tenths. */
export function clock(s: number): string {
  const t = Math.max(0, s), m = Math.floor(t / 60), r = t - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, "0")}`;
}
