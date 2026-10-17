// Battle sound, all of it made on the spot with Web Audio: no files to fetch. Blaster bolts are a
// falling pitch, blasts are filtered noise over a thump, Marines grunt low through their masks and
// the Wooka chatter, squeak and squeal in a high gibberish. Each sound is placed: quieter with
// distance, panned to the side it came from. M mutes, and the choice is remembered.
export type Voice = "marines" | "wooka";
export interface Ear { x: number; z: number; rx: number; rz: number } // where you hear from, and which way is right
type At = { x: number; z: number };

const MUTE_KEY = "two-fronts:muted";
const MAX_VOICES = 28;   // sounds playing at once; past this, new ones are dropped
const QUIET = 0.02;      // anything this quiet after distance isn't worth playing

// `far` stretches how far sound carries, for a battle on a bigger field (orbit is miles wide).
export function makeSfx(far = 1) {
  let ctx: AudioContext | null = null, master: GainNode | null = null, noise: AudioBuffer | null = null;
  let voices = 0;
  let muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* private window: unmuted */ }
  let ear: Ear = { x: 0, z: 0, rx: 1, rz: 0 };

  // Browsers only let audio start from a click or key, so the first one opens it.
  const wake = () => {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const squash = ctx.createDynamicsCompressor();
      squash.threshold.value = -16; squash.ratio.value = 6;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(squash).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  };

  // A chain for one sound at a place: gain for distance, pan for side. `reach` is how far it carries.
  const place = (at: At | null, loud: number, reach: number): { out: GainNode; t: number } | null => {
    if (!ctx || !master || muted || voices >= MAX_VOICES) return null;
    let gain = loud, pan = 0;
    if (at) {
      const dx = at.x - ear.x, dz = at.z - ear.z, d = Math.hypot(dx, dz);
      gain *= 1 / (1 + (d * d) / (reach * reach * far * far));
      if (d > 1) pan = Math.max(-1, Math.min(1, (dx * ear.rx + dz * ear.rz) / d)) * 0.8;
    }
    if (gain < QUIET) return null;
    const out = ctx.createGain();
    out.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    out.connect(p).connect(master);
    return { out, t: ctx.currentTime };
  };
  // Free the voice when its last part ends.
  const hold = (node: AudioScheduledSourceNode) => { voices++; node.onended = () => voices--; };
  const env = (g: AudioParam, t: number, peak: number, attack: number, decay: number) => {
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const osc = (type: OscillatorType, out: AudioNode) => { const o = ctx!.createOscillator(); o.type = type; o.connect(out); return o; };
  const noiseSrc = (out: AudioNode) => { const n = ctx!.createBufferSource(); n.buffer = noise; n.loop = true; n.loopStart = Math.random(); n.connect(out); return n; };
  const filter = (type: BiquadFilterType, f: number, q = 1) => { const b = ctx!.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // A blaster bolt: a bright pitch falling fast, a second one a little off for body. `heavy` is a
  // vehicle cannon or turret: lower, longer, with a thud of noise under it.
  const laser = (at: At | null, heavy = false, loud = 0.35) => {
    const c = place(at, loud, heavy ? 45 : 28);
    if (!c) return;
    const { out, t } = c, len = heavy ? 0.32 : 0.16, top = (heavy ? 900 : 1900) * (0.9 + Math.random() * 0.2);
    const g = ctx!.createGain();
    env(g.gain, t, 1, 0.004, len);
    const lp = filter("lowpass", heavy ? 2400 : 5200);
    g.connect(lp).connect(out);
    for (const [type, k] of [["sawtooth", 1], ["square", 1.012]] as const) {
      const o = osc(type, g);
      o.frequency.setValueAtTime(top * k, t);
      o.frequency.exponentialRampToValueAtTime((heavy ? 60 : 160) * k, t + len);
      o.start(t); o.stop(t + len + 0.02);
      hold(o);
    }
    if (heavy) {
      const ng = ctx!.createGain();
      env(ng.gain, t, 0.6, 0.003, 0.18);
      ng.connect(filter("lowpass", 500)).connect(out);
      const n = noiseSrc(ng);
      n.start(t); n.stop(t + 0.25);
      hold(n);
    }
  };

  // A blast: noise through a closing low-pass, a thump that sinks, and for an orbital strike a
  // long rumble after. Carries a long way.
  const boom = (at: At, big = false) => {
    const c = place(at, big ? 1 : 0.6, big ? 140 : 60);
    if (!c) return;
    const { out, t } = c, len = big ? 2.6 : 0.9;
    const ng = ctx!.createGain();
    env(ng.gain, t, 1, 0.006, len);
    const lp = filter("lowpass", big ? 2600 : 3600, 0.7);
    lp.frequency.setValueAtTime(big ? 2600 : 3600, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + len);
    const crunch = ctx!.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 3); }
    crunch.curve = curve;
    ng.connect(crunch).connect(lp).connect(out);
    const n = noiseSrc(ng);
    n.start(t); n.stop(t + len + 0.05);
    hold(n);
    const tg = ctx!.createGain();
    env(tg.gain, t, big ? 1.4 : 0.9, 0.005, big ? 1.1 : 0.45);
    tg.connect(out);
    const thump = osc("sine", tg);
    thump.frequency.setValueAtTime(big ? 110 : 140, t);
    thump.frequency.exponentialRampToValueAtTime(big ? 28 : 40, t + (big ? 1 : 0.4));
    thump.start(t); thump.stop(t + (big ? 1.2 : 0.5));
    hold(thump);
  };

  // A voiced sound through two vowel formants that glide syllable by syllable: the base of both
  // the Wooka's chatter and the Marines' grunts.
  type Syllable = { f0: [number, number]; f1: [number, number]; f2: [number, number]; len: number; gap: number };
  const speak = (at: At | null, loud: number, syllables: Syllable[], mask: boolean) => {
    const c = place(at, loud, 26);
    if (!c) return;
    const { out, t } = c;
    const g = ctx!.createGain();
    g.gain.value = 0;
    const src = osc("sawtooth", g), f1 = filter("bandpass", 600, 6), f2 = filter("bandpass", 1200, 8), mix = ctx!.createGain();
    // A little wobble in the voice, so it sounds alive.
    const wobAmt = ctx!.createGain(), wob = osc("sine", wobAmt);
    wobAmt.gain.value = syllables[0]!.f0[0] * 0.03;
    wobAmt.connect(src.frequency);
    wob.frequency.value = 7 + Math.random() * 4;
    g.connect(f1).connect(mix); g.connect(f2).connect(mix);
    // A Marine talks through a full-face mask: boxed in and a little crushed.
    if (mask) { const m = filter("bandpass", 900, 1.4); mix.gain.value = 2.2; mix.connect(m).connect(out); } else { mix.gain.value = 2.6; mix.connect(out); }
    let s = t;
    for (const y of syllables) {
      src.frequency.setValueAtTime(y.f0[0], s); src.frequency.linearRampToValueAtTime(y.f0[1], s + y.len);
      f1.frequency.setValueAtTime(y.f1[0], s); f1.frequency.linearRampToValueAtTime(y.f1[1], s + y.len);
      f2.frequency.setValueAtTime(y.f2[0], s); f2.frequency.linearRampToValueAtTime(y.f2[1], s + y.len);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(1, s + 0.015);
      g.gain.setValueAtTime(1, s + y.len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, s + y.len);
      s += y.len + y.gap;
    }
    src.start(t); src.stop(s + 0.05); wob.start(t); wob.stop(s + 0.05);
    hold(src);
  };
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  // Vowels as formant pairs: oo, ah, ee, uh, eh.
  const VOWELS: [number, number][] = [[350, 800], [800, 1250], [300, 2300], [620, 1200], [530, 1850]];
  const vowel = () => VOWELS[Math.floor(Math.random() * VOWELS.length)]!;

  // The Wooka: a run of quick high syllables, each a different vowel, pitch hopping about.
  const chatter = (at: At | null, loud = 0.3) => {
    const n = 2 + Math.floor(Math.random() * 3), base = r(380, 560), out: Syllable[] = [];
    for (let i = 0; i < n; i++) {
      const a = vowel(), b = vowel(), p = base * r(0.85, 1.3);
      out.push({ f0: [p, p * r(0.8, 1.25)], f1: [a[0] * 1.3, b[0] * 1.3], f2: [a[1] * 1.3, b[1] * 1.3], len: r(0.07, 0.13), gap: r(0.02, 0.06) });
    }
    speak(at, loud, out, false);
  };
  // A Wooka hit or dying: one squeal that starts high on "ee" and falls away to "ah".
  const squeal = (at: At | null, loud = 0.45) => {
    const p = r(700, 950);
    speak(at, loud, [{ f0: [p, p * 0.45], f1: [380, 1000], f2: [2900, 1500], len: r(0.3, 0.45), gap: 0 }], false);
  };
  // A Wooka on the charge or thrown: a rising "yee-ha" sort of whoop.
  const whoop = (at: At | null, loud = 0.4) => {
    const p = r(450, 600);
    speak(at, loud, [{ f0: [p, p * 1.6], f1: [380, 900], f2: [2600, 1400], len: 0.18, gap: 0.03 }, { f0: [p * 1.6, p * 1.1], f1: [900, 700], f2: [1400, 1200], len: 0.22, gap: 0 }], false);
  };
  // A Marine: one low "uh" or "hngh", through the mask. Dying, it's longer and falls further.
  const grunt = (at: At | null, dying = false, loud = 0.5) => {
    const p = r(105, 140), [f1, f2] = dying ? [700, 1150] : [560, 1000];
    speak(at, loud, [{ f0: [p * 1.15, p * (dying ? 0.7 : 0.9)], f1: [f1, f1 * 0.85], f2: [f2, f2 * 0.9], len: dying ? r(0.35, 0.5) : r(0.14, 0.2), gap: 0 }], true);
  };
  const hurt = (who: Voice, at: At | null, dying = false, loud?: number) => (who === "wooka" ? squeal(at, loud) : grunt(at, dying, loud));

  // A thrown spear or a hex: a short swish of noise through a sweeping band.
  const swish = (at: At, loud = 0.25) => {
    const c = place(at, loud, 25);
    if (!c) return;
    const { out, t } = c, g = ctx!.createGain(), bp = filter("bandpass", 600, 3);
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.22);
    env(g.gain, t, 1, 0.05, 0.2);
    g.connect(bp).connect(out);
    const n = noiseSrc(g);
    n.start(t); n.stop(t + 0.3);
    hold(n);
  };
  // Flat tones for the HUD: a tick on a hit, a two-note chime for a new objective, a buzz when
  // you're leaving the area.
  const beep = (notes: number[], len: number, type: OscillatorType, loud: number) => {
    const c = place(null, loud, 1);
    if (!c) return;
    notes.forEach((f, i) => {
      const g = ctx!.createGain(), s = c.t + i * len;
      env(g.gain, s, 1, 0.005, len * 0.9);
      g.connect(c.out);
      const o = osc(type, g);
      o.frequency.value = f;
      o.start(s); o.stop(s + len);
      hold(o);
    });
  };
  const tick = () => beep([2400], 0.04, "square", 0.08);
  const chime = () => beep([660, 990], 0.14, "triangle", 0.3);
  const warn = () => beep([220, 220], 0.12, "square", 0.12);
  // A war drum: a hide skin hit hard, a low thump that falls, twice.
  const drum = () => {
    const c = place(null, 0.7, 1);
    if (!c) return;
    for (const [i, f] of [[0, 90], [0.22, 70]] as const) {
      const g = ctx!.createGain(), s = c.t + i;
      env(g.gain, s, 1, 0.004, 0.35);
      g.connect(c.out);
      const o = osc("sine", g);
      o.frequency.setValueAtTime(f, s); o.frequency.exponentialRampToValueAtTime(f * 0.5, s + 0.3);
      o.start(s); o.stop(s + 0.4);
      hold(o);
    }
  };
  // The blaster venting: a hiss of steam that dies away.
  const vent = () => {
    const c = place(null, 0.22, 1);
    if (!c) return;
    const g = ctx!.createGain(), hp = filter("highpass", 2600, 0.8);
    env(g.gain, c.t, 1, 0.02, 1.1);
    g.connect(hp).connect(c.out);
    const n = noiseSrc(g);
    n.start(c.t); n.stop(c.t + 1.2);
    hold(n);
  };

  const setMuted = (m: boolean) => {
    muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* not remembered, that's all */ }
    if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.7, ctx.currentTime, 0.05);
  };

  return {
    wake, laser, boom, chatter, squeal, whoop, grunt, hurt, swish, tick, chime, warn, drum, vent,
    hear: (e: Ear) => { ear = e; },
    get muted() { return muted; },
    toggle: () => setMuted(!muted),
    close: () => { void ctx?.close(); ctx = null; },
  };
}
export type Sfx = ReturnType<typeof makeSfx>;
