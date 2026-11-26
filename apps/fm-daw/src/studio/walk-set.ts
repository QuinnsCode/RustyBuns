// The client walk-through's test set (#6020, /jam.html?walk=1): two bars of kick, bass, hats and a chord that sit
// differently left and right, looped through the planned PA (pa-room.ts PaRoom) on this page alone, so a client walks the
// room or the field and hears where the stacks reach, where they fall off and where the far ones land late, before the
// show. Nobody else in the sesh hears it, and it needs no one on the decks.
import { mulberry32 } from "@rustybuns/util";

const BPM = 124, BARS = 2;

/** The loop's two channels at `rate`: the kick and bass in both, the hats and the chord's notes split left and right. */
export function walkSet(rate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const beat = 60 / BPM, n = Math.round(beat * 4 * BARS * rate), l = new Float32Array(n), r = new Float32Array(n), rand = mulberry32(6020);
  for (let i = 0; i < n; i++) {
    const t = i / rate, b = t / beat, inBeat = (b % 1) * beat, off = ((b + 0.5) % 1) * beat;
    // the kick: a falling sine on every beat
    const kick = Math.sin(2 * Math.PI * (45 * inBeat + 12 * (1 - Math.exp(-inBeat * 30)))) * Math.exp(-inBeat * 9);
    // the bass on the off beat, A1, a softened square
    const bass = Math.tanh(3 * Math.sin(2 * Math.PI * 55 * t)) * Math.exp(-off * 6) * 0.35;
    // the hats: noise, quick to die, on the off beat
    const hat = (rand() * 2 - 1) * Math.exp(-off * 60) * 0.25;
    // the chord, A minor swelling over each bar (so the loop's seam is silent): A3 and E4 left, C4 and A4 right
    const swell = Math.sin(Math.PI * ((b / 4) % 1)) ** 2;
    const pad = (f1: number, f2: number) => (Math.sin(2 * Math.PI * f1 * t) + Math.sin(2 * Math.PI * f2 * t)) * 0.06 * swell;
    const mid = 0.8 * kick + bass;
    l[i] = mid + hat * 0.6 + pad(220, 329.63);
    r[i] = mid + hat + pad(261.63, 440);
  }
  return [l, r];
}

/** Play the test set into `to` (the PA's input), looping until `stop`. */
export function playWalkSet(ctx: BaseAudioContext, to: AudioNode): { stop(): void } {
  const [l, r] = walkSet(ctx.sampleRate), buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(l, 0); buf.copyToChannel(r, 1);
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
  src.connect(to); src.start();
  return { stop: () => { src.stop(); src.disconnect(); } };
}
