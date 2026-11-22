// The sound of the wilds: wind in the trees that rises and falls with src/world/nature.ts's `wind`, rain when it
// rains, birdsong by day from the flocks near you, a clatter of wings when one flushes, crickets at night, and a shriek
// out in the dark when something takes Gary on your first night (his lantern's glass going with it). After dark with no
// fire near, your heartbeat (faster as something stalks you), and when one of the six night ones comes close the
// crickets fall silent and a low rumble rises (night.ts darkSounds, #4388).
// Plain Web Audio, made on first use (after a key or a tap, so the browser lets it play), silent where there is no
// AudioContext, and at the "The wilds" volume in Settings > Audio.
export interface Ambient { wind: number; rain: number; night: number; birds: number; flush: boolean; water: number;
  /** How many shrieks there have been: each new one plays once. */
  shrieks: number;
  /** Your heartbeat, 0 (none) to 1 (pounding), and how close the nearest night one is: night.ts darkSounds. */
  heart: number; near: number;
  /** In the Pine Barrens (0 or 1), and the hour: its whip-poor-wills call at dusk and before dawn, its tree frogs quonk after dark, and thunder rolls in its storms. */
  pines?: number; hour?: number }

export function ambience(loudness: () => number) {
  let ctx: AudioContext | null = null, out: GainNode | null = null, windG: GainNode | null = null, rainG: GainNode | null = null, cricketG: GainNode | null = null, waterG: GainNode | null = null, rumbleG: GainNode | null = null, windF: BiquadFilterNode | null = null;
  let nextChirp = 0, nextBeat = 0, nextWhip = 4, nextFrog = 2, nextThunder = 6, heard: number | null = null;

  /** A loop of noise through a filter into a gain at 0. */
  function bed(c: AudioContext, into: GainNode, type: BiquadFilterType, freq: number, q: number, brown: boolean) {
    const len = c.sampleRate * 3, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; if (brown) { v = (v + 0.02 * r) / 1.02; d[i] = v * 3.5; } else d[i] = r; }
    const src = new AudioBufferSourceNode(c, { buffer: buf, loop: true }), f = new BiquadFilterNode(c, { type, frequency: freq, Q: q }), g = new GainNode(c, { gain: 0 });
    src.connect(f).connect(g).connect(into);
    src.start();
    return { g, f };
  }
  function wake(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    out = new GainNode(ctx, { gain: 0.6 });
    out.connect(ctx.destination);
    const w = bed(ctx, out, "bandpass", 380, 0.6, true); windG = w.g; windF = w.f;
    rainG = bed(ctx, out, "highpass", 1800, 0.5, false).g;
    cricketG = bed(ctx, out, "bandpass", 4200, 12, false).g;
    waterG = bed(ctx, out, "bandpass", 900, 0.8, false).g;
    rumbleG = bed(ctx, out, "lowpass", 110, 0.7, true).g;
    return ctx;
  }
  /** A bird: two or three short swept notes. */
  function chirp(c: AudioContext, vol: number) {
    const t = c.currentTime, base = 1800 + Math.random() * 1600, notes = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < notes; i++) {
      const o = new OscillatorNode(c, { type: "sine", frequency: base * (1 + 0.15 * Math.sin(i * 2.3)) }), g = new GainNode(c, { gain: 0 }), at = t + i * 0.14;
      o.frequency.exponentialRampToValueAtTime(base * 1.4, at + 0.06); o.frequency.exponentialRampToValueAtTime(base * 0.9, at + 0.11);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol * 0.05, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
      o.connect(g).connect(out!); o.start(at); o.stop(at + 0.14);
    }
  }
  /** Wings: a burst of flapping noise. */
  function flap(c: AudioContext, vol: number) {
    const t = c.currentTime, len = Math.floor(c.sampleRate * 0.9), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const u = i / len, beat = 0.5 + 0.5 * Math.sin(u * 9 * Math.PI * 2); d[i] = (Math.random() * 2 - 1) * beat * (1 - u) ** 1.5; }
    const src = new AudioBufferSourceNode(c, { buffer: buf }), g = new GainNode(c, { gain: vol * 0.35 });
    src.connect(new BiquadFilterNode(c, { type: "bandpass", frequency: 700, Q: 1.2 })).connect(g).connect(out!);
    src.start(t);
  }

  /** A whip-poor-will: its name, three whistled notes, the last the strongest and rising, then falling. */
  function whip(c: AudioContext, vol: number) {
    const t = c.currentTime, k = 0.9 + Math.random() * 0.2;
    for (const [at, f0, f1, f2, len, g0] of [[0, 1300, 1700, 1600, 0.09, 0.6], [0.13, 1250, 1100, 1150, 0.12, 0.5], [0.3, 1350, 2300, 1700, 0.24, 1]] as const) {
      const o = new OscillatorNode(c, { type: "sine", frequency: f0 * k }), g = new GainNode(c, { gain: 0 }), s = t + at;
      o.frequency.setValueAtTime(f0 * k, s); o.frequency.linearRampToValueAtTime(f1 * k, s + len * 0.6); o.frequency.linearRampToValueAtTime(f2 * k, s + len);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol * 0.045 * g0, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + len + 0.03);
      o.connect(g).connect(out!); o.start(s); o.stop(s + len + 0.05);
    }
  }
  /** The Pine Barrens tree frog: a nasal, honking quonk, two to five in a run. */
  function frog(c: AudioContext, vol: number) {
    const t = c.currentTime, n = 2 + Math.floor(Math.random() * 4), f = 520 + Math.random() * 140;
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.32 + Math.random() * 0.08), o = new OscillatorNode(c, { type: "sawtooth", frequency: f }), nose = new BiquadFilterNode(c, { type: "bandpass", frequency: 1400, Q: 4 }), g = new GainNode(c, { gain: 0 });
      o.frequency.setValueAtTime(f, s); o.frequency.linearRampToValueAtTime(f * 0.92, s + 0.12);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol * 0.05, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.13);
      o.connect(nose).connect(g).connect(out!); o.start(s); o.stop(s + 0.15);
    }
  }
  /** Thunder: a crack, then a long low roll. */
  function thunder(c: AudioContext, vol: number, near: number) {
    const t = c.currentTime + (1 - near) * 2.5, len = Math.floor(c.sampleRate * 5), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { const u = i / len, r = Math.random() * 2 - 1; v = (v + 0.03 * r) / 1.03; d[i] = v * 6 * (u < 0.02 ? u / 0.02 : (1 - u) ** 1.6) * (0.7 + 0.3 * Math.sin(u * 23)); }
    const src = new AudioBufferSourceNode(c, { buffer: buf }), g = new GainNode(c, { gain: vol * (0.25 + 0.35 * near) });
    src.connect(new BiquadFilterNode(c, { type: "lowpass", frequency: 180 + 500 * near })).connect(g).connect(out!);
    src.start(t);
  }

  /** One heartbeat: lub-dub, two low thumps. */
  function beat(c: AudioContext, vol: number) {
    const t = c.currentTime;
    for (const [at, k] of [[0, 1], [0.18, 0.7]] as const) {
      const o = new OscillatorNode(c, { type: "sine", frequency: 62 }), g = new GainNode(c, { gain: 0 }), s = t + at;
      o.frequency.exponentialRampToValueAtTime(38, s + 0.12);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(vol * k, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(out!); o.start(s); o.stop(s + 0.18);
    }
  }

  /** Something out in the dark: a cry that rises, cracks and falls away, far off; then the lantern's glass and its flame. */
  function shriek(c: AudioContext, vol: number) {
    const t = c.currentTime, o = new OscillatorNode(c, { type: "sawtooth", frequency: 700 }), wob = new OscillatorNode(c, { frequency: 23 }),
      depth = new GainNode(c, { gain: 60 }), f = new BiquadFilterNode(c, { type: "bandpass", frequency: 1600, Q: 2.5 }), g = new GainNode(c, { gain: 0 });
    wob.connect(depth).connect(o.frequency);
    o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(1900, t + 0.35); o.frequency.exponentialRampToValueAtTime(420, t + 1.6);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.12, t + 0.12); g.gain.setTargetAtTime(vol * 0.07, t + 0.4, 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(f).connect(g).connect(out!);
    o.start(t); wob.start(t); o.stop(t + 1.9); wob.stop(t + 1.9);
    // the glass: a short bright tink, then the flame fizzing out
    const at = t + 1.1, len = Math.floor(c.sampleRate * 0.6), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) { const u = i / len; d[i] = (Math.random() * 2 - 1) * (u < 0.03 ? 1 : 0.3 * (1 - u) ** 2); }
    const fz = new AudioBufferSourceNode(c, { buffer: buf }), fg = new GainNode(c, { gain: vol * 0.08 });
    fz.connect(new BiquadFilterNode(c, { type: "highpass", frequency: 3000 })).connect(fg).connect(out!);
    fz.start(at);
  }

  return {
    /** Each frame: `a` is what is round you now; `dt` seconds. */
    update(a: Ambient, dt: number) {
      const vol = loudness(), cried = heard !== null && a.shrieks > heard;
      heard = a.shrieks;
      if (!ctx && vol <= 0) return;
      const c = wake();
      if (!c || !out || !windG || !rainG || !cricketG || !waterG || !rumbleG || !windF) return;
      if (vol > 0 && c.state === "suspended") void c.resume();
      const t = c.currentTime, k = 0.25;
      out.gain.setTargetAtTime(vol * 0.6, t, 0.2);
      windG.gain.setTargetAtTime(0.03 + 0.35 * a.wind, t, k);
      windF.frequency.setTargetAtTime(300 + 500 * a.wind, t, k);
      rainG.gain.setTargetAtTime(0.25 * a.rain, t, k);
      cricketG.gain.setTargetAtTime(0.06 * a.night * (1 - a.rain) * (1 - a.near), t, k);
      rumbleG.gain.setTargetAtTime(0.5 * a.near, t, k);
      waterG.gain.setTargetAtTime(0.18 * a.water, t, k);
      if (vol <= 0) return;
      nextChirp -= dt;
      if (a.birds > 0 && (1 - a.night) > 0.3 && nextChirp <= 0) { chirp(c, vol); nextChirp = 1.5 + Math.random() * 6 / Math.min(3, a.birds); }
      if (a.flush) flap(c, vol);
      nextBeat -= dt;
      if (a.heart > 0 && nextBeat <= 0) { beat(c, vol * (0.15 + 0.35 * a.heart)); nextBeat = 60 / (60 + 80 * a.heart); }
      if (cried) shriek(c, vol);
      // the Pine Barrens: whip-poor-wills from dusk into the dark and again before dawn, tree frogs after dark, thunder in a storm
      const pb = a.pines ?? 0, h = a.hour ?? 12, dusk = (h >= 19 && h < 23) || (h >= 3.5 && h < 5.5);
      nextWhip -= dt; nextFrog -= dt; nextThunder -= dt;
      if (pb > 0 && dusk && a.rain < 0.5 && nextWhip <= 0) { whip(c, vol); nextWhip = 0.9 + Math.random() * 0.5 + (Math.random() < 0.15 ? 6 + Math.random() * 8 : 0); }
      if (pb > 0 && a.night > 0.3 && a.near < 0.5 && nextFrog <= 0) { frog(c, vol * (0.5 + a.water)); nextFrog = 2.5 + Math.random() * 6; }
      if (pb > 0 && a.rain > 0.55 && nextThunder <= 0) { thunder(c, vol, Math.random()); nextThunder = 9 + Math.random() * 20; }
    },
  };
}
