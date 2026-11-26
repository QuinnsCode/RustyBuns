// The guitarist's amp at the show, and the guitar baked through it. At soundcheck you stand at the amp and set its five
// knobs (Gain, Bass, Mid, Treble, Master, 0 to 10); `bakeGuitar` runs the guitar's clean stem (stems.ts, a DI) through
// the amp's circuit. The amp is Q Brit 3, one of Qollab Studio's Q Amp heads, from the kit both games share
// (`@rustybuns/gear/circuit` heads.ts): three 12AX7 stages with the Gain pot ahead of the second, the passive
// bass/mid/treble stack, a push-pull power stage and a closed-back 4x12 heard through a mic. It is heavy (a Newton solve
// per tube per sample, four times oversampled), so the page runs it in a worker (amp-worker.ts). Plain data, no DOM.
import { type RigSpec, head, headRig, runRig } from "@rustybuns/gear/circuit";
import { clamp } from "@rustybuns/util";
import { Bad, type Guard, type Of, int, num, obj } from "@rustybuns/util/guard";

export const AMP_KNOBS = ["gain", "bass", "mid", "treble", "master"] as const;
export type AmpKnob = (typeof AMP_KNOBS)[number];
export type AmpKnobs = Record<AmpKnob, number>;

const knob = num(0, 10);
/** The five knobs, as they go to the worker. */
export const AmpKnobs = obj({ gain: knob, bass: knob, mid: knob, treble: knob, master: knob });

/** The sample rate the show's stems are made and baked at, whatever the page's audio runs at. */
export const BAKE_RATE = 48000;
/** The page to the worker: bake every song's guitar through these knobs (ask `id`; a later ask drops this one). */
export const BakeAsk = obj({ id: int(0, Number.MAX_SAFE_INTEGER), knobs: AmpKnobs });
export type BakeAsk = Of<typeof BakeAsk>;
const samples: Guard<Float32Array<ArrayBuffer>> = (v) => {
  if (!(v instanceof Float32Array)) throw new Bad("samples, as a Float32Array");
  return new Float32Array(v);
};
/** The worker to the page: song `song`'s guitar, baked, for ask `id`, at `BAKE_RATE`. */
export const BakeReply = obj({ id: int(0, Number.MAX_SAFE_INTEGER), song: int(0, 99), data: samples });
export type BakeReply = Of<typeof BakeReply>;

/** The amp as the guitarist walks on with it: a crunch, mids up. */
export const newAmp = (): AmpKnobs => ({ gain: 6, bass: 5, mid: 6, treble: 6, master: 5 });

/** Turn one knob by `by`, kept on the panel's 0 to 10. */
export function turnKnob(a: AmpKnobs, knob: AmpKnob, by: number): void {
  a[knob] = clamp(Math.round((a[knob] + by) * 2) / 2, 0, 10);
}

/** The guitarist's head: Qollab Studio's Q Brit 3. */
export const SHOW_HEAD = head("brit");

/** The amp at these knobs, as a rig: Q Brit 3 with no hiss and no tremolo. */
export function ampRig(k: AmpKnobs): RigSpec {
  return headRig(SHOW_HEAD, { ...k, noise: 0, rate: 0, depth: 0 });
}

const rms = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
};

/** How much of the loop's end runs through the amp ahead of it, seconds: the tubes and caps settle in that. */
const PRE_ROLL = 0.5;

/**
 * The guitar's stem (a loop, at `rate`) baked through the amp at these knobs, looping as cleanly as it came in: the
 * loop's last half second goes in first and is dropped, so the amp has settled and the cab's tail wraps round the seam.
 * It comes back at the stem's own RMS, so the desk's dB for the guitar mean the same baked or not.
 */
export function bakeGuitar(di: Float32Array, rate: number, k: AmpKnobs): Float32Array<ArrayBuffer> {
  const n = di.length, pre = Math.min(n, Math.round(PRE_ROLL * rate)), run = new Float32Array(pre + n);
  run.set(di.subarray(n - pre), 0);
  run.set(di, pre);
  const { out } = runRig(ampRig(k), run, rate);
  const baked = new Float32Array(out.subarray(pre));
  const scale = rms(di) / (rms(baked) || 1);
  for (let s = 0; s < n; s++) baked[s] = (baked[s] ?? 0) * scale;
  return baked;
}
