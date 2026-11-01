// Spy-movie sound, all synthesised (no files to load): a scanner ping per shot, a teletype
// chatter for the briefing, a buzzer for a decoy and a twangy surf-guitar sting on a find.
// The context starts on the first press, since a page may not play sound before one.

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let muted = (() => { try { return localStorage.getItem("splat-spray.muted") === "1"; } catch { return false; } })();

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (muted) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { return null; }
    bus = ctx.createGain();
    bus.gain.value = 0.5;
    bus.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ctx, out: bus! };
}

export const isMuted = () => muted;
export function setMuted(on: boolean) {
  muted = on;
  try { localStorage.setItem("splat-spray.muted", on ? "1" : "0"); } catch { /* private window */ }
  if (on) void ctx?.suspend();
}

/** One note: an oscillator through a quick attack and a decay. */
function tone(freq: number, at: number, len: number, { type = "triangle" as OscillatorType, vol = 0.2, bend = 1 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const o = a.ctx.createOscillator();
  const g = a.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * bend, t + len);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.out);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** A plucked, slightly detuned note with a wobble: the twang of a reverb-soaked guitar. */
function twang(freq: number, at: number, len: number, vol = 0.12) {
  const a = audio();
  if (!a) return;
  const t = a.ctx.currentTime + at;
  const lp = a.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(700, t + len);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const trem = a.ctx.createOscillator();
  const depth = a.ctx.createGain();
  trem.frequency.value = 6.5;
  depth.gain.value = vol * 0.35;
  trem.connect(depth).connect(g.gain);
  lp.connect(g).connect(a.out);
  for (const d of [1, 1.004]) {
    const o = a.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(freq * d, t);
    o.connect(lp);
    o.start(t);
    o.stop(t + len + 0.05);
  }
  trem.start(t);
  trem.stop(t + len + 0.05);
}

const note = (semis: number) => 82.41 * 2 ** (semis / 12);   // semitones above low E

export const sfx = {
  /** Each scan shot: a short high ping that falls, like a sonar sweep. */
  shot() { tone(2400 + Math.random() * 300, 0, 0.07, { type: "sine", vol: 0.05, bend: 0.6 }); },
  /** The briefing types itself out. */
  teletype(n = 6) { for (let i = 0; i < n; i++) tone(1800 + (i % 3) * 140, i * 0.055, 0.02, { type: "square", vol: 0.03 }); },
  /** A wrong pick: two low notes, down. */
  decoy() { tone(196, 0, 0.16, { type: "square", vol: 0.08 }); tone(147, 0.15, 0.28, { type: "square", vol: 0.08 }); },
  /** A find: the low-string riff climbing, then the minor chord with a major seventh hanging over it. */
  found() {
    [0, 2, 3, 2].forEach((s, i) => twang(note(s), i * 0.12, 0.22, 0.1));
    for (const [i, s] of [12, 15, 19, 23, 26].entries()) twang(note(s), 0.5 + i * 0.03, 1.6, 0.06);
  },
  /** Mission start: one deep note under the briefing. */
  brief() { twang(note(0), 0, 0.9, 0.1); },
};
