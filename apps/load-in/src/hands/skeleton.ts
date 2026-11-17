// A right hand at adult size, in metres, in its own frame: the wrist at the origin, the fingers pointing down -z, the
// palm facing -y (the back of the hand +y) and the thumb on the -x side. The left hand is this one mirrored in x. Five
// fingers of three joints each (the thumb: its base, its knuckle and its tip joint), with the range each joint really
// has: knuckles curl a long way toward the palm, barely back, and spread a little; the two finger joints past them are
// hinges. Plain numbers, no three.js, so the solver and its test run anywhere.
import type { JointLimit } from "@rustybuns/rig/ik";

export type V3 = [number, number, number];

export const FINGERS = ["thumb", "index", "middle", "ring", "little"] as const;
export type Finger = (typeof FINGERS)[number];

export type Bone = { name: string; parent: number; at: V3; radius: number; limit: JointLimit | null };

/** Forearm, wrist to elbow, and its girth at each end (a forearm is flatter than it is deep: the view squashes it). */
export const FOREARM = { length: 0.26, wrist: 0.029, elbow: 0.043 };
/** The palm: its half width, the back and the front (volar) face, and how far it runs from the wrist to the knuckles. */
export const PALM = { half: 0.043, back: 0.012, front: -0.014, length: 0.09 };

const lim = (min: V3, max: V3): JointLimit => ({ min, max });
/** A finger's knuckle (MCP): curls up to 89 degrees, back 17, spreads 14 each way. */
const MCP = lim([-1.55, -0.25, 0], [0.3, 0.25, 0]);
/** The middle joint (PIP) curls to 106 degrees and not back at all; the end joint (DIP) to 75 and a touch back. */
const PIP = lim([-1.85, 0, 0], [0.02, 0, 0]);
const DIP = lim([-1.3, 0, 0], [0.08, 0, 0]);
// The thumb's joints don't line up with the hand's axes, so it curls on two of them: -x and +z together tip it toward
// the palm (its base also swings across toward the fingers).
const CMC = lim([-0.6, -0.6, -0.5], [0.5, 0.6, 0.9]);
const TMCP = lim([-1, -0.35, -0.25], [0.25, 0.35, 1]);
const TIP = lim([-1.2, -0.3, -0.25], [0.25, 0.3, 1.1]);

/** Each finger: where its knuckle sits and the length and girth of its three segments (proximal, middle, distal). */
const DIGITS: Record<Exclude<Finger, "thumb">, { x: number; z: number; len: V3; r: V3 }> = {
  index: { x: -0.025, z: -0.088, len: [0.04, 0.024, 0.019], r: [0.0095, 0.0085, 0.0078] },
  middle: { x: -0.0045, z: -0.092, len: [0.044, 0.028, 0.02], r: [0.0098, 0.0088, 0.008] },
  ring: { x: 0.0145, z: -0.087, len: [0.041, 0.027, 0.02], r: [0.0092, 0.0083, 0.0076] },
  little: { x: 0.032, z: -0.077, len: [0.032, 0.02, 0.018], r: [0.0082, 0.0074, 0.0068] },
};
const KNUCKLE_Y = -0.002;

const norm = (v: V3): V3 => { const l = Math.hypot(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const along = (p: V3, d: V3, l: number): V3 => [p[0] + d[0] * l, p[1] + d[1] * l, p[2] + d[2] * l];

function build(): { bones: Bone[]; tips: Record<Finger, number>; chains: Record<Finger, number[]> } {
  const bones: Bone[] = [{ name: "wrist", parent: -1, at: [0, 0, 0], radius: 0.028, limit: null }];
  const add = (name: string, parent: number, at: V3, radius: number, limit: JointLimit | null) => (bones.push({ name, parent, at, radius, limit }), bones.length - 1);
  const tips = {} as Record<Finger, number>, chains = {} as Record<Finger, number[]>;
  // Thumb: its base low on the palm by the wrist, the metacarpal out and forward, two segments on.
  const base: V3 = [-0.02, -0.01, -0.022], d1 = norm([-0.5, -0.3, -0.8]), d2 = norm([-0.3, -0.35, -0.88]);
  const cmc = add("thumb-base", 0, base, 0.013, CMC);
  const tm = add("thumb-knuckle", cmc, along(base, d1, 0.046), 0.0105, TMCP);
  const ip = add("thumb-joint", tm, along(bones[tm].at, d2, 0.032), 0.0095, TIP);
  tips.thumb = add("thumb-tip", ip, along(bones[ip].at, d2, 0.026), 0.0088, null);
  chains.thumb = [cmc, tm, ip, tips.thumb];
  for (const [f, d] of Object.entries(DIGITS) as [Exclude<Finger, "thumb">, (typeof DIGITS)["index"]][]) {
    const mcp = add(`${f}-knuckle`, 0, [d.x, KNUCKLE_Y, d.z], d.r[0], MCP);
    const pip = add(`${f}-middle`, mcp, [d.x, KNUCKLE_Y, d.z - d.len[0]], d.r[1], PIP);
    const dip = add(`${f}-end`, pip, [d.x, KNUCKLE_Y, d.z - d.len[0] - d.len[1]], d.r[2], DIP);
    tips[f] = add(`${f}-tip`, dip, [d.x, KNUCKLE_Y, d.z - d.len[0] - d.len[1] - d.len[2]], d.r[2], null);
    chains[f] = [mcp, pip, dip, tips[f]];
  }
  return { bones, tips, chains };
}

export const HAND = build();
