// The show's sound: each song's five parts as stems, synthesised here (no samples), two bars looped at the song's
// tempo and root. Each stem goes through its channel strip as the desk sets it (a gain from its level in the house and a
// peaking filter per notch), and while the vocal loop rings a howl at the ringing band rises over the lot. A broken
// string takes the guitar out; a dying cable makes the bass crackle in and out. A -1 dBFS limiter holds the mix.
// The guitar is a clean DI here; `showSound().bake` has a worker run it through the amp as set at soundcheck (amp.ts),
// and the baked loop takes the DI's place as each song comes back.
import { CHANNELS, type Channel, type Desk, type Mixed, NOTCHES, SET_LIST, type Song } from "../venues/show.ts";
import { check } from "@rustybuns/util/guard";
import { type AmpKnobs, BAKE_RATE, BakeReply } from "./amp.ts";

/** The house level at the desk that plays at full scale, dB SPL. */
const REF_DB = 108;

let seed = 11;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;

/** Two bars of each part of a song, at `rate` samples a second. */
export function stems(rate: number, song: Song): Record<Channel, Float32Array<ArrayBuffer>> {
  const beat = 60 / song.bpm, n = Math.round(rate * beat * 8), r = song.root;
  const part = (fill: (add: (at: number, len: number, f: (t: number) => number) => void) => void) => {
    const out = new Float32Array(n);
    fill((at, len, f) => {
      const s0 = Math.round(at * rate), s1 = Math.min(n, s0 + Math.round(len * rate));
      for (let s = s0; s < s1; s++) out[s] = (out[s] ?? 0) + f((s - s0) / rate);
    });
    for (let s = 0; s < n; s++) out[s] = Math.tanh(out[s] ?? 0);
    return out;
  };
  const tau = 2 * Math.PI;
  const kick = part((add) => {
    for (const b of [0, 2, 2.5, 4, 6, 6.5]) add(b * beat, 0.35, (x) => 0.9 * Math.exp(-x * 9) * Math.sin(tau * (45 * x + (75 / 18) * (1 - Math.exp(-x * 18)))));
  });
  const snare = part((add) => {
    for (const b of [1, 3, 5, 7]) add(b * beat, 0.2, (x) => (0.5 * noise() + 0.4 * Math.sin(tau * 190 * x)) * Math.exp(-x * 22));
  });
  // Bass and guitar on the eighths: root, root, the fifth, the flat seventh, round the two bars.
  const steps = [1, 1, 1.5, 1, 1, 1, 1.78, 1.5];
  const bass = part((add) => {
    for (let e = 0; e < 16; e++) {
      const f = r * (steps[e % 8] ?? 1);
      add((e * beat) / 2, beat / 2, (x) => 0.5 * Math.tanh(2.5 * Math.sin(tau * f * x)) * Math.min(1, x * 300) * Math.exp(-x * 2));
    }
  });
  // The guitar as it leaves the pickups (a DI): root and fifth, plucked, clean. The amp gives it its grit (amp.ts).
  const pluck = (f: number, x: number) => Math.sin(tau * f * x) + 0.5 * Math.sin(tau * 2 * f * x) * Math.exp(-x * 6) + 0.25 * Math.sin(tau * 3 * f * x) * Math.exp(-x * 10);
  const guitar = part((add) => {
    for (let e = 0; e < 16; e++) {
      const f = 2 * r * (steps[e % 8] ?? 1);
      add((e * beat) / 2, beat / 2.2, (x) => 0.18 * (pluck(f, x) + 0.8 * pluck(1.5 * f, x)) * Math.min(1, x * 400) * Math.exp(-x * 3));
    }
  });
  // The vocal: a pentatonic line in half notes, a few harmonics shaped like an open vowel, with vibrato.
  const line = [4, 4.5, 5.33, 4.5, 4, 3.56, 4, 4];
  const vocal = part((add) => {
    for (let h = 0; h < 4; h++) {
      const f = r * (line[h * 2] ?? 4);
      add(h * 2 * beat, 2 * beat * 0.95, (x) => {
        const ph = tau * f * x + 0.6 * Math.sin(tau * 5.5 * x);
        const env = Math.min(1, x * 12) * Math.min(1, (2 * beat * 0.95 - x) * 12);
        return 0.3 * env * (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.45 * Math.sin(3 * ph) + 0.2 * Math.sin(5 * ph));
      });
    }
  });
  return { kick, snare, bass, guitar, vocal };
}

type Strip = { gain: GainNode; notches: BiquadFilterNode[] };

export type Played = { song: number; mix: Record<Channel, Mixed>; desk: Desk; ringing: number[] };

/** The show's sound on the page. `start` on a click (browsers want one); `update` each frame follows the desk. */
export function showSound() {
  let ctx: AudioContext | null = null;
  let bus: GainNode | null = null;
  let howl: { osc: OscillatorNode; gain: GainNode } | null = null;
  let playing = -1, startedAt = 0;
  let sources: AudioBufferSourceNode[] = [];
  const strips = new Map<Channel, Strip>();
  // The amp's worker, its last ask, and each song's guitar as it came back baked through the knobs of that ask.
  let worker: Worker | null = null, asked = 0, bakedFor = "";
  const baked: (Float32Array<ArrayBuffer> | null)[] = SET_LIST.map(() => null);
  let guitar: AudioBufferSourceNode | null = null;

  /** A looping source for these samples into a channel, `offset` seconds in. */
  function loop(c: AudioContext, data: Float32Array<ArrayBuffer>, ch: Channel, offset = 0) {
    const buf = c.createBuffer(1, data.length, BAKE_RATE);
    buf.copyToChannel(data, 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(strips.get(ch)!.gain);
    src.start(0, offset % buf.duration);
    sources.push(src);
    return src;
  }

  function landed(r: BakeReply) {
    if (r.id !== asked) return;
    baked[r.song] = r.data;
    // The song on now swaps its DI for the baked guitar where the loop has got to.
    if (ctx && r.song === playing && guitar) {
      guitar.stop();
      sources = sources.filter((x) => x !== guitar);
      guitar = loop(ctx, r.data, "guitar", ctx.currentTime - startedAt);
    }
  }

  function build(c: AudioContext) {
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    bus = c.createGain();
    bus.connect(limiter).connect(c.destination);
    for (const ch of CHANNELS) {
      const gain = c.createGain();
      gain.gain.value = 0;
      const notches = Array.from({ length: NOTCHES }, () => {
        const f = c.createBiquadFilter();
        f.type = "peaking";
        f.gain.value = 0;
        f.Q.value = 4;
        return f;
      });
      notches.reduce<AudioNode>((a, f) => a.connect(f), gain).connect(bus);
      strips.set(ch, { gain, notches });
    }
    const osc = c.createOscillator(), g = c.createGain();
    g.gain.value = 0;
    osc.connect(g).connect(bus);
    osc.start();
    howl = { osc, gain: g };
  }

  function play(c: AudioContext, index: number) {
    for (const s of sources) s.stop();
    sources = [];
    playing = index;
    const song = SET_LIST[index];
    if (!song) return;
    const parts = stems(BAKE_RATE, song);
    startedAt = c.currentTime;
    for (const ch of CHANNELS) {
      const src = loop(c, ch === "guitar" ? (baked[index] ?? parts.guitar) : parts[ch], ch);
      if (ch === "guitar") guitar = src;
    }
  }

  return {
    /** Bake the guitar through the amp at these knobs, in the worker; the same knobs twice is one bake. */
    bake(knobs: AmpKnobs) {
      const key = JSON.stringify(knobs);
      if (key === bakedFor) return;
      bakedFor = key;
      baked.fill(null);
      if (!worker) {
        worker = new Worker(new URL("./amp-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent) => { const r = check(BakeReply, e.data); if (r) landed(r); };
      }
      worker.postMessage({ id: ++asked, knobs });
    },
    /** How many of the set's songs have their guitar baked through the amp as it is set now. */
    get ready() { return baked.filter(Boolean).length; },
    /** Start the sound (on a click or a key). */
    start() {
      if (!ctx) build((ctx = new AudioContext()));
      void ctx.resume();
    },
    /** Stop the stems (between levels, or once the set is over). */
    stop() {
      for (const s of sources) s.stop();
      sources = [];
      guitar = null;
      playing = -1;
      if (ctx && howl) howl.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    /** Done with the show: the sound stops and the amp's worker goes. */
    close() {
      this.stop();
      worker?.terminate();
      worker = null;
      bakedFor = "";
    },
    /** Follow the desk: the song, each channel's level and notches, a dead or crackling part, and the howl. */
    update(p: Played | null) {
      if (!ctx || !howl) return;
      if (!p) return this.stop();
      if (p.song !== playing) play(ctx, p.song);
      const t = ctx.currentTime;
      for (const ch of CHANNELS) {
        const s = strips.get(ch)!, m = p.mix[ch];
        // A dying cable: the bass drops in and out; a broken string: the guitar is gone.
        const on = !m.dead ? 1 : ch === "bass" ? (Math.random() < 0.3 ? 1 : 0) : 0;
        s.gain.gain.setTargetAtTime(on * 10 ** ((m.db - REF_DB) / 20), t, ch === "bass" && m.dead ? 0.005 : 0.05);
        s.notches.forEach((f, i) => {
          const b = p.desk[ch].eq[i];
          f.gain.setTargetAtTime(b?.db ?? 0, t, 0.02);
          if (b) f.frequency.setValueAtTime(b.hz, t);
        });
      }
      const hz = p.ringing[0];
      if (hz) howl.osc.frequency.setTargetAtTime(hz, t, 0.01);
      howl.gain.gain.setTargetAtTime(hz ? 0.3 : 0, t, hz ? 0.4 : 0.08);
    },
  };
}
