// An 808 out of one sine: a fast pitch drop for the knock, a soft clip for the warmth, a long tail (with a glide down,
// the sad kind) for the boom. The roll plays a short one per note it passes; a reminder that fires plays a long one.
let ctx: AudioContext | null = null;

function clip(k: number): Float32Array<ArrayBuffer> {
  const n = 1024, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; out[i] = Math.tanh(k * x) / Math.tanh(k); }
  return out;
}

/** One 808 note at `hz` (40 to 80 sits where an 808 lives). `glide` below 1 bends the tail down. */
export function boom(hz: number, o: { gain?: number; len?: number; glide?: number } = {}): void {
  const { gain = 0.45, len = 0.7, glide = 1 } = o;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(hz * 3.2, t);
  osc.frequency.exponentialRampToValueAtTime(hz, t + 0.05);
  if (glide !== 1) osc.frequency.exponentialRampToValueAtTime(hz * glide, t + len * 0.9);
  const shape = ctx.createWaveShaper();
  shape.curve = clip(2.2);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(shape).connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + len + 0.05);
}

/** A reminder going off: two long, bending booms a fifth apart. */
export function alarm(): void {
  boom(55, { gain: 0.6, len: 1.4, glide: 0.8 });
  setTimeout(() => boom(41.2, { gain: 0.55, len: 1.8, glide: 0.75 }), 380);
}
