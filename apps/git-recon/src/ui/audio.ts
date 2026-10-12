// Sounds, all synthesized (Park Hide & Seek's audio.ts is the pattern): a voice per weapon,
// and a few for the field (a blast, a crate, getting hit). Each is a burst of filtered
// noise, a swept tone, or both. Louder and centred the nearer it is to you.

import type { WeaponId } from "../sim/weapons.ts";

export interface Voice {
  /** A tone sweeping from one pitch to another, in Hz. */
  tone?: { wave: OscillatorType; from: number; to: number };
  /** A burst of noise through a band-pass at this frequency. */
  noise?: number;
  seconds: number;
  volume: number;
}

export const VOICES: Record<WeaponId, Voice> = {
  commit: { noise: 1800, seconds: 0.06, volume: 0.25 },
  add: { noise: 700, tone: { wave: "sawtooth", from: 140, to: 45 }, seconds: 0.22, volume: 0.42 },
  fetch: { noise: 1300, tone: { wave: "square", from: 220, to: 120 }, seconds: 0.05, volume: 0.2 },
  clean: { noise: 450, seconds: 0.1, volume: 0.06 },
  push: { noise: 300, tone: { wave: "sawtooth", from: 180, to: 60 }, seconds: 0.4, volume: 0.35 },
  merge: { tone: { wave: "triangle", from: 520, to: 300 }, seconds: 0.15, volume: 0.2 },
  rebase: { noise: 900, tone: { wave: "square", from: 1400, to: 200 }, seconds: 0.25, volume: 0.3 },
  cherry: { tone: { wave: "sine", from: 600, to: 1300 }, seconds: 0.3, volume: 0.2 },
  revert: { tone: { wave: "sine", from: 1200, to: 300 }, seconds: 0.35, volume: 0.22 },
  stash: { noise: 600, tone: { wave: "triangle", from: 220, to: 160 }, seconds: 0.2, volume: 0.22 },
  blame: { tone: { wave: "square", from: 880, to: 880 }, seconds: 0.08, volume: 0.12 },
  reset: { noise: 120, tone: { wave: "sawtooth", from: 90, to: 30 }, seconds: 1.2, volume: 0.45 },
};

export const FIELD = {
  boom: { noise: 150, tone: { wave: "sine", from: 110, to: 40 }, seconds: 0.7, volume: 0.4 },
  pickup: { tone: { wave: "triangle", from: 660, to: 990 }, seconds: 0.18, volume: 0.18 },
  hurt: { noise: 400, seconds: 0.12, volume: 0.25 },
  /** You hit something: a dry tick, and a higher one when it goes down. */
  hitmark: { tone: { wave: "square", from: 1900, to: 1600 }, seconds: 0.04, volume: 0.08 },
  kill: { tone: { wave: "triangle", from: 900, to: 1800 }, seconds: 0.12, volume: 0.14 },
  /** A file coming down. */
  raze: { noise: 220, tone: { wave: "triangle", from: 160, to: 50 }, seconds: 0.55, volume: 0.32 },
  down: { tone: { wave: "sawtooth", from: 400, to: 90 }, seconds: 0.5, volume: 0.2 },
  /** Your shield: a hit fizzing off it, it popping, and the rising hum as it refills. */
  shieldHit: { noise: 3200, tone: { wave: "sine", from: 1400, to: 900 }, seconds: 0.09, volume: 0.14 },
  shieldBroke: { noise: 2400, tone: { wave: "square", from: 900, to: 120 }, seconds: 0.35, volume: 0.22 },
  shieldCharge: { tone: { wave: "triangle", from: 220, to: 880 }, seconds: 0.9, volume: 0.1 },
  shieldFull: { tone: { wave: "sine", from: 880, to: 1320 }, seconds: 0.15, volume: 0.1 },
} satisfies Record<string, Voice>;

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

/** Plays a voice; vol 0..1 scales it (by distance), pan -1..1 puts it left or right. */
export function play(v: Voice, vol = 1, pan = 0) {
  if (vol <= 0.02 || typeof AudioContext === "undefined") return;
  const a = ac(), t = a.currentTime;
  if (a.state === "suspended") void a.resume();
  const g = a.createGain(), p = a.createStereoPanner();
  g.gain.setValueAtTime(v.volume * vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + v.seconds);
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p).connect(a.destination);
  if (v.tone) {
    const o = a.createOscillator();
    o.type = v.tone.wave;
    o.frequency.setValueAtTime(v.tone.from, t);
    o.frequency.exponentialRampToValueAtTime(v.tone.to, t + v.seconds);
    o.connect(g);
    o.start(t), o.stop(t + v.seconds);
  }
  if (v.noise) {
    const len = Math.floor(a.sampleRate * v.seconds), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = a.createBufferSource(), f = a.createBiquadFilter();
    src.buffer = buf;
    f.type = "bandpass", f.frequency.value = v.noise, f.Q.value = 0.8;
    src.connect(f).connect(g);
    src.start(t);
  }
}

/** Volume and pan for a sound at (dx, dz) from a listener facing yaw (forward is -z at yaw 0). */
export function place(dx: number, dz: number, yaw: number, reach = 80): { vol: number; pan: number } {
  const d = Math.hypot(dx, dz);
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return { vol: Math.max(0, 1 - d / reach), pan: d > 0 ? right / d : 0 };
}
