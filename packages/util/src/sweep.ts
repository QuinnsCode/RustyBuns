// Cheesy, slow, sweeping camera for the park games' scene breaks: a stately orbit that pushes in and
// cranes down on its subject, with a narrator's line to match. Pure functions of time, so the page, a
// test and a screenshot all see the same shot. The games own the letterbox bars and the caption box.
import { clamp } from "./index.ts";

export interface Vec3 { x: number; y: number; z: number }
/** A camera for the page to use: where it sits, what it looks at, and how much of the view it has (1: all of it, 0: the player's own). */
export interface SweepShot { from: Vec3; at: Vec3; mix: number }

export interface SweepOpts {
  /** Metres from the subject at the end of the sweep (it starts half as far again out). */
  radius?: number;
  /** Metres above the subject at the end (it starts 1.7 times as high). */
  height?: number;
  /** How long the sweep takes. */
  seconds?: number;
  /** Radians swept round the subject over the whole sweep: slow. */
  turn?: number;
  /** Where on the circle it begins. */
  start?: number;
}

const smooth = (u: number) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/**
 * A one-off sweep `t` seconds in: round the subject, closing in and craning down as it goes, then the last
 * fifth hands the view back to the player (`mix` falls to 0), so the cut back to play never jumps.
 */
export function sweepShot(t: number, focus: Vec3, o: SweepOpts = {}): SweepShot {
  const { radius = 30, height = 12, seconds = 8, turn = 1.1, start = 0.6 } = o;
  const u = clamp(t / seconds, 0, 1), e = smooth(u), a = start + turn * e;
  const r = radius * (1.5 - 0.5 * e), h = height * (1.7 - 0.7 * e);
  return {
    from: { x: focus.x + Math.sin(a) * r, y: focus.y + h, z: focus.z + Math.cos(a) * r },
    at: { x: focus.x, y: focus.y + 1.5 + (1 - e) * 3, z: focus.z },
    mix: 1 - smooth((u - 0.8) / 0.2),
  };
}

/**
 * A backdrop that never ends: the same stately orbit, breathing in and out and bobbing up and down on a long
 * period, the height and the distance drifting in and out of step.
 */
export function loopShot(t: number, focus: Vec3, o: { radius?: number; height?: number; period?: number } = {}): SweepShot {
  const { radius = 40, height = 20, period = 120 } = o;
  const a = (t / period) * Math.PI * 2;
  const r = radius * (1 + 0.15 * Math.sin(a * 3)), h = height * (1 + 0.3 * Math.sin(a * 2 + 1));
  return {
    from: { x: focus.x + Math.cos(a) * r, y: focus.y + h, z: focus.z + Math.sin(a) * r },
    at: { x: focus.x, y: focus.y + 2, z: focus.z },
    mix: 1,
  };
}

/** The narrator's lines, a few per game: portentous about very little. */
export const CHEESE = {
  recon: [
    "A quiet valley. Somewhere in it, a merge conflict.",
    "They said no one could hold the yard. They were mostly right.",
    "The grass is green. The diff is red.",
    "Every commit has a story. This one has a helicopter.",
  ],
  hide: [
    "Somewhere out there, a very small camper is holding very still.",
    "The pines remember everything. The rangers do not.",
    "Nature does not hurry. Neither, at the moment, do the rangers.",
    "Two kinds of people walk this park: the hunters, and the bush.",
  ],
  skate: [
    "Eight wheels. One park. No sensible plan.",
    "Gravity is a suggestion. The ramp is a promise.",
    "Some are born to ride. Others are born to bail in slow motion.",
    "The concrete waits, patient, as concrete does.",
  ],
} as const;

/** One of a game's lines, the same for the same `n` (a level index, a round number, a clock). */
export function cheese(kind: keyof typeof CHEESE, n: number): string {
  const lines = CHEESE[kind];
  return lines[((Math.floor(n) % lines.length) + lines.length) % lines.length]!;
}
