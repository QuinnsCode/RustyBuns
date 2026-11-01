// The sound of not knowing what that is yet: a drowned-out rumble while the director's stage is muffled, a thunk
// for each stamp a case file lands, and a rising blip as an anomaly scan starts. Plain Web Audio, made on first use
// (after a key or a tap, so the browser lets it play), and silent where there is no AudioContext.
import type { Stage } from "./director.ts";

export function drowner(loudness: () => number) {
  let ctx: AudioContext | null = null, bed: GainNode | null = null, out: GainNode | null = null, wobble: OscillatorNode | null = null;
  let stamps = 0, scanning = false;

  function wake(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof AudioContext === "undefined") return null;
    ctx = new AudioContext();
    out = new GainNode(ctx, { gain: 0.5 });
    out.connect(ctx.destination);
    // Brown noise, low-passed hard: something big on the far side of a wall.
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let v = 0;
    for (let i = 0; i < len; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; }
    const noise = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    const low = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 240, Q: 7 });
    // Under it a growl that never resolves into a voice.
    const growl = new OscillatorNode(ctx, { type: "sawtooth", frequency: 46 });
    const growlLow = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 160 });
    const growlGain = new GainNode(ctx, { gain: 0.18 });
    wobble = new OscillatorNode(ctx, { frequency: 0.7 });
    const depth = new GainNode(ctx, { gain: 90 });
    wobble.connect(depth).connect(low.frequency);
    bed = new GainNode(ctx, { gain: 0 });
    noise.connect(low).connect(bed);
    growl.connect(growlLow).connect(growlGain).connect(bed);
    bed.connect(out);
    noise.start(); growl.start(); wobble.start();
    return ctx;
  }

  /** A short sound: a filtered noise burst (a stamp) or a swept tone (the scan). */
  function blip(kind: "stamp" | "scan", vol: number) {
    const c = wake();
    if (!c || !out) return;
    const t = c.currentTime, g = new GainNode(c, { gain: 0 });
    g.connect(out);
    if (kind === "stamp") {
      const len = Math.floor(c.sampleRate * 0.12), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
      const src = new AudioBufferSourceNode(c, { buffer: buf });
      src.connect(new BiquadFilterNode(c, { type: "lowpass", frequency: 520 })).connect(g);
      g.gain.setValueAtTime(vol * 1.6, t);
      src.start(t);
    } else {
      const o = new OscillatorNode(c, { type: "square", frequency: 440 });
      o.frequency.exponentialRampToValueAtTime(1320, t + 0.25);
      g.gain.setValueAtTime(vol * 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); o.start(t); o.stop(t + 0.32);
    }
  }

  return {
    /** Each frame: follow the stage. */
    update(st: Stage) {
      const vol = loudness(), landed = st.file?.stamps.length ?? 0, sweep = (st.file?.scan ?? -1) >= 0;
      if (vol > 0 && landed > stamps) blip("stamp", vol);
      if (vol > 0 && sweep && !scanning) blip("scan", vol);
      stamps = landed; scanning = sweep;
      const want = vol * st.muffle;
      if (!ctx && want <= 0) return;
      const c = wake();
      if (!c || !bed) return;
      if (want > 0 && c.state === "suspended") void c.resume();
      bed.gain.setTargetAtTime(want * 0.9, c.currentTime, 0.12);
    },
  };
}
