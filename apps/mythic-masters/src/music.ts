// The Book's music: a small seeded score played on Web Audio, no files. The title and the Book's pages get a slow drone
// with a music-box line in D dorian; the open world a very quiet G mixolydian pluck by day and an E phrygian bell by
// night, leaving room for the wilds (src/world/ambience.ts); a fight a driving low ostinato on a frame-drum pulse in
// A phrygian dominant that lifts (doubled drum, a high line) when someone is near the end; and short stings for a win,
// a loss and a bind. The notes come from `phrase` and `sting`, pure functions of the cue, the bar and the seed
// (mulberry32), so a test reads the score without audio. The player schedules a bar at a time ahead on the audio clock
// (a tick each frame that mostly returns at once), crossfades between cues, ducks under the Settings card, sleeps
// while the tab is hidden, and wakes on the first key or tap. Silent where there is no AudioContext. Its loudness is
// read live from Settings > Audio (Music volume, Music on), so the slider works while it plays.
import { mulberry32 } from "@rustybuns/util";

export type Cue = "book" | "day" | "night" | "fight";
export type Sting = "win" | "loss" | "bind";
export type Voice = "drone" | "pluck" | "box" | "bass" | "drum" | "bell" | "reed";
/** One note: `at` and `len` in beats from the start of its bar (or sting), `midi` its pitch, `vel` 0 to 1. */
export interface Note { at: number; len: number; midi: number; voice: Voice; vel: number }

/** Each cue's tempo, beats to a bar, root (MIDI) and mode (semitones up from the root). */
export const SCORE: Record<Cue, { bpm: number; beats: number; root: number; mode: number[] }> = {
  book: { bpm: 54, beats: 4, root: 50, mode: [0, 2, 3, 5, 7, 9, 10] }, // D dorian: old, a little sad, not grim
  day: { bpm: 66, beats: 3, root: 55, mode: [0, 2, 4, 5, 7, 9, 10] }, // G mixolydian: open air, a folk lilt
  night: { bpm: 48, beats: 4, root: 52, mode: [0, 1, 3, 5, 7, 8, 10] }, // E phrygian: the flat second, something out there
  fight: { bpm: 118, beats: 4, root: 45, mode: [0, 1, 4, 5, 7, 8, 10] }, // A phrygian dominant: a drum circle in a cave
};
export const STING_BPM = 96;
const SALT: Record<Cue | Sting, number> = { book: 0x1b3, day: 0x2c5, night: 0x3d7, fight: 0x4e9, win: 0x5fb, loss: 0x60d, bind: 0x71f };

/** Degree `d` of a cue's mode (7 and up climb octaves, below 0 falls) as a MIDI note. */
export function degree(cue: Cue, d: number): number {
  const s = SCORE[cue], n = s.mode.length, o = Math.floor(d / n);
  return s.root + s.mode[((d % n) + n) % n]! + 12 * o;
}
const rngOf = (key: Cue | Sting, bar: number, seed: number) => mulberry32((seed ^ Math.imul(bar + 1, 0x9e3779b1) ^ Math.imul(SALT[key], 0x85ebca6b)) >>> 0);
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

/** The notes of bar `bar` of `cue`. `lift` is the fight's last stretch (someone near zero health). Pure. */
export function phrase(cue: Cue, bar: number, seed: number, lift = false): Note[] {
  const r = rngOf(cue, bar, seed), s = SCORE[cue], out: Note[] = [];
  const add = (at: number, len: number, d: number, voice: Voice, vel: number) => out.push({ at, len, midi: degree(cue, d), voice, vel });
  if (cue === "book") {
    add(0, s.beats + 1, -7, "drone", 0.55);
    if (bar % 2 === 0) add(0, s.beats + 1, -3, "drone", 0.3); // the fifth below, every other bar
    if (bar % 4 !== 3) { // the fourth bar of each four breathes
      let d = 7 + Math.floor(r() * 5);
      const slots = [0, 1, 1.5, 2, 3, 3.5].filter(() => r() < 0.5);
      for (const at of slots.length ? slots : [1]) { add(at, 1.5, d, "box", 0.5 + r() * 0.3); d += pick(r, [-2, -1, 1, 2]); }
    }
    if (bar % 8 === 7) { add(3, 0.25, -2, "pluck", 0.5); add(3.5, 0.5, -3, "pluck", 0.45); } // the Book clears its throat
  } else if (cue === "day") {
    add(0, s.beats + 1, -7, "drone", 0.22);
    if (r() < 0.6) add(pick(r, [0, 1, 2]), 1.5, 2 + Math.floor(r() * 6), "pluck", 0.32);
    if (r() < 0.25) add(2.5, 0.5, 7 + Math.floor(r() * 3), "pluck", 0.22);
  } else if (cue === "night") {
    add(0, s.beats + 1, -7, "drone", 0.3);
    if (r() < 0.35) add(pick(r, [1, 2, 3]), 3, 7 + pick(r, [0, 1, 4]), "bell", 0.4);
  } else {
    // the ostinato: eighths on the root with the flat second and the fifth leaning on it, accents on 1, the and of 2, and 4
    const line = bar % 4 === 3 ? [0, 0, 1, 0, 4, 3, 1, 0] : [0, 0, 1, 0, 4, 0, 1, 0];
    line.forEach((d, i) => add(i * 0.5, 0.42, d - 7, "bass", i === 0 || i === 3 || i === 6 ? 0.85 : 0.55));
    for (const at of [0, 1.5, 2, 3, ...(r() < 0.5 ? [3.5] : []), ...(r() < 0.3 ? [2.75] : [])]) add(at, 0.25, -14, "drum", at === 0 || at === 2 ? 0.9 : 0.6);
    if (bar % 2 === 1) add(0, s.beats, 0, "reed", 0.25);
    if (lift) {
      for (let i = 0; i < 8; i++) if (![0, 3, 4].includes(i)) add(i * 0.5 + 0.25, 0.2, -14, "drum", 0.45);
      const arp = [7, 9, 11, 14];
      for (let i = 0; i < 8; i++) add(i * 0.5, 0.4, arp[(i + bar) % arp.length]! + (r() < 0.2 ? 1 : 0), "pluck", 0.4);
    }
  }
  return out;
}

/** A sting's notes, beats at STING_BPM from its start. Pure. */
export function sting(kind: Sting, seed: number): Note[] {
  const r = rngOf(kind, 0, seed), root = 62, n = (at: number, len: number, midi: number, voice: Voice, vel: number): Note => ({ at, len, midi, voice, vel });
  if (kind === "win") return [...[0, 4, 7, 12, 16].map((x, i) => n(i * 0.33, 1.6, root + x, "box", 0.65)), n(0, 3, root - 12, "drone", 0.5), n(1.66, 0.3, 38, "drum", 0.8), n(2, 2.5, root + 19 + (r() < 0.5 ? 0 : 2), "bell", 0.45)];
  if (kind === "loss") return [...[12, 10, 7, 3].map((x, i) => n(i * 0.6, 0.9, root - 12 + x, "reed", 0.45)), n(0, 3, root - 24, "drone", 0.5), n(2.4, 0.4, 36, "drum", 0.8), n(2.9, 1.2, root - 25, "bass", 0.6)]; // a sigh, then a tuba-ish shrug
  return [...[0, 7, 12, 19, 24].map((x, i) => n(i * 0.16, 1.4, root + x, "box", 0.55)), n(0.9, 0.5, root - 12, "pluck", 0.6), n(1.2, 0.8, root - 24, "bass", 0.55), n(1.4, 3, root + 24 + pick(r, [0, 7]), "bell", 0.4)]; // a shimmer, and the Book swallows
}

/** How long a sting rings, in seconds. */
export const stingSeconds = (kind: Sting, seed = 1) => Math.max(...sting(kind, seed).map((x) => x.at + x.len)) * 60 / STING_BPM;

/** The level the player sets its gain to: Settings' music loudness (0 when off), ducked to a third under the Settings card. */
export const musicLevel = (loudness: number, ducked: boolean) => Math.max(0, loudness) * (ducked ? 0.35 : 1);

const AHEAD = 0.5; // seconds scheduled ahead of the audio clock
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function music(loudness: () => number, opts: { stings?: () => boolean; seed?: number } = {}) {
  const seed = opts.seed ?? 7;
  let ctx: AudioContext | null = null, out: GainNode | null = null, stingBus: GainNode | null = null, noise: AudioBuffer | null = null;
  const buses = new Map<Cue, GainNode>();
  let cue: Cue | null = null, bar = 0, barAt = 0, level = -1, lift = false, stung = 0;

  function wake(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    out = new GainNode(ctx, { gain: 0 });
    out.connect(ctx.destination);
    stingBus = new GainNode(ctx, { gain: 1 });
    stingBus.connect(out);
    const len = Math.floor(ctx.sampleRate * 0.3), d = (noise = ctx.createBuffer(1, len, ctx.sampleRate)).getChannelData(0), rr = mulberry32(seed);
    for (let i = 0; i < len; i++) d[i] = rr() * 2 - 1;
    return ctx;
  }
  const busOf = (c: AudioContext, k: Cue) => {
    let b = buses.get(k);
    if (!b) { b = new GainNode(c, { gain: 0 }); b.connect(out!); buses.set(k, b); }
    return b;
  };

  /** One note into `into`, starting at audio time `t`, a beat `spb` seconds long. */
  function voice(c: AudioContext, n: Note, t: number, spb: number, into: GainNode) {
    const f = hz(n.midi), len = n.len * spb, g = new GainNode(c, { gain: 0 }), end = t + len;
    g.connect(into);
    const osc = (type: OscillatorType, freq: number, to: AudioNode, detune = 0) => { const o = new OscillatorNode(c, { type, frequency: freq, detune }); o.connect(to); o.start(t); o.stop(end + 1.2); return o; };
    if (n.voice === "drone") {
      const lp = new BiquadFilterNode(c, { type: "lowpass", frequency: 640, Q: 0.4 });
      lp.connect(g); osc("triangle", f, lp); osc("sawtooth", f, lp, 6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.12, t + Math.min(1.2, len / 3)); g.gain.setValueAtTime(n.vel * 0.12, end - Math.min(1, len / 3)); g.gain.linearRampToValueAtTime(0, end + 0.8);
    } else if (n.voice === "reed") {
      const bp = new BiquadFilterNode(c, { type: "bandpass", frequency: Math.min(2400, f * 3), Q: 1.4 });
      bp.connect(g); osc("sawtooth", f, bp);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.14, t + 0.12); g.gain.setTargetAtTime(0, end - 0.1, 0.2);
    } else if (n.voice === "pluck") {
      const lp = new BiquadFilterNode(c, { type: "lowpass", frequency: 2200 });
      lp.connect(g); osc("triangle", f, lp);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.3, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(1.4, 0.25 + len));
    } else if (n.voice === "box") {
      osc("sine", f, g); const hi = new GainNode(c, { gain: 0.18 }); hi.connect(g); osc("sine", f * 4.01, hi);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.16, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    } else if (n.voice === "bell") {
      osc("sine", f, g); for (const [k, v] of [[2.76, 0.4], [5.4, 0.15]] as const) { const p = new GainNode(c, { gain: v }); p.connect(g); osc("sine", f * k, p); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.1, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    } else if (n.voice === "bass") {
      const lp = new BiquadFilterNode(c, { type: "lowpass", frequency: 420, Q: 2.5 });
      lp.connect(g); osc("sawtooth", f, lp);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.26, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, end + 0.05);
    } else {
      // the frame drum: a pitch-dropping thump and a slap of skin
      const o = osc("sine", 120, g); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(n.vel * 0.55, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      if (noise) {
        const src = new AudioBufferSourceNode(c, { buffer: noise }), bp = new BiquadFilterNode(c, { type: "bandpass", frequency: 900, Q: 0.9 }), sg = new GainNode(c, { gain: 0 });
        src.connect(bp).connect(sg).connect(into);
        sg.gain.setValueAtTime(n.vel * 0.12, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        src.start(t); src.stop(t + 0.1);
      }
    }
  }

  // The first key or tap makes (or resumes) the audio; a hidden tab sleeps it.
  const nudge = () => { const c = wake(); if (c && c.state === "suspended" && !document.hidden) void c.resume(); };
  if (typeof addEventListener === "function") {
    addEventListener("keydown", nudge, true);
    addEventListener("pointerdown", nudge, true);
    document.addEventListener("visibilitychange", () => { if (!ctx) return; if (document.hidden) void ctx.suspend(); else if (level > 0) void ctx.resume(); });
  }

  return {
    /**
     * Once a frame: the cue wanted now, whether the fight's last stretch is on, and whether Settings is ducking it.
     * Most frames this only compares numbers; a bar's notes are made once per bar, a little ahead.
     */
    tick(want: Cue, liftNow: boolean, ducked: boolean) {
      lift = liftNow;
      const c = ctx;
      if (!c || !out) { cue = want; return; }
      const t = c.currentTime, next = musicLevel(loudness(), ducked);
      if (next !== level) { level = next; out.gain.setTargetAtTime(level * 0.5, t, 0.15); if (level > 0 && c.state === "suspended" && !document.hidden) void c.resume(); }
      if (want !== cue || !buses.has(want)) {
        const was = cue === null ? undefined : buses.get(cue);
        if (was && cue !== want) was.gain.setTargetAtTime(0, t, 0.7);
        busOf(c, want).gain.setTargetAtTime(1, t, cue === null ? 0.2 : 0.9);
        cue = want; bar = 0; barAt = t + 0.08;
      }
      if (level <= 0 || c.state !== "running") { if (barAt < t) barAt = t + 0.08; return; } // silent: no notes made
      const s = SCORE[want], spb = 60 / s.bpm;
      while (barAt < t + AHEAD) {
        const bus = busOf(c, want);
        for (const n of phrase(want, bar, seed, lift)) voice(c, n, barAt + n.at * spb, spb, bus);
        barAt += s.beats * spb; bar++;
      }
    },
    /** A win, a loss or a bind: its notes over whatever cue plays, the cue dipping under it. */
    sting(kind: Sting) {
      const c = ctx;
      if (!c || !stingBus || level <= 0 || opts.stings?.() === false || c.state !== "running") return false;
      const t = c.currentTime + 0.05, spb = 60 / STING_BPM, dur = stingSeconds(kind, seed);
      for (const n of sting(kind, seed + stung++)) voice(c, n, t + n.at * spb, spb, stingBus);
      const b = cue && buses.get(cue);
      if (b) { b.gain.setTargetAtTime(0.25, t, 0.1); b.gain.setTargetAtTime(1, t + dur, 0.8); }
      return true;
    },
    /** What plays: the cue, whether sound is coming out, the level asked of the gain and the gain's value now. */
    state: () => ({ cue, playing: !!ctx && ctx.state === "running" && level > 0, volume: Math.max(0, level), gain: out ? +out.gain.value.toFixed(3) : 0, bar, lift, stings: stung }),
  };
}
