// What you hear where you stand, as numbers: each playing speaker's level at your head from packages/gear
// (distance and off-axis), how dull it sounds from where you are, and the sub band summed with phase so the
// alley between two subs is loud. No DOM: the page (play.ts) turns this into gains, and state() reports it.
import { GEAR as SPECS, levelAt, offAxisLoss, aimTo, source, splAt, type Source, type Vec3 } from "@rustybuns/gear";
import { EYE, EYE_CROUCH, holdPose, type Item, type World } from "../sim.ts";

/** The level you hear at 0 dB gain: louder than this is pushed into the limiter. */
export const REF_DB = 112;
/** The sub band's frequency for the phase sum, Hz. */
export const LOW_HZ = 63;

/** Which speakers are switched on, by item key. Amps and powered speakers have a switch. */
export type Switches = Set<string>;

/**
 * Whether a speaker gets power and signal. `switchedOnIsFed` is the cozy answer, a switch is enough: a speaker by its own
 * switch, a passive one also when any amp in the level is on. `fedBy` in src/cables/cables.ts adds the patch on top.
 */
export type Fed = (w: World, key: string, on: Switches) => boolean;

export const switchedOnIsFed: Fed = (w, key, on) => {
  const item = w.items.find((i) => i.key === key);
  const spec = item && SPECS[item.gear]?.speaker;
  if (!item || !spec) return false;
  if (on.has(key)) return true;
  return spec.ohms !== null && w.items.some((i) => SPECS[i.gear]?.amp && on.has(i.key));
};

/** Whether a piece of gear can be switched on: anything that draws power, and (until cables) every speaker. */
export function hasSwitch(gearId: string): boolean {
  return !!(SPECS[gearId]?.draw || SPECS[gearId]?.speaker);
}

/** A venue's rig, when it has one (the dive bar): each top's tilt in radians and the master fader in dB. */
export type Rig = { tilt?: Readonly<Record<string, number>>; master?: number; lossDb?: Readonly<Record<string, number>> };

export type Heard = {
  key: string;
  gear: string;
  fed: boolean;
  /** Whether it plays mids and highs (a sub only plays the low band). */
  highs: boolean;
  /** Mids and highs at your head, dB SPL (null when it isn't playing). */
  db: number | null;
  /** Off-axis loss at your head, dB: behind a box it goes dull as well as quiet. */
  offAxis: number;
  /** Where its top end rolls off from here, Hz. */
  brightHz: number;
  /** Left (-1) to right (1) as you face. */
  pan: number;
};

export type Hearing = {
  listener: Vec3;
  speakers: Heard[];
  /** Everything playing, mids and highs by power, dB SPL (null when nothing plays). */
  high: number | null;
  /** The sub band at your head, summed with phase (null when nothing plays it). */
  low: number | null;
};

/** Where a speaker's drivers are: two thirds up its box (as the dive bar scores it), wherever it sits or is carried. */
function placed(w: World, i: Item): { pos: Vec3; yaw: number } {
  const p = i.key === w.held?.key ? (holdPose(w) ?? i) : i;
  const h = SPECS[i.gear]?.size.h ?? 0;
  return { pos: { x: p.x, y: p.y + h * 0.65, z: p.z }, yaw: p.rot };
}

/** Your head. */
export function ears(w: World): Vec3 {
  return { x: w.you.x, y: w.you.crouch ? EYE_CROUCH : EYE, z: w.you.z };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** What every speaker in the level sounds like at `at` (your head unless given). */
export function hear(w: World, on: Switches, fed: Fed = switchedOnIsFed, at: Vec3 = ears(w), rig: Rig = {}): Hearing {
  const speakers: Heard[] = [];
  const playing: Source[] = [];
  // Right of where you face: yaw 0 looks down -z, so right is +x.
  const rx = Math.cos(w.you.yaw);
  const rz = -Math.sin(w.you.yaw);
  for (const item of w.items) {
    const spec = SPECS[item.gear]?.speaker;
    if (!spec) continue;
    const isFed = fed(w, item.key, on);
    const { pos, yaw } = placed(w, item);
    const src = source(item.gear, pos, { yaw, pitch: rig.tilt?.[item.key] ?? 0, watts: spec.ratedWatts * 10 ** ((rig.master ?? 0) / 10) });
    const { h, v, d } = aimTo(src, at);
    const loss = offAxisLoss(spec, h, v);
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, ((pos.x - at.x) * rx + (pos.z - at.z) * rz) / d)) : 0;
    const bright = Math.min(spec.highCut, Math.max(600, 16000 * 10 ** (-loss / 14)));
    if (isFed) playing.push(src);
    speakers.push({ key: item.key, gear: item.gear, fed: isFed, highs: spec.highCut > 500, db: isFed ? r1(splAt(src, at) - (rig.lossDb?.[item.key] ?? 0)) : null, offAxis: r1(loss), brightHz: Math.round(bright), pan: r1(pan) });
  }
  const highs = playing.filter((s) => s.speaker.highCut > 500);
  const lows = playing.filter((s) => s.speaker.lowCut <= LOW_HZ && LOW_HZ <= s.speaker.highCut);
  return {
    listener: { x: r1(at.x), y: r1(at.y), z: r1(at.z) },
    speakers,
    high: highs.length ? r1(levelAt(highs, at, "high")) : null,
    low: lows.length ? r1(levelAt(lows, at, "low", LOW_HZ)) : null,
  };
}

/** A level in dB SPL as a gain for the page: 1 at REF_DB, 0 for silence. */
export function gainOf(db: number | null): number {
  return db === null ? 0 : 10 ** ((db - REF_DB) / 20);
}
