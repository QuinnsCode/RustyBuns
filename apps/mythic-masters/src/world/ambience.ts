// The sound of the wilds: wind in the trees that rises and falls with src/world/nature.ts's `wind`, rain when it
// rains, birdsong by day from the flocks near you, a clatter of wings when one flushes, and crickets at night.
// Plain Web Audio, made on first use (after a key or a tap, so the browser lets it play), silent where there is no
// AudioContext, and at the "The wilds" volume in Settings > Audio.
export interface Ambient { wind: number; rain: number; night: number; birds: number; flush: boolean; water: number }

export function ambience(loudness: () => number) {
  let ctx: AudioContext | null = null, out: GainNode | null = null, windG: GainNode | null = null, rainG: GainNode | null = null, cricketG: GainNode | null = null, waterG: GainNode | null = null, windF: BiquadFilterNode | null = null;
  let nextChirp = 0;

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

  return {
    /** Each frame: `a` is what is round you now; `dt` seconds. */
    update(a: Ambient, dt: number) {
      const vol = loudness();
      if (!ctx && vol <= 0) return;
      const c = wake();
      if (!c || !out || !windG || !rainG || !cricketG || !waterG || !windF) return;
      if (vol > 0 && c.state === "suspended") void c.resume();
      const t = c.currentTime, k = 0.25;
      out.gain.setTargetAtTime(vol * 0.6, t, 0.2);
      windG.gain.setTargetAtTime(0.03 + 0.35 * a.wind, t, k);
      windF.frequency.setTargetAtTime(300 + 500 * a.wind, t, k);
      rainG.gain.setTargetAtTime(0.25 * a.rain, t, k);
      cricketG.gain.setTargetAtTime(0.06 * a.night * (1 - a.rain), t, k);
      waterG.gain.setTargetAtTime(0.18 * a.water, t, k);
      if (vol <= 0) return;
      nextChirp -= dt;
      if (a.birds > 0 && (1 - a.night) > 0.3 && nextChirp <= 0) { chirp(c, vol); nextChirp = 1.5 + Math.random() * 6 / Math.min(3, a.birds); }
      if (a.flush) flap(c, vol);
    },
  };
}
