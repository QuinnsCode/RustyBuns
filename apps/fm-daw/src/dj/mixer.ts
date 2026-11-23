// The Qone mixer, the QDJ decks' four-channel analog-style club mixer with twin filters (mixer-panel.ts draws it).
// Four stereo channels, each: a trim, a four-band EQ (high and low cut to a full kill, the two mids cut deep, every
// band boosts +6 dB), two post-fader aux sends, a filter assign (filter 1, filter 2 or off), a headphone cue, a meter,
// the channel fader and a crossfader assign (X, Y or off). Two filters, one each side: on/off, high-pass, band-pass and
// low-pass that can be pressed together (high + low is a notch, all three a flat line with a moving phase), a sweep
// from 20 Hz to 20 kHz, a resonance from mild to wild, and an LFO each (LFO 1 on filter 1, LFO 2 on filter 2) that
// swings the sweep: depth, beats per round, five shapes, and its tempo from a deck (locked to that deck's beat grid,
// so a round starts on a downbeat) or tapped. Each filter's output is soft-clipped as an analog filter's is, so a wild
// resonance sings instead of slamming the limiter. Then the crossfader and its curve, the master and its stereo meters, the booth level (what
// your own speakers play, apart from the master the room's PA hears), the headphone cue/master blend and level, and
// split cue (one output: the headphones in the left ear, the master in the right). A limiter keeps the master clean.
// The arithmetic is plain functions at the top, so it can be checked without a browser.
import { crossfade, faderGain } from "./analyze.ts";

export const CHANNELS = 4;
export type Ch = 0 | 1 | 2 | 3;
/** Which channel each deck plays into: A on 2, B on 3, as in most booths (1 and 4 are free inputs). */
export const DECK_CHANNEL = [1, 2] as const;
export type Band = "high" | "hiMid" | "loMid" | "low";
export type ChannelKnob = "trim" | Band | "send1" | "send2" | "fader";
export type XAssign = "x" | "y" | "off";
export type FilterType = "hp" | "bp" | "lp";
export type Curve = "smooth" | "cut";
/** The LFO's shapes: a sine, a triangle, a square (it jumps between two sweeps), a ramp up and a ramp down. */
export const LFO_SHAPES = ["sine", "tri", "square", "up", "down"] as const;
export type LfoShape = (typeof LFO_SHAPES)[number];
/** Where an LFO's tempo comes from: deck A's or B's beat grid (locked to its downbeats), or the TAP button. */
export const LFO_FOLLOW = ["a", "b", "tap"] as const;
export type LfoFollow = (typeof LFO_FOLLOW)[number];

/** The four bands, top to bottom: shelves at the ends, bells in the middle. */
export const BANDS: Record<Band, { type: "highshelf" | "peaking" | "lowshelf"; hz: number; q: number }> = {
  high: { type: "highshelf", hz: 8000, q: 0.7 },
  hiMid: { type: "peaking", hz: 2500, q: 0.8 },
  loMid: { type: "peaking", hz: 350, q: 0.8 },
  low: { type: "lowshelf", hz: 80, q: 0.7 },
};
const KILL_DB = -80;
const MID_FLOOR_DB = -26;

/** A band knob (-1 to 1, flat in the middle) in dB: +6 at the top; the high and low fall to a kill, the mids to -26. */
export function bandDb(band: Band, knob: number): number {
  const k = Math.min(1, Math.max(-1, knob));
  if (k >= 0) return k * 6;
  if (band === "hiMid" || band === "loMid") return -k * MID_FLOOR_DB;
  return k <= -0.97 ? KILL_DB : k * 30;
}
/** The trim (-1 to 1) in dB: -12 to +12, 0 in the middle. */
export const trimDb = (knob: number) => Math.min(1, Math.max(-1, knob)) * 12;
export const dbGain = (db: number) => Math.pow(10, db / 20);

/** The filter's sweep knob (0 to 1) in Hz: 20 Hz to 20 kHz, evenly by octave. */
export const sweepHz = (knob: number) => 20 * Math.pow(1000, Math.min(1, Math.max(0, knob)));
/** The resonance knob (0 to 1) as a filter Q: 0.6 (mild) to 18 (wild, a whistling peak). */
export const resQ = (knob: number) => 0.6 * Math.pow(30, Math.min(1, Math.max(0, knob)));
/** How far the LFO swings the sweep at full depth, each way, in octaves. */
export const LFO_OCTAVES = 3;
/** The LFO's beats per sweep, the choices on its switch. */
export const LFO_BEATS = [0.5, 1, 2, 4, 8, 16] as const;
/** The shape at `phase` (rounds; 0 is the downbeat), -1 to 1. */
export function lfoValue(shape: LfoShape, phase: number): number {
  const p = phase - Math.floor(phase);
  switch (shape) {
    case "sine": return Math.sin(2 * Math.PI * p);
    case "tri": return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
    case "square": return p < 0.5 ? 1 : -1;
    case "up": return 2 * p - 1;
    case "down": return 1 - 2 * p;
  }
}
/** The LFO's swing in cents at `t` seconds: one round every `beats` beats at `bpm`, `depth` 0 to 1. */
export function lfoCents(t: number, bpm: number, beats: number, depth: number, shape: LfoShape = "sine"): number {
  return Math.min(1, Math.max(0, depth)) * LFO_OCTAVES * 1200 * lfoValue(shape, (t * bpm) / (60 * beats));
}
/** Harmonics in an LFO's wave (a sharp edge rounded off by the Lanczos sigma, so a square doesn't ring). */
export const LFO_HARMONICS = 24;
/**
 * The shape as a PeriodicWave's cosine and sine terms, started `phase` rounds in (so a new oscillator picks up where
 * the beat is): b_k sin(2πk(t + φ)) = b_k sin(2πkφ) cos(2πkt) + b_k cos(2πkφ) sin(2πkt).
 */
export function lfoTerms(shape: LfoShape, phase: number): { real: Float32Array; imag: Float32Array } {
  const n = shape === "sine" ? 2 : LFO_HARMONICS + 1, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const odd = k % 2 === 1, sigma = shape === "sine" ? 1 : Math.sin((Math.PI * k) / n) / ((Math.PI * k) / n);
    const b = shape === "sine" ? 1
      : shape === "tri" ? (odd ? (8 / (Math.PI * Math.PI * k * k)) * (((k - 1) / 2) % 2 ? -1 : 1) : 0)
      : shape === "square" ? (odd ? 4 / (Math.PI * k) : 0)
      : shape === "up" ? -2 / (Math.PI * k) : 2 / (Math.PI * k);
    real[k] = b * sigma * Math.sin(2 * Math.PI * k * phase);
    imag[k] = b * sigma * Math.cos(2 * Math.PI * k * phase);
  }
  return { real, imag };
}
/** The filter's analog-style output stage: straight up to 0.8 of full scale, then a soft knee that never passes 1. */
export function softClip(x: number): number {
  const a = Math.abs(x);
  return a <= 0.8 ? x : Math.sign(x) * (0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
}
/** The level into a filter at resonance `res` (0 to 1), dB: a wild peak is taken down a little before the clip. */
export const resTrimDb = (res: number) => -6 * Math.min(1, Math.max(0, res));
/** The LFO's rate in Hz. */
export const lfoHz = (bpm: number, beats: number) => bpm / 60 / beats;

/**
 * The filter's gain at `hz` with these types pressed, the sweep at `f0` and resonance `q`: the analog second-order
 * low-, band- and high-pass on one pole pair, summed as the parallel filters sum. None pressed passes it through.
 */
export function filterGain(types: readonly FilterType[], hz: number, f0: number, q: number): number {
  if (!types.length) return 1;
  const w = hz / f0;
  // H(s) = N(s) / (s^2 + s/Q + 1) at s = jw: the denominator is (1 - w^2) + j(w/Q)
  const dr = 1 - w * w, di = w / q;
  let nr = 0, ni = 0;
  if (types.includes("lp")) nr += 1;
  if (types.includes("hp")) nr -= w * w;
  if (types.includes("bp")) ni += w / q;
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

/** Tap tempo: the beats per minute of the last taps (ms), a gap over 2 s starts again; null under two taps. */
export function tapBpm(taps: readonly number[]): number | null {
  let from = taps.length - 1;
  while (from > 0 && taps[from]! - taps[from - 1]! <= 2000 && taps.length - from < 5) from--;
  const n = taps.length - 1 - from;
  if (n < 1) return null;
  const bpm = (60000 * n) / (taps[taps.length - 1]! - taps[from]!);
  return Math.round(Math.min(200, Math.max(40, bpm)) * 10) / 10;
}

/** A channel's gain on the crossfader: off ignores it, X is its left side, Y its right. */
export function xfGain(assign: XAssign, x: number, curve: Curve): number {
  if (assign === "off") return 1;
  const [a, b] = crossfade(x, curve);
  return assign === "x" ? a : b;
}
/** The booth knob (0 to 1) as a gain: unity at 0.8, a square law like the faders. */
export const boothGain = (v: number) => faderGain(v) / faderGain(0.8);

/** Web Audio reads a low- or high-pass Q in dB, a band-pass's as it is. */
const qParam = (t: FilterType, q: number) => t === "bp" ? q : 20 * Math.log10(q);

export interface ChannelState { trim: number; high: number; hiMid: number; loMid: number; low: number; send1: number; send2: number; fader: number; filter: 0 | 1 | 2; cue: boolean; xf: XAssign }
export interface FilterState { on: boolean; types: FilterType[]; freq: number; res: number; depth: number; beats: number; bpm: number; shape: LfoShape; follow: LfoFollow }
/** A deck's tempo for an LFO to follow: its BPM now, and its beat count at an audio time (null: not running steady). */
export interface Follow { bpm: number; beatAt(t: number): number | null }
type Lfo = { osc: OscillatorNode | null; t0: number; ph0: number; hz: number; shape: LfoShape };
export interface MixerState {
  channels: ChannelState[]; filters: [FilterState, FilterState];
  xfader: number; curve: Curve; master: number; booth: number; phones: number; cueBlend: number; split: boolean;
}

/** One filter's copy on one channel: the three types side by side, each switched in or out, summed. */
class FilterUnit {
  readonly in: GainNode;
  readonly out: GainNode;
  readonly f: Record<FilterType, BiquadFilterNode>;
  readonly on: Record<FilterType, GainNode>;
  private readonly sum: GainNode;
  constructor(ctx: AudioContext, lfo: AudioNode) {
    this.in = ctx.createGain(); this.out = ctx.createGain(); this.sum = ctx.createGain();
    // the shaper reads -1 to 1, so the sum goes in at a quarter and comes back at four times: it clips at 0.8 of full
    const shaper = new WaveShaperNode(ctx, { curve: Float32Array.from({ length: 4097 }, (_, i) => softClip(((i - 2048) / 2048) * 4) / 4), oversample: "2x" });
    const down = new GainNode(ctx, { gain: 0.25 }), up = new GainNode(ctx, { gain: 4 });
    this.sum.connect(down).connect(shaper).connect(up).connect(this.out);
    const mk = (t: FilterType) => new BiquadFilterNode(ctx, { type: t === "hp" ? "highpass" : t === "bp" ? "bandpass" : "lowpass", frequency: 1000 });
    this.f = { hp: mk("hp"), bp: mk("bp"), lp: mk("lp") };
    this.on = { hp: ctx.createGain(), bp: ctx.createGain(), lp: ctx.createGain() };
    for (const t of ["hp", "bp", "lp"] as const) {
      this.in.connect(this.f[t]).connect(this.on[t]).connect(this.sum);
      lfo.connect(this.f[t].detune);
    }
  }
  apply(s: FilterState, t: number) {
    const hz = sweepHz(s.freq), q = resQ(s.res);
    this.in.gain.setTargetAtTime(dbGain(resTrimDb(s.res)), t, 0.01);
    for (const k of ["hp", "bp", "lp"] as const) {
      this.f[k].frequency.setTargetAtTime(hz, t, 0.01);
      this.f[k].Q.setTargetAtTime(qParam(k, q), t, 0.01);
      this.on[k].gain.setTargetAtTime(s.types.includes(k) ? 1 : 0, t, 0.005);
    }
  }
}

/** A channel strip's audio: trim, the four bands, the filter routes, then the fader, its taps and the sends. */
class Strip {
  readonly input: GainNode;
  readonly meter: AnalyserNode;
  readonly s: ChannelState = { trim: 0, high: 0, hiMid: 0, loMid: 0, low: 0, send1: 0, send2: 0, fader: 0.8, filter: 0, cue: false, xf: "off" };
  private readonly trim: GainNode;
  private readonly eq: Record<Band, BiquadFilterNode>;
  private readonly dry: GainNode;
  private readonly units: [FilterUnit, FilterUnit];
  private readonly wet: [GainNode, GainNode];
  private readonly fader: GainNode;
  private readonly xf: GainNode;
  private readonly pfl: GainNode;
  private readonly sends: [GainNode, GainNode];
  constructor(ctx: AudioContext, out: AudioNode, cueBus: AudioNode, sendBus: [AudioNode, AudioNode], lfos: [AudioNode, AudioNode]) {
    this.input = ctx.createGain();
    this.trim = ctx.createGain();
    const band = (b: Band) => new BiquadFilterNode(ctx, { type: BANDS[b].type, frequency: BANDS[b].hz, Q: BANDS[b].q });
    this.eq = { high: band("high"), hiMid: band("hiMid"), loMid: band("loMid"), low: band("low") };
    const post = ctx.createGain(), sum = ctx.createGain();
    this.input.connect(this.trim).connect(this.eq.high).connect(this.eq.hiMid).connect(this.eq.loMid).connect(this.eq.low).connect(post);
    this.dry = ctx.createGain();
    post.connect(this.dry).connect(sum);
    this.units = [new FilterUnit(ctx, lfos[0]), new FilterUnit(ctx, lfos[1])];
    this.wet = [ctx.createGain(), ctx.createGain()];
    for (const i of [0, 1] as const) { post.connect(this.units[i].in); this.units[i].out.connect(this.wet[i]).connect(sum); }
    this.meter = new AnalyserNode(ctx, { fftSize: 512 });
    this.pfl = ctx.createGain();
    this.fader = ctx.createGain();
    this.xf = ctx.createGain();
    this.sends = [ctx.createGain(), ctx.createGain()];
    sum.connect(this.meter);
    sum.connect(this.pfl).connect(cueBus);
    sum.connect(this.fader).connect(this.xf).connect(out);
    this.fader.connect(this.sends[0]).connect(sendBus[0]);
    this.fader.connect(this.sends[1]).connect(sendBus[1]);
  }
  apply(ctx: AudioContext, filters: readonly [FilterState, FilterState], xf: number, curve: Curve) {
    const t = ctx.currentTime, s = this.s, set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.008);
    set(this.trim.gain, dbGain(trimDb(s.trim)));
    for (const b of ["high", "hiMid", "loMid", "low"] as const) set(this.eq[b].gain, bandDb(b, s[b]));
    // the filter assigned and switched on (with a type pressed) takes the signal; otherwise it goes straight by
    const via = s.filter && filters[s.filter - 1]!.on && filters[s.filter - 1]!.types.length ? s.filter : 0;
    set(this.dry.gain, via ? 0 : 1);
    set(this.wet[0].gain, via === 1 ? 1 : 0); set(this.wet[1].gain, via === 2 ? 1 : 0);
    for (const i of [0, 1] as const) this.units[i].apply(filters[i], t);
    set(this.fader.gain, faderGain(s.fader));
    set(this.xf.gain, xfGain(s.xf, xf, curve));
    set(this.pfl.gain, s.cue ? 1 : 0);
    set(this.sends[0].gain, faderGain(s.send1)); set(this.sends[1].gain, faderGain(s.send2));
  }
}

/** Peak of an analyser's last few ms, 0 to 1. */
function peak(a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  a.getFloatTimeDomainData(buf);
  let m = 0;
  for (const v of buf) if (Math.abs(v) > m) m = Math.abs(v);
  return Math.min(1, m);
}

/** The mixer. Feed a channel through `channels[i].input`; `stream` is the master for the room, `sends` the aux buses. */
export class Mixer {
  readonly channels: Strip[];
  readonly stream: MediaStream;
  /** The two aux send buses (nothing returns them yet: an effect or a room can take them). */
  readonly sends: [GainNode, GainNode];
  readonly filters: [FilterState, FilterState];
  xfader = 0;
  curve: Curve = "smooth";
  master = 0.8;
  booth = 0.8;
  phones = 0.8;
  cueBlend = 0;
  split = false;
  /** Each LFO's oscillator and how it was started: at `t0`, `ph0` rounds in, at `hz`, in `shape` (to know its phase now). */
  private readonly lfo: [Lfo, Lfo];
  private readonly lfoDepth: [GainNode, GainNode];
  /** The decks' tempos for the LFOs (engine.ts sets it): side 0 is A, 1 is B. */
  follow: (side: 0 | 1) => Follow | null = () => null;
  private readonly taps: [number[], number[]] = [[], []];
  private readonly masterGain: GainNode;
  private readonly meters: [AnalyserNode, AnalyserNode];
  private readonly boothGain: GainNode;
  private readonly toSpeakers: GainNode;
  private readonly splitOut: GainNode;
  private readonly cueMix: [GainNode, GainNode];
  private readonly phonesGain: GainNode;
  private readonly buf = new Float32Array(512);

  constructor(readonly ctx: AudioContext, speakers: AudioNode = ctx.destination) {
    const filter = (): FilterState => ({ on: false, types: ["lp"], freq: 0.6, res: 0.3, depth: 0, beats: 4, bpm: 120, shape: "sine", follow: "a" });
    this.filters = [filter(), { ...filter(), types: ["hp"], freq: 0.3, follow: "b" }];
    const idle = (): Lfo => ({ osc: null, t0: 0, ph0: 0, hz: 0, shape: "sine" });
    this.lfo = [idle(), idle()];
    this.lfoDepth = [ctx.createGain(), ctx.createGain()];
    const bus = ctx.createGain(), cueBus = ctx.createGain();
    this.sends = [ctx.createGain(), ctx.createGain()];
    this.channels = Array.from({ length: CHANNELS }, () => new Strip(ctx, bus, cueBus, this.sends, this.lfoDepth));
    this.channels[DECK_CHANNEL[0]]!.s.xf = "x"; this.channels[DECK_CHANNEL[1]]!.s.xf = "y";
    this.masterGain = ctx.createGain();
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.08 });
    bus.connect(this.masterGain).connect(limiter);
    const dest = ctx.createMediaStreamDestination();
    limiter.connect(dest);
    this.stream = dest.stream;
    const lr = ctx.createChannelSplitter(2);
    this.meters = [new AnalyserNode(ctx, { fftSize: 512 }), new AnalyserNode(ctx, { fftSize: 512 })];
    limiter.connect(lr); lr.connect(this.meters[0], 0); lr.connect(this.meters[1], 1);
    // your speakers: the master at the booth level, or (split cue) the headphone mix left and the master right
    this.boothGain = ctx.createGain();
    this.toSpeakers = ctx.createGain();
    limiter.connect(this.boothGain).connect(this.toSpeakers).connect(speakers);
    this.cueMix = [ctx.createGain(), ctx.createGain()];
    this.phonesGain = ctx.createGain();
    cueBus.connect(this.cueMix[0]).connect(this.phonesGain);
    limiter.connect(this.cueMix[1]).connect(this.phonesGain);
    const merger = ctx.createChannelMerger(2);
    const mono = (n: AudioNode, ch: number) => { const g = new GainNode(ctx, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" }); n.connect(g).connect(merger, 0, ch); };
    mono(this.phonesGain, 0); mono(limiter, 1);
    this.splitOut = ctx.createGain();
    merger.connect(this.splitOut).connect(speakers);
    this.apply();
  }

  /** A channel's knob or fader: trim and the bands -1 to 1, the sends and the fader 0 to 1. */
  set(ch: Ch, k: ChannelKnob, v: number) {
    const lo = k === "fader" || k === "send1" || k === "send2" ? 0 : -1;
    this.channels[ch]!.s[k] = Math.min(1, Math.max(lo, v));
    this.apply();
  }
  cue(ch: Ch, on: boolean) { this.channels[ch]!.s.cue = on; this.apply(); }
  assignFilter(ch: Ch, n: 0 | 1 | 2) { this.channels[ch]!.s.filter = n; this.apply(); }
  assignX(ch: Ch, a: XAssign) { this.channels[ch]!.s.xf = a; this.apply(); }
  cross(x: number) { this.xfader = Math.min(1, Math.max(-1, x)); this.apply(); }
  setCurve(c: Curve) { this.curve = c; this.apply(); }
  setMaster(v: number) { this.master = Math.min(1, Math.max(0, v)); this.apply(); }
  setBooth(v: number) { this.booth = Math.min(1, Math.max(0, v)); this.apply(); }
  setPhones(v: number) { this.phones = Math.min(1, Math.max(0, v)); this.apply(); }
  setCueBlend(v: number) { this.cueBlend = Math.min(1, Math.max(0, v)); this.apply(); }
  setSplit(on: boolean) { this.split = on; this.apply(); }
  /** Filter `n` (0 or 1): any of on, types, freq (0 to 1), res (0 to 1), depth (0 to 1), beats, bpm. */
  filter(n: 0 | 1, to: Partial<FilterState>) {
    const f = this.filters[n];
    if (to.on !== undefined) f.on = to.on;
    if (to.types) f.types = (["hp", "bp", "lp"] as const).filter((t) => to.types!.includes(t));
    if (to.freq !== undefined) f.freq = Math.min(1, Math.max(0, to.freq));
    if (to.res !== undefined) f.res = Math.min(1, Math.max(0, to.res));
    if (to.depth !== undefined) f.depth = Math.min(1, Math.max(0, to.depth));
    if (to.beats !== undefined && to.beats > 0) f.beats = to.beats;
    if (to.bpm !== undefined) f.bpm = Math.min(200, Math.max(40, to.bpm));
    if (to.shape && LFO_SHAPES.includes(to.shape)) f.shape = to.shape;
    if (to.follow && LFO_FOLLOW.includes(to.follow)) f.follow = to.follow;
    this.apply();
  }
  /** A type button: pressed in or out (at least one stays in). */
  toggleType(n: 0 | 1, t: FilterType) {
    const now = this.filters[n].types, next = now.includes(t) ? now.filter((x) => x !== t) : [...now, t];
    if (next.length) this.filter(n, { types: next });
  }
  /** Filter `n`'s tap tempo button pressed at `ms`: the LFO's tempo from the last few taps. */
  tap(n: 0 | 1, ms: number) {
    const taps = this.taps[n];
    taps.push(ms);
    if (taps.length > 8) taps.shift();
    const bpm = tapBpm(taps);
    if (bpm) this.filter(n, { bpm, follow: "tap" });
  }

  private apply() {
    const t = this.ctx.currentTime, set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.008);
    for (const c of this.channels) c.apply(this.ctx, this.filters, this.xfader, this.curve);
    for (const i of [0, 1] as const) set(this.lfoDepth[i].gain, this.filters[i].depth * LFO_OCTAVES * 1200);
    this.tick();
    set(this.masterGain.gain, faderGain(this.master) * 1.25);
    set(this.boothGain.gain, boothGain(this.booth));
    set(this.toSpeakers.gain, this.split ? 0 : 1);
    set(this.splitOut.gain, this.split ? 1 : 0);
    set(this.cueMix[0].gain, 1 - this.cueBlend); set(this.cueMix[1].gain, this.cueBlend);
    set(this.phonesGain.gain, faderGain(this.phones) / faderGain(0.8));
  }

  /** LFO `n`'s tempo now: its deck's (when that has a beat grid) or the tapped one. */
  lfoBpm(n: 0 | 1): number {
    const f = this.filters[n], d = f.follow === "tap" ? null : this.follow(f.follow === "a" ? 0 : 1);
    return d?.bpm || f.bpm;
  }
  /** Where LFO `n` is in its round now (0 to 1). */
  lfoPhase(n: 0 | 1): number { const o = this.lfo[n], p = o.ph0 + o.hz * (this.ctx.currentTime - o.t0); return p - Math.floor(p); }
  /**
   * Each frame (and on every change): keep each LFO on its tempo and, following a deck that plays, on its beat (a round
   * starts on a downbeat). An oscillator can't be moved, so one that has drifted is replaced by one started in step.
   */
  tick() {
    const t = this.ctx.currentTime + 0.01;
    for (const n of [0, 1] as const) {
      const f = this.filters[n], o = this.lfo[n], hz = lfoHz(this.lfoBpm(n), f.beats);
      const deck = f.follow === "tap" ? null : this.follow(f.follow === "a" ? 0 : 1), beat = deck?.beatAt(t) ?? null;
      const now = o.osc ? o.ph0 + o.hz * (t - o.t0) : 0;
      const want = beat === null ? now : beat / f.beats;
      const off = Math.abs((((want - now) % 1) + 1.5) % 1 - 0.5);
      if (o.osc && o.shape === f.shape && Math.abs(o.hz - hz) < 1e-5 && off < 0.01) continue;
      const ph = want - Math.floor(want), { real, imag } = lfoTerms(f.shape, ph);
      const osc = new OscillatorNode(this.ctx, { frequency: hz, periodicWave: new PeriodicWave(this.ctx, { real, imag, disableNormalization: true }) });
      osc.connect(this.lfoDepth[n]); osc.start(t);
      if (o.osc) { const old = o.osc; old.onended = () => old.disconnect(); old.stop(t); }
      this.lfo[n] = { osc, t0: t, ph0: ph, hz, shape: f.shape };
    }
  }

  /** How loud channel `ch` is now, 0 to 1 (after its EQ and filter, before its fader). */
  level(ch: Ch): number { return peak(this.channels[ch]!.meter, this.buf); }
  /** The master's left and right, 0 to 1. */
  masterLevels(): [number, number] { return [peak(this.meters[0], this.buf), peak(this.meters[1], this.buf)]; }

  state(): MixerState {
    return {
      channels: this.channels.map((c) => ({ ...c.s })), filters: [{ ...this.filters[0], types: [...this.filters[0].types] }, { ...this.filters[1], types: [...this.filters[1].types] }],
      xfader: this.xfader, curve: this.curve, master: this.master, booth: this.booth, phones: this.phones, cueBlend: this.cueBlend, split: this.split,
    };
  }
}
