// The sound of the book writing itself: a pen scratch for every line that soaks in (src/page.ts soak), short bursts
// of filtered noise a beat apart, quieter as the page goes on so a long page is a murmur, not a drum roll. Plain Web
// Audio, made on first use (after a key or a tap, so the browser lets it play), silent where there is no
// AudioContext, and at the "The quill" volume in Settings > Audio. No DOM: page.ts says when, this says how it sounds.
export function quill(loudness: () => number) {
  let ctx: AudioContext | null = null, out: GainNode | null = null, noise: AudioBuffer | null = null;
  function wake(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    out = new GainNode(ctx, { gain: 0.5 });
    out.connect(ctx.destination);
    const len = ctx.sampleRate, d = (noise = ctx.createBuffer(1, len, ctx.sampleRate)).getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }
  /** One stroke of the pen: a short grainy burst through a bandpass, its pitch wandering a little. */
  function stroke(c: AudioContext, at: number, vol: number, seed: number) {
    const dur = 0.07 + (seed % 7) * 0.012, f = 2600 + (seed % 11) * 160;
    const src = new AudioBufferSourceNode(c, { buffer: noise!, playbackRate: 0.8 + (seed % 5) * 0.1 }), bp = new BiquadFilterNode(c, { type: "bandpass", frequency: f, Q: 2.2 }), g = new GainNode(c, { gain: 0 });
    bp.frequency.linearRampToValueAtTime(f * 0.75, at + dur);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(bp).connect(g).connect(out!);
    src.start(at, (seed % 13) * 0.05, dur + 0.02);
  }
  return {
    /** `n` lines about to soak in, `stepMs` apart: a scratch for each, the first loudest. At most forty are heard. */
    write(n: number, stepMs: number) {
      const vol = loudness();
      if (vol <= 0 || n <= 0) return;
      const c = wake();
      if (!c || !out) return;
      if (c.state === "suspended") void c.resume();
      const t = c.currentTime + 0.02, heard = Math.min(n, 40);
      for (let i = 0; i < heard; i++) stroke(c, t + (i * stepMs) / 1000, vol * 0.16 * (i ? 0.55 : 1) / (1 + i * 0.03), i * 7 + n);
    },
  };
}
