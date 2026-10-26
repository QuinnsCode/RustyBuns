// The music, synthesized in the page: a deep dub loop on the audio clock (half-time drums, a
// wobbling bass, a sub under it, a skank on the offbeats into the delay), a note per lane for the
// calls, and the player's answers sent through a feedback delay set to the chart's delay, so
// every answer echoes back on the beat it would have been due again. Nothing to license.
import type { Chart, Lane } from "./sim.ts";

// A minor pentatonic over a drone: any lane after any lane sounds like it was meant.
const LANE_HZ: Record<Lane, number> = { 0: 220, 1: 261.63, 2: 293.66, 3: 349.23 };

export class Music {
  readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly wet: GainNode;
  private readonly delay: DelayNode;
  private readonly filter: BiquadFilterNode;
  private start = 0;
  private nextBeat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chart: Chart | null = null;
  muted = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.7;
    // One slow filter over everything, swept by an LFO: the trippy part.
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 4000;
    this.filter.Q.value = 2;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 2500;
    lfo.connect(lfoGain).connect(this.filter.frequency);
    lfo.start();
    this.filter.connect(this.out).connect(this.ctx.destination);
    // The dub: a delay line that feeds itself, a little darker each pass.
    this.delay = this.ctx.createDelay(4);
    const fb = this.ctx.createGain();
    fb.gain.value = 0.55;
    const dark = this.ctx.createBiquadFilter();
    dark.type = "lowpass";
    dark.frequency.value = 1800;
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0.5;
    this.delay.connect(dark).connect(fb).connect(this.delay);
    this.delay.connect(this.wet).connect(this.filter);
  }

  /** Seconds per beat of the running chart. */
  get spb() { return 60 / (this.chart?.bpm ?? 120); }

  /** Where the song is, in beats, on the audio clock. */
  beat(): number {
    return this.chart ? (this.ctx.currentTime - this.start) / this.spb : 0;
  }

  /** Start the loop for a chart. Resolves once the context is running (a tap unlocks it on phones). */
  async play(chart: Chart) {
    this.chart = chart;
    await this.ctx.resume();
    this.delay.delayTime.value = chart.delay * this.spb;
    // Beat 0 is a bar away: the count-in (four hats, no kick) fills it, and nothing lands before
    // the clock's own zero, which a fresh context sits at.
    this.start = this.ctx.currentTime + 0.1 + 4 * this.spb;
    this.nextBeat = -4;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.chart = null;
  }

  // Look-ahead scheduling: everything within the next 150 ms is placed on the clock.
  private schedule() {
    if (!this.chart) return;
    const horizon = this.ctx.currentTime + 0.15;
    while (this.start + this.nextBeat * this.spb < horizon) {
      const b = this.nextBeat, t = this.start + b * this.spb;
      if (b >= this.chart.bars * 4) { this.stop(); return; }
      const bar = Math.floor(b / 4), inBar = ((b % 4) + 4) % 4;
      if (b >= 0) {
        // Half-time: the kick on the one, the snare on the three, so 140 feels like 70.
        if (inBar === 0 || (bar % 4 === 3 && inBar === 3)) this.kick(t);
        if (inBar === 2) this.snare(t);
        // The wobble: a bass note a bar long whose filter shakes at a rate the bar picks.
        if (inBar === 0) this.wobble(t, bar % 8 < 4 ? 36.71 : 41.2, [2, 3, 4, 1.5][bar % 4]!);
        if (inBar === 1 || inBar === 3) this.skank(t + this.spb / 2);
        if (bar % 4 === 0 && inBar === 0) this.pad(t, [110, 130.81, 164.81]);
      }
      this.hat(t + this.spb / 2, b < 0 ? 0.5 : 0.22);
      if (b < 0 || inBar === 1 || inBar === 3) this.hat(t, b < 0 ? 0.6 : 0.12);
      for (const c of this.chart.calls) if (c.beat === b || c.beat === b + 0.5) this.call(this.start + c.beat * this.spb, c.lane, c.hold);
      this.nextBeat += 1;
    }
  }

  /** The keyboard calling a lane: a plucked note, held ones ring on. */
  call(t: number, lane: Lane, hold = 0) {
    this.tone(t, LANE_HZ[lane], hold ? hold * this.spb : 0.18, "triangle", 0.35, this.filter);
  }

  /** The player's answer: the same note an octave up, into the dub delay. Wrong is a dull thud. */
  answer(lane: Lane, grade: "perfect" | "good" | "bad", hold = 0) {
    const t = this.ctx.currentTime;
    if (grade === "bad") { this.tone(t, 70, 0.12, "square", 0.25, this.filter); return; }
    this.tone(t, LANE_HZ[lane] * 2, hold ? hold * this.spb : 0.22, grade === "perfect" ? "sawtooth" : "triangle", 0.4, this.delay);
    this.tone(t, LANE_HZ[lane] * 2, 0.22, "triangle", 0.2, this.filter);
  }

  private tone(t: number, hz: number, len: number, type: OscillatorType, vol: number, to: AudioNode) {
    if (this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + len, 0.06);
    o.connect(g).connect(to);
    o.start(t);
    o.stop(t + len + 0.4);
  }

  private kick(t: number) {
    if (this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.35);
  }

  private hat(t: number, vol: number) {
    if (this.muted) return;
    const n = this.ctx.createBufferSource(), buf = this.ctx.createBuffer(1, 2205, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    n.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.value = vol * 0.35;
    n.connect(hp).connect(g).connect(this.out);
    n.start(t);
  }

  // Two saws a hair apart and a sine an octave under, through a lowpass an LFO opens and shuts
  // `rate` times a beat. The rate is the wobble; the sub is what the phone's speaker can't do but
  // headphones can.
  private wobble(t: number, hz: number, rate: number) {
    if (this.muted) return;
    const len = this.spb * 4;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 8;
    lp.frequency.value = 200;
    const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain();
    lfo.frequency.value = rate / this.spb;
    depth.gain.value = 900;
    lfo.connect(depth).connect(lp.frequency);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.28, t + 0.02);
    g.gain.setValueAtTime(0.28, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const detune of [-7, 7]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz * 2;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + len);
    }
    lp.connect(g).connect(this.filter);
    lfo.start(t);
    lfo.stop(t + len);
    this.tone(t, hz, len - 0.05, "sine", 0.5, this.out);
  }

  /** The skank: a short minor chord on the offbeat, straight into the dub line. */
  private skank(t: number) {
    for (const hz of [220, 261.63, 329.63]) this.tone(t, hz, 0.08, "square", 0.05, this.delay);
  }

  private snare(t: number) {
    if (this.muted) return;
    const n = this.ctx.createBufferSource(), buf = this.ctx.createBuffer(1, 8820, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    n.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    n.connect(bp).connect(g).connect(this.out);
    n.connect(bp).connect(this.delay);
    n.start(t);
    this.tone(t, 180, 0.08, "triangle", 0.4, this.out);
  }

  private pad(t: number, hzs: number[]) {
    for (const hz of hzs) this.tone(t, hz * (1 + (Math.random() - 0.5) * 0.004), this.spb * 7, "sine", 0.08, this.delay);
  }
}
