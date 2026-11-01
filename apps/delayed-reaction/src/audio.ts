// The music, synthesized in the page: a deep dub loop on the audio clock (half-time drums, a
// wobbling bass, a sub under it, a skank on the offbeats into the delay), a note per lane for the
// calls, and the player's answers sent through a feedback delay set to the chart's delay, so
// every answer echoes back on the beat it would have been due again. Speed (run.speed) opens the
// master filter and brings in a hat pattern; the fence shuts it all down for a moment. Nothing to license.
//
// The mix, after the reference radio in VISION.md: drums, sub and the bass sit dead centre and dry.
// Only the synths (skank, pad, calls and answers) go into the dub line, and the dub line is a
// ping-pong, left then right, so the synths are the wide part. Once every 64 bars the bass moves;
// once every 16 it rests a bar, and the delay tail is all that's left.
//
// A setup (src/dub.ts) replaces the fixed loop with an arranged track: 64 or 128 bars in sections at 86 bpm or 1.3x
// that, a snap clap on the three, grooved hats, eighth-note ticks into the dub, growls that stretch over 8 or 16 bars,
// a triplet rise and cut before each drop, and a delay that lives on the instrument, on the bus, or both.
import { mulberry32 } from "@rustybuns/util";
import { arrange, SWING, type Setup } from "./dub.ts";
import { SPEED_CEILING, SPEED_FLOOR, type Chart, type Lane } from "./sim.ts";

// A minor pentatonic over a drone: any lane after any lane sounds like it was meant.
const LANE_HZ: Record<Lane, number> = { 0: 220, 1: 261.63, 2: 293.66, 3: 349.23 };

/** The four parts of the mix, for rendering one at a time: drums, the bass (sub and growl), the dry synths, and the dub line's return. */
export const STEMS = ["drums", "bass", "synth", "dub"] as const;
export type Stem = (typeof STEMS)[number];

// The stab's chords: A minor seventh, and a step up for the phrase it says every eighth bar.
const STAB_LOW = [220, 261.63, 329.63, 392] as const;
const STAB_HIGH = [246.94, 293.66, 349.23, 440] as const;
// The master level: loud enough on a phone, with headroom for the dub tail and the speed's open filter on top.
const MASTER = 0.45;
// The wobble's rate, in cycles a beat, by the bar's place in four.
const RATES = [2, 3, 4, 1.5] as const;

/** A soft clip: `amount` 0 is a straight line, 1 is hard. */
function saturation(amount: number) {
  const n = 1024, c = new Float32Array(new ArrayBuffer(n * 4)), k = 1 + amount * 12;
  for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / Math.tanh(k);
  return c;
}

export class Music {
  readonly ctx: AudioContext | OfflineAudioContext;
  private readonly out: GainNode;
  private readonly wet: GainNode;
  private readonly delay: DelayNode;   // the left tap; its echo crosses to the right tap and back
  private readonly delayR: DelayNode;
  private readonly filter: BiquadFilterNode;
  private readonly sweep: GainNode;
  private readonly lfo: OscillatorNode;      // the master filter's sweep; a setup picks its rate
  private readonly reverb: ConvolverNode;    // only a wide stab goes here
  private setup: Setup | null = null;
  private stabIn: AudioNode | null = null;   // the stab's and the note's channels: dry plus their own echo, per the setup
  private noteIn: AudioNode | null = null;
  private speed = SPEED_FLOOR;
  private bright = 0;          // 0 at the speed floor, 1 at the ceiling
  private dullUntil = 0;       // after a fence hit: the hats stay out and the filter stays shut
  private start = 0;
  private nextBeat = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chart: Chart | null = null;
  private readonly rand: () => number;
  private readonly curve: Float32Array<ArrayBuffer>;
  muted = false;
  /** Play only this part of the mix (the other three stay silent), or the whole mix when null. */
  only: Stem | null = null;

  /** A live context by default; a render passes an OfflineAudioContext and a seed so every stem is the same take. */
  constructor(ctx: AudioContext | OfflineAudioContext = new AudioContext({ latencyHint: "interactive" }), seed = 1) {
    this.ctx = ctx;
    this.rand = mulberry32(seed);
    this.curve = saturation(0.35);
    this.out = this.ctx.createGain();
    this.out.gain.value = MASTER;
    // One slow filter over everything, swept by an LFO: the trippy part.
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 2000;
    this.filter.Q.value = 2;
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 0.07;
    this.sweep = this.ctx.createGain();
    this.sweep.gain.value = 1200;
    this.lfo.connect(this.sweep).connect(this.filter.frequency);
    this.lfo.start();
    // A room for the wide stabs: two seconds of decaying noise, different each side, so what goes in comes back spread.
    this.reverb = this.ctx.createConvolver();
    const ir = this.ctx.createBuffer(2, Math.ceil(2.2 * this.ctx.sampleRate), this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (this.rand() * 2 - 1) * Math.exp((-4 * i) / d.length);
    }
    this.reverb.buffer = ir;
    const room = this.ctx.createGain();
    room.gain.value = 0.35;
    this.reverb.connect(room).connect(this.filter);
    // A 15 Hz high-pass at the very end: no speaker should be asked to hold a DC offset.
    const block = this.ctx.createBiquadFilter();
    block.type = "highpass";
    block.frequency.value = 15;
    this.filter.connect(this.out).connect(block).connect(this.ctx.destination);
    // The dub: two delay taps feeding each other, left then right, a little darker each pass.
    // Up to sixteen beats at 60 bpm: the longest a scenario can ask for.
    this.delay = this.ctx.createDelay(16);
    this.delayR = this.ctx.createDelay(16);
    this.wet = this.ctx.createGain();
    this.wet.gain.value = 0.5;
    const cross = (from: DelayNode, to: DelayNode, pan: number) => {
      const dark = this.ctx.createBiquadFilter();
      dark.type = "lowpass";
      dark.frequency.value = 1800;
      const fb = this.ctx.createGain();
      fb.gain.value = 0.6;
      from.connect(dark).connect(fb).connect(to);
      const side = this.ctx.createStereoPanner();
      side.pan.value = pan;
      from.connect(side).connect(this.wet);
    };
    cross(this.delay, this.delayR, -0.8);
    cross(this.delayR, this.delay, 0.8);
    this.wet.connect(this.filter);
  }

  /** Follow the run's speed: brighter and busier as it climbs. A sudden drop is the fence: the filter slams shut,
   *  the hats drop out and everything goes quiet for half a bar, then eases back to where the speed now sits. */
  setSpeed(speed: number) {
    const now = this.ctx.currentTime, f = this.filter.frequency, sw = this.sweep.gain;
    const fenced = speed < this.speed - 0.1;
    this.speed = speed;
    const bright = Math.max(0, Math.min(1, (speed - SPEED_FLOOR) / (SPEED_CEILING - SPEED_FLOOR)));
    if (!fenced && Math.abs(bright - this.bright) < 0.02) return;
    this.bright = bright;
    if (fenced) {
      this.dullUntil = now + 2 * this.spb;
      for (const p of [f, sw, this.out.gain]) p.cancelScheduledValues(now);
      f.setValueAtTime(350, now);
      sw.setValueAtTime(150, now);
      this.out.gain.setValueAtTime(this.master * 0.65, now);
      this.out.gain.setTargetAtTime(this.master, this.dullUntil, this.spb);
    }
    // The base the slow LFO sweeps around: a dark 2 kHz at the floor, wide open at the ceiling.
    const base = 2000 + 5500 * bright, at = Math.max(now, this.dullUntil);
    f.setTargetAtTime(base, at, 0.3);
    sw.setTargetAtTime(base * 0.6, at, 0.3);
  }

  // A voice's own soft clipper. Never shared: a node fed by one voice and wired onward by another carries every old voice's filter with it.
  private crunch() {
    const w = this.ctx.createWaveShaper();
    w.curve = this.curve;
    w.oversample = "2x";
    return w;
  }

  // Whether a part of the mix sounds now: not muted, and not left out of a one-stem render.
  private on(part: Stem) { return !this.muted && (!this.only || this.only === part); }

  // An arranged track stacks more at once (sub, growl, toms, two tails), so it runs a touch lower for the same headroom.
  private get master() { return this.setup ? MASTER * 0.85 : MASTER; }

  /** Seconds per beat of the running chart. */
  get spb() { return 60 / (this.chart?.bpm ?? 120); }

  /** Where the song is, in beats, on the audio clock. */
  beat(): number {
    return this.chart ? (this.ctx.currentTime - this.start) / this.spb : 0;
  }

  /** Start the loop for a chart, or a setup's arranged track. Resolves once the context is running (a tap unlocks it on phones). */
  async play(chart: Chart, from = 0, setup: Setup | null = null) {
    await this.ctx.resume();
    this.begin(chart, from, setup);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  /** Put the whole song on an offline clock at once, for a render: nothing is timed, everything is placed. */
  prepare(chart: Chart, from = 0, setup: Setup | null = null) {
    this.begin(chart, from, setup, 0);
    this.schedule(Infinity);
  }

  /** Seconds the song, its count-in and the dub tail fill from the clock's zero. */
  static length(chart: Chart, from = 0) {
    const spb = 60 / chart.bpm;
    return (chart.bars * 4 - from + (from ? 0 : 4) + chart.delay * 4) * spb + 0.5;
  }

  private begin(chart: Chart, from: number, setup: Setup | null, at = this.ctx.currentTime + 0.1) {
    this.chart = chart;
    this.setup = setup;
    this.delay.delayTime.value = this.delayR.delayTime.value = chart.delay * this.spb;
    // The master sweep takes the setup's count of bars; the fixed loop keeps its own slow one.
    this.lfo.frequency.value = setup ? 1 / (setup.lfo * 4 * this.spb) : 0.07;
    this.stabIn = setup ? this.channel(setup.echo) : null;
    this.noteIn = setup ? this.channel(setup.echo) : null;
    this.speed = SPEED_FLOOR;
    this.bright = this.dullUntil = 0;
    for (const p of [this.filter.frequency, this.sweep.gain, this.out.gain]) p.cancelScheduledValues(0);
    this.filter.frequency.value = 2000;
    this.sweep.gain.value = 1200;
    this.out.gain.value = this.master;
    // Beat 0 is a bar away: the count-in (four hats, no kick) fills it, and nothing lands before
    // the clock's own zero, which a fresh context sits at.
    // A scenario can start further in: no count-in, and the song is already `from` beats along.
    this.start = at + (from ? -from : 4) * this.spb;
    this.nextBeat = from ? Math.floor(from) : -4;
  }

  /** Seconds between a sound being placed on the clock and reaching the player's ears. */
  get latency() { return this.ctx instanceof AudioContext ? this.ctx.outputLatency || this.ctx.baseLatency || 0 : 0; }

  /** Hold the clock (a dialog is open) or let it run again. A render's clock isn't held. */
  hold(on: boolean) {
    if (this.ctx instanceof AudioContext) void (on ? this.ctx.suspend() : this.ctx.resume());
  }

  stop() {
    this.halt();
    this.chart = null;
  }

  // Nothing more to schedule. The chart stays, so beat() keeps counting past the song's end and the run can finish.
  private halt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Look-ahead scheduling: everything within the next 150 ms is placed on the clock.
  private schedule(horizon = this.ctx.currentTime + 0.15) {
    if (!this.chart) return;
    while (this.start + this.nextBeat * this.spb < horizon) {
      const b = this.nextBeat, t = this.start + b * this.spb;
      if (b >= this.chart.bars * 4) { this.halt(); return; }
      const bar = Math.floor(b / 4), inBar = ((b % 4) + 4) % 4;
      if (b >= 0 && this.setup) {
        if (inBar === 0) this.bar(this.setup, bar, t);
      } else if (b >= 0) {
        // Half-time: the kick on the one, the snare on the three, so 140 feels like 70.
        if (inBar === 0 || (bar % 4 === 3 && inBar === 3)) this.kick(t);
        if (inBar === 2) this.snare(t);
        // Ghost snares, barely there, just ahead of the next hit: the muted breakbeat feel.
        if (inBar === 1 && bar % 2 === 1) this.snare(t + 0.75 * this.spb, 0.14);
        if (inBar === 3 && bar % 4 === 2) this.snare(t + 0.5 * this.spb, 0.1);
        // The wobble: a bass note a bar long whose filter shakes at a rate the bar picks. The note
        // moves once a 64-bar phrase (up for the last eight bars) and every 16th bar the bass rests,
        // skank and all, so the dub tail has a bar to itself.
        const rest = bar % 16 === 15;
        if (inBar === 0 && !rest) {
          const kicks = bar % 4 === 3 ? [0, 3] : [0];
          this.wobble(t, bar % 64 < 56 ? 36.71 : 41.2, RATES[bar % 4]!, bar, kicks);
        }
        // The stab says a short phrase on the offbeats every eighth bar; the growl answers a bar later.
        if (!rest && (inBar === 1 || inBar === 3)) {
          const said = bar % 8 === 1 && inBar === 1;
          this.stab(t + this.spb / 2, said ? STAB_HIGH : STAB_LOW);
          if (said) this.stab(t + 1.5 * this.spb, STAB_HIGH);
        }
        if (!rest && bar % 8 === 2 && inBar === 1) this.growl(t + 0.5 * this.spb, bar % 64 < 56 ? 55 : 61.74, this.spb * 1.5);
        if (bar % 32 === 0 && inBar === 0) this.pad(t, [110, 130.81, 164.81]);
      }
      // Just off the fence the hats drop out; otherwise the count-in's, or the fixed loop's own (a setup's come with its bar),
      // plus sixteenths that come in as speed climbs.
      if (b < 0 || t >= this.dullUntil) {
        if (b < 0) { this.hat(t + this.spb * SWING, 0.5); this.hat(t, 0.6); }
        else if (!this.setup) { this.hat(t + this.spb * SWING, 0.22); if (inBar === 1 || inBar === 3) this.hat(t, 0.12); }
        if (b >= 0 && this.bright > 0.25) for (const q of [0.25, 0.75]) this.hat(t + (q + (q > 0.5 ? SWING - 0.5 : 0)) * this.spb, 0.18 * this.bright);
        if (b >= 0 && this.bright > 0.6 && inBar !== 1 && inBar !== 3) this.hat(t, 0.1 * this.bright);
      }
      for (const c of this.chart.calls) {
        if (c.beat === b || c.beat === b + 0.5) this.call(this.start + c.beat * this.spb, c.lane, c.hold);
        // The tail: a muted tick of the call's note every beat until it's due, fading, so the delay counts down out loud.
        const k = Math.ceil(b - c.beat);
        const span = c.due - c.beat;
        if (k >= 1 && k < span) this.tick(this.start + (c.beat + k) * this.spb, c.lane, 1 - k / span);
        // The hint: the call comes round again on its due beat, quieter. That's the beat to answer on.
        if (this.chart.hint && (c.due === b || c.due === b + 0.5)) this.call(this.start + c.due * this.spb, c.lane, c.hold, this.chart.hint);
      }
      this.nextBeat += 1;
    }
  }

  // One bar of a setup's track, placed from its one: what dub.ts arranged, voice by voice.
  private bar(setup: Setup, bar: number, t: number) {
    const a = arrange(setup, bar), at = (beats: number) => t + beats * this.spb;
    for (const k of a.kicks) this.kick(at(k));
    for (const k of a.backs) this.back(at(k), setup.back);
    for (const k of a.toms) this.tom(at(k));
    if (t >= this.dullUntil) for (const h of a.hats) this.hat(at(h.at), h.vol);
    for (const k of a.fx) this.tick8(at(k), a.root * 32, bar);
    if (a.bass === "wobble") this.wobble(t, a.root, RATES[bar % 4]!, bar, a.kicks);
    else if (a.bass === "sub") this.sub(t, a.root, a.kicks);
    if (a.growl) this.longGrowl(t, a.root, a.growl);
    if (a.rise) this.riser(at(2), a.root);
    for (const s of a.stabs) this.stab(at(s), a.at % 8 === 1 ? STAB_HIGH : STAB_LOW, setup.stab === "wide");
    if (a.note) this.note(t, a.root * 4);
    if (a.pad) this.pad(t, [a.root * 3, a.root * 3 * 1.1892, a.root * 3 * 1.4983]);
  }

  // A synth's channel: where its sound goes so the dub delay lives where the setup says. On the bus, straight into the
  // ping-pong. On the instrument, dry plus its own echo at three quarters of the bus time, feeding back darker; both
  // sends that echo on round the bus too, so the two tails rub.
  private channel(echo: Setup["echo"]): AudioNode {
    if (echo === "bus") return this.delay;
    const input = this.ctx.createGain(), own = this.ctx.createDelay(16), fb = this.ctx.createGain(), dark = this.ctx.createBiquadFilter();
    own.delayTime.value = (this.chart?.delay ?? 4) * this.spb * 0.75;
    dark.type = "lowpass";
    dark.frequency.value = 1500;
    fb.gain.value = 0.55;
    input.connect(this.filter);
    input.connect(own).connect(dark).connect(fb).connect(own);
    own.connect(this.filter);
    if (echo === "both") { const send = this.ctx.createGain(); send.gain.value = 0.4; own.connect(send).connect(this.delay); }
    return input;
  }

  /** The backbeat on the three: a snap clap (three bursts and a snap), the snare, or a rim click. Mono, dry. */
  private back(t: number, kind: Setup["back"]) {
    if (kind === "snare") return this.snare(t);
    if (!this.on("drums")) return;
    if (kind === "rim") {
      this.tone(t, 1200, 0.02, "sine", 0.3, this.out, 0, "drums");
      this.tone(t, 420, 0.015, "square", 0.12, this.out, 0, "drums");
      return;
    }
    for (const [dt, vol] of [[0, 0.5], [0.012, 0.4], [0.024, 0.45]] as const) this.noise(t + dt, 0.022, "bandpass", [2000, 1900], vol, this.out);
    this.noise(t + 0.03, 0.14, "bandpass", [2200, 1200], 0.35, this.out);
    this.tone(t, 3000, 0.008, "sine", 0.18, this.out, 0, "drums");
  }

  /** The tribal stomp: a short tom, mono. */
  private tom(t: number) {
    if (!this.on("drums")) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** An eighth-note effect: a tiny square blip high up, its pitch bent by the bar, into the dub so it ticks away down the tail. */
  private tick8(t: number, hz: number, bar: number) {
    this.tone(t, hz * [1, 1.5, 1.25, 2][bar % 4]!, 0.03, "square", 0.045, this.delay);
  }

  /** The sub alone for a bar (a build, a break): the weight with nothing on it, ducked on every kick. */
  private sub(t: number, hz: number, kicks: number[]) {
    if (!this.on("bass")) return;
    const len = this.spb * 4, duck = this.ctx.createGain(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    duck.gain.setValueAtTime(1, t);
    for (const k of kicks) {
      duck.gain.setValueAtTime(0.3, t + k * this.spb);
      duck.gain.linearRampToValueAtTime(1, t + k * this.spb + 0.22);
    }
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.03);
    g.gain.setValueAtTime(0.5, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(g).connect(duck).connect(this.out);
    o.start(t);
    o.stop(t + len);
  }

  /** A dub growl that stretches over `bars`: an FM bark whose cutoff and index open over the whole span while an LFO a bar
   *  long shakes them, then a hard cut on the last beat. Mono and dry. */
  private longGrowl(t: number, hz: number, bars: number) {
    if (!this.on("bass")) return;
    const len = bars * 4 * this.spb, end = t + len;
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), idx = this.ctx.createGain();
    car.frequency.value = hz * 2;
    mod.frequency.value = hz * 2.005;
    idx.gain.setValueAtTime(hz * 0.5, t);
    idx.gain.linearRampToValueAtTime(hz * 4, end - this.spb);
    mod.connect(idx).connect(car.frequency);
    const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain(), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lfo.frequency.value = 1 / (4 * this.spb);
    depth.gain.setValueAtTime(40, t);
    depth.gain.linearRampToValueAtTime(400, end - this.spb);
    lp.type = "lowpass";
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.exponentialRampToValueAtTime(1100, end - this.spb);
    lfo.connect(depth).connect(lp.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.5);
    g.gain.setValueAtTime(0.16, end - this.spb);
    g.gain.linearRampToValueAtTime(0, end - this.spb + 0.02);
    car.connect(this.crunch()).connect(lp).connect(g).connect(this.out);
    for (const o of [car, mod, lfo]) { o.start(t); o.stop(end); }
  }

  /** The quick rise: three triplet steps up over the bar's second half, saw and air, the filter opening, then cut dead on
   *  the next one. Into the dub as well, so the cut echoes. */
  private riser(t: number, hz: number) {
    const end = t + 2 * this.spb, step = (2 * this.spb) / 3;
    const o = this.ctx.createOscillator(), lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = "sawtooth";
    [1, 1.25, 1.5].forEach((m, i) => o.frequency.setValueAtTime(hz * 8 * m, t + i * step));
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(5000, end);
    g.gain.setValueAtTime(0.03, t);
    g.gain.linearRampToValueAtTime(0.12, end - 0.01);
    g.gain.setValueAtTime(0, end);
    o.connect(lp).connect(g);
    if (this.on("synth")) g.connect(this.filter);
    if (this.on("dub")) { const send = this.ctx.createGain(); send.gain.value = 0.5; g.connect(send).connect(this.delay); }
    o.start(t);
    o.stop(end);
    this.noise(t, 2 * this.spb, "bandpass", [400, 6000], 0.25, this.filter, "synth");
  }

  /** The synth: one note, two saws a hair apart through a lowpass an LFO opens twice a bar, a beat and a half long, into its
   *  channel so the dub delays it out. */
  private note(t: number, hz: number) {
    if (!this.on("dub") || !this.noteIn) return;
    const len = 1.5 * this.spb, lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.value = 700;
    lfo.frequency.value = 1 / (2 * this.spb);
    depth.gain.value = 450;
    lfo.connect(depth).connect(lp.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.setTargetAtTime(0, t + len, 0.08);
    lp.connect(this.crunch()).connect(g).connect(this.noteIn);
    for (const detune of [-6, 6]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz;
      o.detune.value = detune;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.5);
    }
    lfo.start(t);
    lfo.stop(t + len + 0.5);
  }

  /** The keyboard calling a lane: a plucked note, held ones ring on. */
  call(t: number, lane: Lane, hold = 0, vol = 1) {
    this.tone(t, LANE_HZ[lane], hold ? hold * this.spb : 0.18, "triangle", 0.35 * vol, vol < 1 ? this.delay : this.filter);
  }

  /** One ring of a call's tail: a short, soft copy of its note, dry so it doesn't smear into the echo. */
  private tick(t: number, lane: Lane, fade: number) {
    this.tone(t, LANE_HZ[lane], 0.05, "sine", 0.12 * fade, this.filter);
  }

  /** Through a door: a whoosh of air past the runner, and the call's note an octave up into the dub delay. */
  answer(lane: Lane, grade: "perfect" | "good", hold = 0) {
    const t = this.ctx.currentTime;
    this.noise(t, 0.35, "bandpass", [500, 4000], grade === "perfect" ? 0.35 : 0.25, this.filter, "synth");
    this.tone(t, LANE_HZ[lane] * 2, hold ? hold * this.spb : 0.22, grade === "perfect" ? "sawtooth" : "triangle", 0.4, this.delay);
    this.tone(t, LANE_HZ[lane] * 2, 0.22, "triangle", 0.2, this.filter);
  }

  /** Off a wall: a dull body thud, a low drop and a muffled smack. Dry: hits don't go round the dub line. */
  wall() {
    const t = this.ctx.currentTime;
    if (!this.on("drums")) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.45);
    this.noise(t, 0.12, "lowpass", [600, 200], 0.5, this.out, "drums");
  }

  // A burst of noise through a filter swept from one frequency to another: the whoosh and the smack.
  private noise(t: number, len: number, type: BiquadFilterType, [from, to]: [number, number], vol: number, dest: AudioNode, group: Stem = "drums") {
    if (!this.on(group)) return;
    const n = this.ctx.createBufferSource(), buf = this.ctx.createBuffer(1, Math.ceil(len * this.ctx.sampleRate), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (this.rand() * 2 - 1) * Math.sin((Math.PI * i) / d.length);
    n.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = type === "bandpass" ? 1.5 : 0.7;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + len);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    n.connect(f).connect(g).connect(dest);
    n.start(t);
  }

  private tone(t: number, hz: number, len: number, type: OscillatorType, vol: number, to: AudioNode, pan = 0, group: Stem = "synth") {
    if (!this.on(to === this.delay ? "dub" : group)) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + len, 0.06);
    o.connect(g);
    if (pan) {
      const side = this.ctx.createStereoPanner();
      side.pan.value = pan;
      g.connect(side).connect(to);
    } else g.connect(to);
    o.start(t);
    o.stop(t + len + 0.4);
  }

  private kick(t: number) {
    if (!this.on("drums")) return;
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
    if (!this.on("drums")) return;
    const n = this.ctx.createBufferSource(), buf = this.ctx.createBuffer(1, 2205, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (this.rand() * 2 - 1) * (1 - i / d.length) ** 3;
    n.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.value = vol * 0.35;
    n.connect(hp).connect(g).connect(this.out);
    n.start(t);
  }

  // The bass for one bar: a sine sub in the middle, a mono FM growl over it, and two saws a hair apart,
  // one each side, through lowpasses one LFO opens and shuts `rate` times a beat. The growl's
  // cutoff and modulation index breathe over sixteen bars, not beats, and the sub ducks on every kick
  // so the two don't fight. Only the saws are wide: the weight stays mono and dry.
  private wobble(t: number, hz: number, rate: number, bar: number, kicks: number[]) {
    if (!this.on("bass")) return;
    const len = this.spb * 4;
    // The slow part: 0 to 1 and back over sixteen bars.
    const open = 0.5 - 0.5 * Math.cos((2 * Math.PI * (bar % 16)) / 16);
    const duck = this.ctx.createGain();
    duck.gain.setValueAtTime(1, t);
    for (const k of kicks) {
      duck.gain.setValueAtTime(0.3, t + k * this.spb);
      duck.gain.linearRampToValueAtTime(1, t + k * this.spb + 0.22);
    }
    duck.connect(this.out);
    const swell = this.ctx.createGain();
    swell.gain.setValueAtTime(0, t);
    swell.gain.linearRampToValueAtTime(1, t + 0.02);
    swell.gain.setValueAtTime(1, t + len - 0.1);
    swell.gain.linearRampToValueAtTime(0, t + len);
    swell.connect(duck);
    const sub = this.ctx.createOscillator(), subG = this.ctx.createGain();
    sub.frequency.value = hz;
    subG.gain.value = 0.5;
    sub.connect(subG).connect(swell);
    sub.start(t);
    sub.stop(t + len);
    // FM growl: a sine carrier an octave up, a sine modulator at the same pitch, the index moving with `open`.
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), idx = this.ctx.createGain();
    car.frequency.value = hz * 2;
    mod.frequency.value = hz * 2;
    idx.gain.value = hz * 2 * (0.6 + 1.6 * open);
    mod.connect(idx).connect(car.frequency);
    const lfo = this.ctx.createOscillator(), depth = this.ctx.createGain();
    lfo.frequency.value = rate / this.spb;
    depth.gain.value = 120 + 500 * open;
    lfo.connect(depth);
    const lp = this.ctx.createBiquadFilter(), gg = this.ctx.createGain();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.value = 160 + 380 * open;
    depth.connect(lp.frequency);
    gg.gain.value = 0.2;
    car.connect(this.crunch()).connect(lp).connect(gg).connect(swell);
    for (const o of [car, mod, lfo]) { o.start(t); o.stop(t + len); }
    // The wide saws, quiet now: colour for the growl, not the weight.
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.02);
    g.gain.setValueAtTime(0.08, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0, t + len);
    for (const [detune, pan] of [[-7, -0.5], [7, 0.5]] as const) {
      const lp2 = this.ctx.createBiquadFilter();
      lp2.type = "lowpass";
      lp2.Q.value = 6;
      lp2.frequency.value = 200;
      depth.connect(lp2.frequency);
      const side = this.ctx.createStereoPanner();
      side.pan.value = pan;
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz * 2;
      o.detune.value = detune;
      o.connect(lp2).connect(side).connect(g);
      o.start(t);
      o.stop(t + len);
    }
    g.connect(this.filter);
  }

  /** The answer to the stab: a short FM bark that falls a fifth, saturated, dead centre and dry. */
  private growl(t: number, hz: number, len: number) {
    if (!this.on("bass")) return;
    const car = this.ctx.createOscillator(), mod = this.ctx.createOscillator(), idx = this.ctx.createGain();
    car.frequency.setValueAtTime(hz * 2, t);
    car.frequency.exponentialRampToValueAtTime(hz * 1.33, t + len);
    mod.frequency.setValueAtTime(hz * 2.01, t);
    mod.frequency.exponentialRampToValueAtTime(hz * 1.34, t + len);
    idx.gain.setValueAtTime(hz * 3, t);
    idx.gain.exponentialRampToValueAtTime(hz * 0.4, t + len);
    mod.connect(idx).connect(car.frequency);
    const lp = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    lp.type = "lowpass";
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.015);
    g.gain.setTargetAtTime(0, t + len * 0.6, 0.08);
    car.connect(this.crunch()).connect(lp).connect(g).connect(this.out);
    for (const o of [car, mod]) { o.start(t); o.stop(t + len + 0.5); }
  }

  /** The stab: a minor chord of detuned saws that drops in pitch over its first 30 ms, a little saturation, a short body,
   *  and the whole of it into the ping-pong, so the tail is what you hear. */
  private stab(t: number, hzs: readonly number[], wide = false) {
    if (!this.on("dub")) return;
    const g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.14);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(this.setup ? 0.05 : 0.07, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.05, 0.05);
    const body = g.connect(this.crunch()).connect(lp);
    // A wide stab leans to one side (an LFO wanders it) and goes to the room as well; the rest sit mono in their channel.
    if (wide) {
      const side = this.ctx.createStereoPanner(), sway = this.ctx.createOscillator(), amount = this.ctx.createGain();
      sway.frequency.value = 1 / (8 * this.spb);
      amount.gain.value = 0.7;
      sway.connect(amount).connect(side.pan);
      sway.start(t);
      sway.stop(t + 1);
      body.connect(side).connect(this.stabIn ?? this.delay);
      body.connect(this.reverb);
    } else body.connect(this.stabIn ?? this.delay);
    for (const hz of hzs) for (const detune of [-9, 9]) {
      const o = this.ctx.createOscillator();
      o.type = "sawtooth";
      o.detune.value = detune;
      o.frequency.setValueAtTime(hz * 1.09, t);
      o.frequency.exponentialRampToValueAtTime(hz, t + 0.03);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  private snare(t: number, vol = 1) {
    if (!this.on("drums")) return;
    const n = this.ctx.createBufferSource(), buf = this.ctx.createBuffer(1, 8820, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (this.rand() * 2 - 1) * (1 - i / d.length) ** 2;
    n.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.value = 0.5 * vol;
    n.connect(bp).connect(g).connect(this.out);
    n.start(t);
    this.tone(t, 180, 0.08, "triangle", 0.4 * vol, this.out, 0, "drums");
  }

  /** The pad: three sines spread across the field, a hair out of tune, and the same into the dub. */
  private pad(t: number, hzs: number[]) {
    hzs.forEach((hz, i) => {
      const drift = hz * (1 + (this.rand() - 0.5) * 0.004);
      this.tone(t, drift, this.spb * 7, "sine", 0.06, this.filter, (i - 1) * 0.7);
      this.tone(t, drift, this.spb * 7, "sine", 0.05, this.delay);
    });
  }
}
