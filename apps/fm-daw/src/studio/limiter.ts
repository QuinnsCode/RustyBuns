// The jam room's limiters: one brick wall last before this machine's speakers, always on, and one on each voice,
// mic and guitar coming in from someone else, at a ceiling the listener picks, so nobody can shout a room down.
//
// A WaveShaperNode, not a DynamicsCompressorNode: Web Audio's compressor adds its own makeup gain (louder quiet
// parts, a different room), and with a 3 ms attack it still lets the front of a shout through. The curve is the
// signal untouched up to a knee, then bent smoothly towards the ceiling, which nothing can pass: a WaveShaper clamps
// any input past full scale to the curve's ends, and every point on the curve sits inside the ceiling.
import { CEILING } from "../engine/params.ts";

/** Where the bend starts, as a share of the ceiling: under it a signal passes as it is. */
const KNEE = 0.7;
const POINTS = 4097;

export function dbGain(db: number): number { return 10 ** (db / 20); }

/** The WaveShaper's curve for a ceiling (linear gain): x as it is up to the knee, then a tanh bend that only nears `ceiling`. */
export function clipCurve(ceiling: number, n = POINTS): Float32Array<ArrayBuffer> {
  const k = ceiling * KNEE, room = ceiling - k, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    out[i] = a <= k ? x : Math.sign(x) * (k + room * Math.tanh((a - k) / room));
  }
  return out;
}

/** One sample through a curve, as the Web Audio spec has a WaveShaperNode do it (clamped to ±1, then linear between points). */
export function shaped(curve: Float32Array, x: number): number {
  const v = ((curve.length - 1) * (Math.min(1, Math.max(-1, x)) + 1)) / 2, i = Math.floor(v), f = v - i;
  return i >= curve.length - 1 ? curve[curve.length - 1] : curve[i] * (1 - f) + curve[i + 1] * f;
}

/** A limiter at `db` dBFS: connect into `node`, out of `node`; `set` moves the ceiling. */
export function limiter(ctx: BaseAudioContext, db: number) {
  const node = new WaveShaperNode(ctx, { curve: clipCurve(dbGain(db)), oversample: "4x" });
  return { node, set: (d: number) => { node.curve = clipCurve(dbGain(d)); } };
}

/** The room's brick wall, last before the speakers, at the engine's own ceiling (-1 dBFS). Everything heard plays into what this returns. */
export function brickWall(ctx: AudioContext): AudioNode {
  const node = new WaveShaperNode(ctx, { curve: clipCurve(CEILING), oversample: "4x" });
  node.connect(ctx.destination);
  return node;
}

/** The listener's steps for anyone else (dBFS): the band peaks at -1, so the default holds a full-scale shout to half of that. */
export const PEER_STEPS = [-3, -6, -12, -18] as const;
export const PEER_DEFAULT = -6;
const KEY = "qollab-studio:peer-ceiling";

/** The kept setting, or the default when there's none or it isn't one of the steps. */
export function peerCeiling(stored: string | null): number {
  const n = Number(stored);
  return stored !== null && PEER_STEPS.some((s) => s === n) ? n : PEER_DEFAULT;
}

/** The Esc menu's "Loudest anyone else can be" select: filled with the steps, kept in this browser, `changed` on a pick. */
export function peerCeilingSetting(select: HTMLElement, changed: (db: number) => void): () => number {
  let db = PEER_DEFAULT;
  try { db = peerCeiling(localStorage.getItem(KEY)); } catch { /* no storage */ }
  if (!(select instanceof HTMLSelectElement)) return () => db;
  const names: Record<(typeof PEER_STEPS)[number], string> = { [-3]: "Loud", [-6]: "Under the band", [-12]: "Quiet", [-18]: "Whisper" };
  select.replaceChildren(...PEER_STEPS.map((s) => new Option(`${names[s]} (${s} dB)`, String(s), false, s === db)));
  select.onchange = () => {
    db = peerCeiling(select.value);
    try { localStorage.setItem(KEY, String(db)); } catch { /* this visit only */ }
    changed(db);
  };
  return () => db;
}
