// Sounds, all synthesized: footsteps, rustling bushes, and the ranger's call
// (a radio squelch, then the browser's speech synthesis, quieter the farther
// away it is). Score is the music: a low dread bed that tightens as rangers close in.

let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

function noise(seconds: number, volume: number, pan: number, filter: number, q = 0.7) {
  const a = ac();
  if (a.state === "suspended") void a.resume();
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = filter; f.Q.value = q;
  const g = a.createGain();
  g.gain.value = volume;
  const p = a.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(f).connect(g).connect(p).connect(a.destination);
  src.start();
}

/** Volume and pan for a sound at (dx, dy) metres from a listener facing yaw. */
export function place(dx: number, dy: number, yaw: number, reach: number): { vol: number; pan: number } {
  const d = Math.hypot(dx, dy);
  const ang = Math.atan2(dx, dy) - yaw;
  return { vol: Math.max(0, 1 - d / reach), pan: Math.sin(ang) };
}

export const sounds = {
  rustle(vol: number, pan: number) { if (vol > 0.02) { noise(0.35, vol * 0.5, pan, 3200, 0.5); setTimeout(() => noise(0.25, vol * 0.35, pan, 2400, 0.6), 120); } },
  step(vol: number, pan: number) { if (vol > 0.02) noise(0.08, vol * 0.6, pan, 500, 1.2); },
  caught() { const a = ac(), o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(660, a.currentTime); o.frequency.exponentialRampToValueAtTime(220, a.currentTime + 0.4); g.gain.setValueAtTime(0.15, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5); o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.5); },
  call(vol: number, line: string) {
    if (vol <= 0.03) return;
    squelch(vol);
    if (!("speechSynthesis" in window)) return;
    // Slow and low: a voice in the dark trees, not a friendly hello.
    const u = new SpeechSynthesisUtterance(line);
    u.volume = Math.min(1, vol); u.rate = 0.88; u.pitch = 0.55;
    setTimeout(() => speechSynthesis.speak(u), 180);
  },
  /** Bigfoot: a long, low whoop that rises and falls. */
  howl(vol: number, pan: number) {
    if (vol <= 0.02) return;
    const a = ac(), t = a.currentTime;
    if (a.state === "suspended") void a.resume();
    const o = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain(), p = a.createStereoPanner();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(330, t + 0.5);
    o.frequency.setValueAtTime(330, t + 0.9);
    o.frequency.exponentialRampToValueAtTime(140, t + 1.8);
    f.type = "lowpass"; f.frequency.value = 900;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.25);
    g.gain.setValueAtTime(0.25 * vol, t + 1.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.9);
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(f).connect(g).connect(p).connect(a.destination);
    o.start(t); o.stop(t + 2);
  },
  unlock() { const a = ac(); if (a.state === "suspended") void a.resume(); },
};

/** A radio keying up: a click, a burst of static, a short tone. */
function squelch(vol: number) {
  const a = ac(), t = a.currentTime;
  noise(0.16, vol * 0.25, 0, 1800, 0.4);
  const o = a.createOscillator(), g = a.createGain();
  o.type = "square"; o.frequency.value = 1150;
  g.gain.setValueAtTime(0.0001, t + 0.12);
  g.gain.exponentialRampToValueAtTime(0.03 * vol, t + 0.13);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(g).connect(a.destination);
  o.start(t + 0.12); o.stop(t + 0.22);
}

/** What the music reacts to, every frame. threat runs 0..1: how close a ranger is to finding you. */
export interface Mood { on: boolean; threat: number; night: boolean; heart: boolean }

/**
 * The score. A detuned drone that never resolves, forest air (crickets after
 * dark), a high string cluster that swells with the threat, and a heartbeat
 * that quickens as a ranger closes in. stinger() is the jolt when one gets
 * close; boom() is being caught. Everything rides one bus, so mute is one gain.
 */
export class Score {
  private bus: GainNode | null = null;
  private drone: GainNode | null = null;
  private air: GainNode | null = null;
  private strings: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private nextBeat = 0;
  private nextChirp = 0;
  private lastSting = 0;
  private threat = 0;
  muted = false;

  private build() {
    const a = ac();
    this.bus = a.createGain();
    this.bus.gain.value = this.muted ? 0 : 0.8;
    this.bus.connect(a.destination);
    // Drone: a root and a flat fifth under a slowly breathing lowpass.
    this.filter = a.createBiquadFilter();
    this.filter.type = "lowpass"; this.filter.frequency.value = 260; this.filter.Q.value = 4;
    const lfo = a.createOscillator(), depth = a.createGain();
    lfo.frequency.value = 0.06; depth.gain.value = 120;
    lfo.connect(depth).connect(this.filter.frequency);
    lfo.start();
    this.drone = a.createGain();
    this.drone.gain.value = 0;
    for (const [f, d] of [[55, -6], [55, 7], [77.8, 0], [110, 3]] as const) {
      const o = a.createOscillator();
      o.type = "sawtooth"; o.frequency.value = f; o.detune.value = d;
      o.connect(this.filter);
      o.start();
    }
    this.filter.connect(this.drone).connect(this.bus);
    // Air: wind through the pines, a loop of soft noise.
    const len = a.sampleRate * 4, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.98 + (Math.random() * 2 - 1) * 0.02; d[i] = last * 6; }
    const src = a.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 500; bp.Q.value = 0.4;
    this.air = a.createGain();
    this.air.gain.value = 0;
    src.connect(bp).connect(this.air).connect(this.bus);
    src.start();
    // Strings: a minor second and a tritone up high, trembling.
    this.strings = a.createGain();
    this.strings.gain.value = 0;
    const trem = a.createOscillator(), tg = a.createGain();
    trem.frequency.value = 5.5; tg.gain.value = 0.3;
    const sg = a.createGain();
    sg.gain.value = 0.7;
    trem.connect(tg).connect(sg.gain);
    trem.start();
    for (const f of [622, 659, 932]) {
      const o = a.createOscillator();
      o.type = "triangle"; o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 14;
      o.connect(sg);
      o.start();
    }
    sg.connect(this.strings).connect(this.bus);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.bus) this.bus.gain.setTargetAtTime(m ? 0 : 0.8, ac().currentTime, 0.2);
  }

  update(m: Mood) {
    if (!m.on && !this.bus) return;
    if (!this.bus) this.build();
    const a = ac(), t = a.currentTime;
    if (a.state === "suspended") return;
    const k = m.on ? Math.max(0, Math.min(1, m.threat)) : 0;
    // Spikes come on fast and drain away slowly, so a close call lingers.
    this.threat += (k - this.threat) * (k > this.threat ? 0.2 : 0.01);
    const th = this.threat;
    this.drone!.gain.setTargetAtTime(m.on ? 0.05 + 0.07 * th : 0, t, 0.8);
    this.filter!.frequency.setTargetAtTime(220 + 500 * th, t, 0.5);
    this.air!.gain.setTargetAtTime(m.on ? 0.05 : 0, t, 1.5);
    this.strings!.gain.setTargetAtTime(m.on ? 0.035 * th * th : 0, t, 0.6);
    if (!m.on || this.muted) return;
    if (m.heart && th > 0.15 && t >= this.nextBeat) {
      this.beat(t, 0.25 + 0.5 * th);
      this.nextBeat = t + 60 / (52 + 80 * th);
    }
    if (m.night && t >= this.nextChirp) {
      this.chirp(t);
      // Crickets hush when someone's close.
      this.nextChirp = t + (0.6 + Math.random() * 1.6) * (1 + th * 6);
    }
  }

  /** A lub-dub: two low thumps. */
  private beat(t: number, vol: number) {
    const a = ac();
    for (const [at, v] of [[0, 1], [0.16, 0.6]] as const) {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.setValueAtTime(70, t + at);
      o.frequency.exponentialRampToValueAtTime(38, t + at + 0.12);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(vol * v, t + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.18);
      o.connect(g).connect(this.bus!);
      o.start(t + at); o.stop(t + at + 0.2);
    }
  }

  private chirp(t: number) {
    const a = ac(), p = a.createStereoPanner(), f = 4000 + Math.random() * 900;
    p.pan.value = Math.random() * 2 - 1;
    p.connect(this.bus!);
    for (let i = 0; i < 3; i++) {
      const o = a.createOscillator(), g = a.createGain(), at = t + i * 0.05;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.012, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
      o.connect(g).connect(p);
      o.start(at); o.stop(at + 0.04);
    }
  }

  /** The jolt when a ranger gets close: a scrape of noise and a swelling dissonant cluster. */
  stinger() {
    if (!this.bus || this.muted) return;
    const a = ac(), t = a.currentTime;
    if (t - this.lastSting < 8) return;
    this.lastSting = t;
    noise(0.6, 0.18, 0, 2600, 0.3);
    const g = a.createGain(), lp = a.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(3000, t + 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    for (const f of [146.8, 155.6, 207.7, 311]) {
      const o = a.createOscillator();
      o.type = "sawtooth"; o.frequency.value = f;
      o.connect(lp);
      o.start(t); o.stop(t + 2.5);
    }
    lp.connect(g).connect(this.bus);
  }

  /** Caught: one deep hit that rings out. */
  boom() {
    if (!this.bus || this.muted) return;
    const a = ac(), t = a.currentTime, o = a.createOscillator(), g = a.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 2.6);
    noise(0.9, 0.2, 0, 180, 0.6);
  }
}

export const CALLS = ["Anybody out there?", "Park ranger! Come on out!", "I know you're out here!", "Hello? Campers?", "Campsite's closed, folks!", "I can hear you breathing.", "Lights out was an hour ago.", "Nobody stays out past dark."];
