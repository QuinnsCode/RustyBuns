// The club media player's arithmetic, with no Web Audio or DOM in it (player-panel.ts draws the player and drives a
// deck with it; scratch-worklet.ts plays a scratch): what a turn of the jog wheel does in each mode, the side ring's
// nudge, a MIDI jog's messages, the scratch voice's read head, and the waveform's peak levels at a few resolutions so
// the close-up draws the same few hundred bars a frame at any zoom.
//
// The jog wheel has two parts. VINYL: the top platter, touched, holds the track under your hand and moving it
// scratches (forwards and back); the side ring nudges (bends the speed while it moves). CD: the whole wheel nudges.
// Stopped, a turn of the wheel steps through the track in either mode (the platter scratches in VINYL even then).
import { peaks } from "./analyze.ts";

export type JogMode = "vinyl" | "cd";
export type JogPart = "top" | "ring";
export const JOG_MODES: readonly JogMode[] = ["vinyl", "cd"];

/** Seconds of track per turn of the platter: a record at 33⅓ turns a minute. */
export const TURN_S = 1.8;
/** Seconds a turn of the wheel steps through a stopped track (finer than a scratch, to find a beat). */
export const STEP_S = 0.5;
/** The nudge: speed change per turn a second of the ring, and its most either way. */
export const BEND_PER_TPS = 0.12;
export const BEND_MAX = 0.25;
/** The ring lets go of its nudge this long after it stops moving, ms. */
export const BEND_HOLD_MS = 70;

/** What a turn of the wheel does: scratch (move the held track), bend (nudge the speed), or step (move a stopped track). */
export type JogAct = { kind: "scratch"; ds: number } | { kind: "bend" } | { kind: "step"; ds: number } | { kind: "none" };

/**
 * A turn of `turns` (clockwise positive) on `part` of the wheel. `touched`: the top platter is held (VINYL). The
 * platter scratches only in VINYL while held; otherwise playing nudges and stopped steps.
 */
export function jogAct(mode: JogMode, part: JogPart, turns: number, playing: boolean, touched: boolean): JogAct {
  if (!turns) return { kind: "none" };
  if (mode === "vinyl" && part === "top" && touched) return { kind: "scratch", ds: turns * TURN_S };
  if (playing) return { kind: "bend" };
  return { kind: "step", ds: turns * STEP_S };
}

/** The speed factor a nudge at `tps` turns a second gives (1 is no nudge). */
export const bendOf = (tps: number) => 1 + Math.max(-BEND_MAX, Math.min(BEND_MAX, tps * BEND_PER_TPS));

/** A turn between two angles (radians) on the screen, the short way round; clockwise (screen y down) positive. */
export function turnBetween(a0: number, a1: number): number {
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d / (2 * Math.PI);
}

/** Which part of the wheel a point is on, by its distance from the centre over the wheel's radius (null: off it). */
export function partAt(r: number): JogPart | null {
  if (r <= PLATTER_R) return "top";
  if (r >= RING_IN && r <= 1) return "ring";
  return null;
}
/** The top platter's edge and the side ring's inner edge, as parts of the wheel's radius (the gap between them shows). */
export const PLATTER_R = 0.76;
export const RING_IN = 0.82;

// ---- a MIDI jog

/** A MIDI jog's ticks a turn. */
export const TICKS_PER_TURN = 128;
/**
 * A jog off a MIDI controller, the common layout: MIDI channel 1 is deck A, 2 is deck B; note 54 is the platter's
 * touch (on/off); CC 33 turns the side ring and CC 34 the platter, each a relative value (1 to 63 on, 65 to 127 back).
 */
export type MidiJog = { side: 0 | 1; touch: boolean } | { side: 0 | 1; part: JogPart; turns: number };
export function midiJog(data: ArrayLike<number>): MidiJog | null {
  if (data.length < 3) return null;
  const st = data[0]!, kind = st & 0xf0, ch = st & 0x0f, a = data[1]!, v = data[2]!;
  if (ch > 1) return null;
  const side = ch as 0 | 1;
  if ((kind === 0x90 || kind === 0x80) && a === 54) return { side, touch: kind === 0x90 && v > 0 };
  if (kind === 0xb0 && (a === 33 || a === 34)) {
    const ticks = v < 64 ? v : v - 128;
    return ticks ? { side, part: a === 33 ? "ring" : "top", turns: ticks / TICKS_PER_TURN } : null;
  }
  return null;
}

// ---- the scratch voice's read head

/** How fast the read head catches the platter, seconds (a pointer moves in steps; the sound shouldn't). */
export const FOLLOW_S = 0.012;
/**
 * One sample of the read head chasing the platter: the head moves `a` of the way to `target` (a one-pole glide; `a`
 * from `followCoef`), and the gain rises with the speed so a still hand is silence, not a held sample.
 */
export function followStep(head: number, target: number, a: number): number { return head + (target - head) * a; }
export const followCoef = (sampleRate: number) => 1 - Math.exp(-1 / (sampleRate * FOLLOW_S));
/** The scratch's loudness at `speed` (track seconds per second, either way): full from a quarter speed up. */
export const scratchGain = (speed: number) => Math.min(1, Math.abs(speed) * 4);
/** A sample of `d` at fractional index `i` (straight-line between neighbours; 0 off the end). */
export function readAt(d: Float32Array, i: number): number {
  const j = Math.floor(i);
  if (j < 0 || j >= d.length - 1) return 0;
  const f = i - j;
  return d[j]! + (d[j + 1]! - d[j]!) * f;
}

// ---- the waveform's peak levels

/** One level: `bps` buckets a second, each the peak of its slice. */
export interface Level { bps: number; p: Float32Array }
/** The finest level's buckets a second: about a pixel each at the closest zoom on a wide screen. */
export const FINEST_BPS = 1000;
/** The close-up's zooms, seconds either side of the playhead. */
export const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 8, 16] as const;
export const ZOOM_START = 4;

/** A track's peaks at FINEST_BPS, then each level half the last (each bucket the louder of two), down to a few a second. */
export function peakLevels(mono: Float32Array, rate: number): Level[] {
  const per = Math.max(1, Math.round(rate / FINEST_BPS)), n = Math.max(1, Math.ceil(mono.length / per));
  let p = peaks(mono, n, 0, n * per);
  const out: Level[] = [{ bps: rate / per, p }];
  while (p.length > 8 && out[out.length - 1]!.bps > 4) {
    const h = new Float32Array(Math.ceil(p.length / 2));
    for (let i = 0; i < h.length; i++) h[i] = Math.max(p[i * 2]!, p[i * 2 + 1] ?? 0);
    p = h;
    out.push({ bps: out[out.length - 1]!.bps / 2, p });
  }
  return out;
}

/** The level to draw at `pxPerS`: the coarsest whose bars are still no wider than ~2 px (else the finest there is). */
export function levelFor(levels: Level[], pxPerS: number): Level {
  for (let i = levels.length - 1; i >= 0; i--) if (pxPerS / levels[i]!.bps <= 2) return levels[i]!;
  return levels[0]!;
}

/**
 * The close-up's bars around `pos` (seconds), `span` seconds either side over `w` px: for each bucket in view, its x
 * and width and peak. Bars sit on the track's time, not on the pixels, so they slide past without shimmering.
 */
export function bars(levels: Level[], pos: number, span: number, w: number, out: (x: number, bw: number, v: number) => void): void {
  if (!levels.length) return;
  const pxPerS = w / (2 * span), l = levelFor(levels, pxPerS), bw = pxPerS / l.bps;
  const i0 = Math.max(0, Math.floor((pos - span) * l.bps)), i1 = Math.min(l.p.length, Math.ceil((pos + span) * l.bps));
  for (let i = i0; i < i1; i++) out(w / 2 + (i / l.bps - pos) * pxPerS, bw, l.p[i]!);
}
