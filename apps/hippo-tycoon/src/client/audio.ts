// Every sound is synthesised here: grunts, bellows, chomps, coins. No samples.
// Two buses under the master: the music (the synth pulse) and the effects
// (everything else, the jungle included), so each can be muted on its own.
import { GOLD, GULP_OUT, NAIL, SLUDGE, TICK_HZ, WATER } from "../sim/rules.ts";
import type { Event } from "../sim/types.ts";
import { LOOKS } from "./render/looks.ts";

type Wave = OscillatorType;
export interface Mix { muted: boolean; music: boolean; effects: boolean }

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private mix: Mix = { muted: false, music: true, effects: true };
  get muted() { return this.mix.muted; }

  /** Browsers want a gesture first: call from a click or key. */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain(); this.music.connect(this.master);
      this.effects = this.ctx.createGain(); this.effects.connect(this.master);
      this.setMix(this.mix);
      const n = this.ctx.sampleRate, buf = this.ctx.createBuffer(1, n, n), d = buf.getChannelData(0);
      let x = 1; for (let i = 0; i < n; i++) { x = (x * 16807) % 2147483647; d[i] = x / 1073741823 - 1; }
      this.noiseBuf = buf;
      this.ambience();
    } catch { this.ctx = null; }
  }

  /** The island at dusk: a cicada shimmer under the game, and the odd bird call. */
  private ambience() {
    const c = this.ctx; if (!c || !this.effects || !this.noiseBuf) return;
    const src = c.createBufferSource(), band = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
    src.buffer = this.noiseBuf; src.loop = true; band.type = "bandpass"; band.frequency.value = 5200; band.Q.value = 3;
    g.gain.value = 0.018; lfo.frequency.value = 7; depth.gain.value = 0.014;
    lfo.connect(depth); depth.connect(g.gain); src.connect(band); band.connect(g); g.connect(this.effects);
    src.start(); lfo.start();
    const bird = () => {
      if (!this.ctx) return;
      const base = 1500 + Math.random() * 1400, n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.tone(base * (1 + i * 0.12), 0.11, "sine", 0.05, base * (1.35 + i * 0.1), i * 0.15);
      this.timers.push(setTimeout(bird, 3500 + Math.random() * 6500));
    };
    this.timers.push(setTimeout(bird, 2500));
    // a slow, tense 80s synth pulse underneath: a bass note on the beat, a quiet minor arpeggio between
    const arp = [57, 60, 64, 67, 64, 60, 62, 59], hz = (n: number) => 440 * 2 ** ((n - 69) / 12);
    let step = 0;
    const bus = this.music!;
    this.timers.push(setInterval(() => {
      if (!this.ctx || this.ctx.state !== "running" || !this.mix.music || this.mix.muted) return;
      const n = arp[step % arp.length]!;
      if (step % 4 === 0) this.tone(hz(n - 24), 0.9, "sawtooth", 0.05, hz(n - 24) * 0.98, 0, 220, bus);
      this.tone(hz(n), 0.32, "triangle", 0.03, hz(n), 0, 1800, bus);
      if (step % 16 === 8) this.tone(hz(n + 12), 1.6, "sine", 0.025, hz(n + 12) * 1.01, 0, 0, bus);
      step++;
    }, 300));
  }

  setMuted(m: boolean) { this.setMix({ ...this.mix, muted: m }); }
  /** Master mute, and the music and effects buses on their own. */
  setMix(m: Mix) {
    this.mix = { ...m };
    if (this.master) this.master.gain.value = m.muted ? 0 : 0.5;
    if (this.music) this.music.gain.value = m.music ? 1 : 0;
    if (this.effects) this.effects.gain.value = m.effects ? 1 : 0;
  }

  /** Stop the pulse and the birds and let the audio device go. */
  dispose() {
    for (const t of this.timers.splice(0)) { clearTimeout(t); clearInterval(t); }
    void this.ctx?.close().catch(() => {}); this.ctx = null; this.master = this.music = this.effects = null;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, to = freq, delay = 0, lp = 0, bus = this.effects) {
    const c = this.ctx; if (!c || !bus) return;
    const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let out: AudioNode = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; o.connect(f); out = f; }
    out.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, freq: number, q: number, vol: number, delay = 0, type: BiquadFilterType = "bandpass") {
    const c = this.ctx; if (!c || !this.effects || !this.noiseBuf) return;
    const t0 = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.effects); s.start(t0, Math.random()); s.stop(t0 + dur);
  }

  /** The chomp: a thump on the lunge, the clack of teeth when the jaws land. */
  chomp(seat: number) {
    const v = LOOKS[seat]!.voice;
    this.noise(0.1, 700, 1.2, 0.35);
    this.tone(v * 1.6, 0.16, "sine", 0.5, v * 0.7);
    const land = GULP_OUT / TICK_HZ;
    this.tone(320, 0.05, "square", 0.22, 160, land);
    this.noise(0.07, 2400, 2, 0.4, land);
  }

  /** The angry bellow, pitched per tycoon, with a second voice for a rough chord. */
  bellow(seat: number) {
    const v = LOOKS[seat]!.voice;
    this.tone(v * 1.4, 0.75, "sawtooth", 0.3, v * 0.85, 0, 700);
    this.tone(v * 2.1, 0.7, "square", 0.12, v * 1.25, 0.02, 600);
    this.tone(v * 0.7, 0.8, "triangle", 0.35, v * 0.5);
    this.noise(0.6, 260, 0.8, 0.25);
  }

  /** A grunt: shorter, lower, for snarls at someone else's gold. */
  grunt(seat: number) {
    const v = LOOKS[seat]!.voice;
    this.tone(v, 0.32, "sawtooth", 0.28, v * 0.6, 0, 500);
    this.noise(0.25, 200, 0.7, 0.2);
  }

  private coin(base: number, n: number, gap = 0.06) {
    for (let i = 0; i < n; i++) this.tone(base * 2 ** (i / 4), 0.22, "sine", 0.22, undefined, i * gap);
  }

  event(e: Event, mine: readonly number[]) {
    if (!this.ctx) return;
    const near = (seat: number) => mine.length === 0 || mine.includes(seat);
    switch (e.t) {
      case "gulp": this.chomp(e.seat); break;
      case "bellow": this.bellow(e.seat); break;
      case "eat":
        if (e.kind === GOLD) { this.coin(880, 5, 0.05); this.noise(0.4, 6000, 4, 0.12); for (let s = 0; s < 4; s++) if (s !== e.seat && near(s)) this.grunt(s); }
        else if (e.kind === SLUDGE) { this.noise(0.25, 420, 3, 0.45); this.tone(110, 0.22, "square", 0.2, 70); }
        else if (e.kind === NAIL) this.tone(430, 0.28, "sawtooth", 0.28, 150);
        else if (e.kind === WATER) { this.tone(700, 0.25, "sine", 0.35, 180); this.noise(0.2, 3000, 1, 0.15); }
        else this.coin(1250, 2, 0.07);
        break;
      case "dud": this.tone(500, 0.2, "sine", 0.25, 120); break;
      case "overflow": for (let i = 0; i < 4; i++) this.tone(i % 2 ? 520 : 780, 0.2, "square", 0.12, undefined, i * 0.22, 1800); break;
      case "slick": this.tone(300, 0.4, "sine", 0.2, 900); break;
      default: break;
    }
  }

  /** The wrestling finale's effects. */
  sfx(name: "bell" | "whoosh" | "slam" | "boing" | "splat" | "ding" | "crowd") {
    if (!this.ctx) return;
    switch (name) {
      case "bell": for (let i = 0; i < 3; i++) { this.tone(1320, 0.9, "sine", 0.22, 1300, i * 0.38); this.tone(1980, 0.6, "sine", 0.1, 1960, i * 0.38); } break;
      case "crowd": this.noise(2.4, 700, 0.6, 0.22); this.noise(1.6, 1500, 0.5, 0.12, 0.4); this.tone(180, 1.4, "sawtooth", 0.05, 260, 0.1, 600); break;
      case "whoosh": this.noise(0.55, 600, 0.9, 0.35); this.noise(0.4, 2400, 1.4, 0.18, 0.12); break;
      case "slam": this.tone(120, 0.35, "sine", 0.6, 38); this.noise(0.25, 300, 0.7, 0.45); break;
      case "boing": this.tone(180, 0.5, "sine", 0.35, 760); this.tone(760, 0.4, "sine", 0.25, 220, 0.18); break;
      case "splat": this.noise(0.35, 900, 0.8, 0.4, 0, "lowpass"); this.tone(320, 0.3, "sine", 0.3, 70); break;
      case "ding": [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.9, "sine", 0.18, f, i * 0.1)); break;
    }
  }

  beep(high: boolean) { this.tone(high ? 880 : 440, high ? 0.5 : 0.15, "sine", 0.3); }

  fanfare() {
    [392, 523, 659, 784].forEach((f, i) => { this.tone(f, 0.5, "sawtooth", 0.14, f, i * 0.14, 1400); this.tone(f / 2, 0.5, "triangle", 0.2, f / 2, i * 0.14); });
    this.tone(1046, 0.9, "sawtooth", 0.14, 1046, 0.6, 1600);
  }
}
