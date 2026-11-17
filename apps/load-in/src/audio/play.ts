// The page's sound: one house loop, synthesised here (no samples), played through every speaker that is fed.
// Mids and highs go to each speaker on its own (its gain, how dull it is from here, and its side), and the sub band
// goes to one bus at the phase-summed level, so the alley between two subs is loud and the lobes beside it dip.
// The speakers start down behind a card: a click (or M) brings them up, and a limiter holds the mix at -1 dBFS.
// `feed` swaps the house loop for another source (the DJ booth's decks, audio/decks.ts) on the same speaker path.
import { gainOf, type Hearing } from "./hear.ts";

const BPM = 120;
const BARS = 2;
const SPLIT_HZ = 120;

/** Two bars of our own house loop: kick on the beat, offbeat hats, a bass line and an offbeat chord stab. A deck's track
 * (audio/decks.ts) is the same loop at its own tempo, bass line and chord. */
export function houseLoop(rate: number, track: { bpm?: number; bass?: readonly number[]; chord?: readonly number[] } = {}): Float32Array<ArrayBuffer> {
  const beat = 60 / (track.bpm ?? BPM);
  const n = Math.round(rate * beat * 4 * BARS);
  const out = new Float32Array(n);
  const add = (at: number, len: number, f: (t: number) => number) => {
    const s0 = Math.round(at * rate);
    const s1 = Math.min(n, s0 + Math.round(len * rate));
    for (let s = s0; s < s1; s++) out[s] = (out[s] ?? 0) + f((s - s0) / rate);
  };
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
  const bass = track.bass ?? [55, 55, 65.41, 49, 55, 55, 73.42, 49], chord = track.chord ?? [220, 261.63, 329.63];
  for (let b = 0; b < 4 * BARS; b++) {
    const t = b * beat;
    // Kick: a falling sine, 120 Hz down to 45.
    add(t, 0.35, (x) => 0.9 * Math.exp(-x * 9) * Math.sin(2 * Math.PI * (45 * x + (75 / 18) * (1 - Math.exp(-x * 18)))));
    // Bass on the offbeat, a rounded square.
    const f = bass[b] ?? 55;
    add(t + beat / 2, beat / 2, (x) => 0.35 * Math.tanh(3 * Math.sin(2 * Math.PI * f * x)) * Math.min(1, x * 200) * Math.exp(-x * 3));
    // Hats on the offbeat: noise, differenced to take the low end out.
    let prev = 0;
    add(t + beat / 2, 0.06, (x) => {
      const v = noise();
      const hp = v - prev;
      prev = v;
      return 0.12 * hp * Math.exp(-x * 60);
    });
    // A minor stab on the and of 2 and 4.
    if (b % 2 === 1) {
      add(t + beat / 2, 0.25, (x) => chord.reduce((s, hz) => s + Math.sin(2 * Math.PI * hz * x) + 0.3 * Math.sin(4 * Math.PI * hz * x), 0) * 0.07 * Math.exp(-x * 10));
    }
  }
  for (let s = 0; s < n; s++) out[s] = Math.tanh(out[s] ?? 0);
  return out;
}

type Voice = { bright: BiquadFilterNode; gain: GainNode; pan: StereoPannerNode };

/** The sound system on the page. `up` is whether the speakers are up; `update` follows what you hear each frame. */
export function soundSystem(card: HTMLElement) {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let highs: AudioNode | null = null;
  let lowGain: GainNode | null = null;
  let house: GainNode | null = null, program: GainNode | null = null;
  let make: ((c: AudioContext) => AudioNode) | null = null, fed: AudioNode | null = null;
  const voices = new Map<string, Voice>();
  let up = false;

  function build(): AudioContext {
    const c = new AudioContext();
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;
    const out = c.createGain();
    out.gain.value = 10 ** (-1 / 20);
    limiter.connect(out).connect(c.destination);
    master = c.createGain();
    master.gain.value = 0;
    master.connect(limiter);

    const data = houseLoop(c.sampleRate);
    const buf = c.createBuffer(1, data.length, c.sampleRate);
    buf.copyToChannel(data, 0);
    const loop = c.createBufferSource();
    loop.buffer = buf;
    loop.loop = true;

    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = SPLIT_HZ;
    lowGain = c.createGain();
    lowGain.gain.value = 0;
    house = c.createGain();
    program = c.createGain();
    loop.connect(house).connect(program);
    program.connect(lp).connect(lowGain).connect(master);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = SPLIT_HZ;
    program.connect(hp);
    highs = hp;
    loop.start();
    ctx = c;
    plugIn();
    return c;
  }

  function voice(key: string): Voice {
    let v = voices.get(key);
    if (v || !ctx || !highs || !master) return v!;
    const bright = ctx.createBiquadFilter();
    bright.type = "lowpass";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    highs.connect(bright).connect(gain).connect(pan).connect(master);
    v = { bright, gain, pan };
    voices.set(key, v);
    return v;
  }

  /** The source in place now: the house loop, or what `feed` made, on the program bus. */
  function plugIn() {
    if (!ctx || !house || !program) return;
    fed?.disconnect();
    fed = make ? make(ctx) : null;
    fed?.connect(program);
    house.gain.value = fed ? 0 : 1;
  }

  function show() {
    card.hidden = up;
  }

  function setUp(on: boolean) {
    up = on;
    if (on && !ctx) ctx = build();
    if (ctx && on) void ctx.resume();
    if (ctx && master) master.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, on ? 0.6 : 0.08);
    show();
  }

  card.addEventListener("click", () => setUp(true));
  show();

  return {
    get up() {
      return up;
    },
    toggle: () => setUp(!up),
    /** Play `source` (made once the page's sound has started) instead of the house loop; null brings the loop back. */
    feed(source: ((c: AudioContext) => AudioNode) | null) {
      make = source;
      plugIn();
    },
    setUp,
    /** Follow the hearing: each fed speaker's gain, top end and side, and the sub bus. */
    update(h: Hearing) {
      if (!ctx || !lowGain) return;
      const t = ctx.currentTime;
      for (const s of h.speakers) {
        if (!s.highs) continue;
        const v = voice(s.key);
        v.gain.gain.setTargetAtTime(gainOf(s.db), t, 0.05);
        v.bright.frequency.setTargetAtTime(s.brightHz, t, 0.05);
        v.pan.pan.setTargetAtTime(s.pan, t, 0.05);
      }
      lowGain.gain.setTargetAtTime(gainOf(h.low), t, 0.05);
    },
  };
}
