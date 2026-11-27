// The rig's crossover, heard (#6473): the set split into the amp channels' bands as their DSP has them
// (@rustybuns/gear crossover.ts), each band's filters, gain, delay and polarity, and summed back before the speakers.
// Set right, the bands sum flat and you hear the set; set wrong, the split shows: a hole where a late or flipped sub
// cancels the tops, a gap between two bands that don't meet, a bump where they overlap. Web Audio's own filters run
// it on the audio thread, per sample; nothing here runs per frame. A Linkwitz-Riley edge is two Butterworth stages:
// LR4 two second-order biquads at Q 0.707, LR8 two fourth-order pairs, LR2 two first-order (one-pole) stages.
import type { ChannelDsp, Edge } from "@rustybuns/gear/crossover";

/** Butterworth's Qs for order n's second-order stages (n even): 2nd 0.707; 4th 0.541, 1.307. */
const BUTTER_Q: Record<number, number[]> = { 2: [Math.SQRT1_2], 4: [0.5412, 1.3066] };

function stages(ctx: BaseAudioContext, e: Edge, type: "highpass" | "lowpass"): AudioNode[] {
  const n = e.slope / 6, half = e.type === "lr" ? n / 2 : n, reps = e.type === "lr" ? 2 : 1;
  const one = (): AudioNode[] => half === 1
    ? [new IIRFilterNode(ctx, onePole(ctx.sampleRate, e.hz, type))]
    : (BUTTER_Q[half] ?? BUTTER_Q[2]!).map((Q) => new BiquadFilterNode(ctx, { type, frequency: e.hz, Q }));
  return Array.from({ length: reps }, one).flat();
}
/** A first-order high- or low-pass by the bilinear transform, as IIRFilterNode takes it. */
function onePole(rate: number, hz: number, type: "highpass" | "lowpass"): IIRFilterOptions {
  const k = Math.tan((Math.PI * hz) / rate), a0 = 1 + k;
  const fb = [1, (k - 1) / a0];
  return type === "lowpass" ? { feedforward: [k / a0, k / a0], feedback: fb } : { feedforward: [1 / a0, -1 / a0], feedback: fb };
}

export interface Crossover {
  readonly input: GainNode;
  readonly output: GainNode;
  /** Play these bands (gear's `heardBands`): the old graph fades out as the new one fades in. */
  set(bands: readonly ChannelDsp[]): void;
}

/** The set split into `bands` and summed (none: straight through). */
export function crossover(ctx: BaseAudioContext, bands: readonly ChannelDsp[]): Crossover {
  const input = new GainNode(ctx), output = new GainNode(ctx);
  let live: { fade: GainNode; nodes: AudioNode[] } | null = null;
  const build = (bs: readonly ChannelDsp[]) => {
    const fade = new GainNode(ctx, { gain: 0 }), nodes: AudioNode[] = [fade];
    fade.connect(output);
    if (!bs.length) { const dry = new GainNode(ctx); input.connect(dry).connect(fade); nodes.push(dry); return { fade, nodes }; }
    for (const d of bs) {
      const chain: AudioNode[] = [
        ...(d.hp ? stages(ctx, d.hp, "highpass") : []),
        ...(d.lp ? stages(ctx, d.lp, "lowpass") : []),
        new GainNode(ctx, { gain: Math.pow(10, d.gainDb / 20) * d.polarity }),
        new DelayNode(ctx, { maxDelayTime: 0.06, delayTime: Math.max(0, d.delayMs) / 1000 }),
      ];
      chain.reduce((acc, n) => (acc.connect(n), n), input as AudioNode).connect(fade);
      nodes.push(...chain);
    }
    return { fade, nodes };
  };
  const set = (cs: readonly ChannelDsp[]) => {
    const t = ctx.currentTime, old = live;
    live = build(cs);
    live.fade.gain.setValueAtTime(0, t);
    live.fade.gain.linearRampToValueAtTime(1, t + 0.05);
    if (old) {
      old.fade.gain.setValueAtTime(1, t);
      old.fade.gain.linearRampToValueAtTime(0, t + 0.05);
      setTimeout(() => { for (const n of old.nodes) { try { input.disconnect(n); } catch { /* not fed from the input */ } n.disconnect(); } }, 200);
    }
  };
  set(bands);
  return { input, output, set };
}
