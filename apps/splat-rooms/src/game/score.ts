// Scoring and personal bests. Pure apart from `loadRecords`/`saveRecords`,
// which use localStorage and survive it being missing or blocked.

import { check, int, maybe, num, obj, rec, type Of } from "@rustybuns/util/guard";

export interface HuntResult { seconds: number; splats: number; wrong: number }

/**
 * 1000 for an instant, shot-free find; time, splats and wrong picks eat into
 * it. A wrong pick costs the most: it's the one thing that means guessing.
 */
export function score(r: HuntResult): number {
  const s = 1000 - r.seconds * 4 - r.splats * 8 - r.wrong * 120;
  return Math.max(50, Math.round(s));
}

export function stars(points: number): 1 | 2 | 3 {
  return points >= 750 ? 3 : points >= 450 ? 2 : 1;
}

const RoomRecord = obj({ hunts: int(0, 1e9), best: num(0, 1e9), fastest: num(0, 1e9) });
export type RoomRecord = Of<typeof RoomRecord>;
export type Records = Record<string, RoomRecord>;
/** The bests this browser kept, by room; a room whose row doesn't read starts over. */
const Kept = rec(maybe(RoomRecord), 10_000);

const KEY = "splat-rooms:records:v1";

export function loadRecords(): Records {
  try {
    const kept = check(Kept, JSON.parse(localStorage.getItem(KEY) ?? "{}")) ?? {};
    return Object.fromEntries(Object.entries(kept).filter((e): e is [string, RoomRecord] => e[1] !== undefined));
  } catch { return {}; }
}

/** Folds one hunt into the records; returns the new records and whether it beat the room's best. */
export function record(records: Records, sceneId: string, r: HuntResult): { records: Records; points: number; newBest: boolean } {
  const points = score(r);
  const prev = records[sceneId];
  const next: RoomRecord = {
    hunts: (prev?.hunts ?? 0) + 1,
    best: Math.max(prev?.best ?? 0, points),
    fastest: Math.min(prev?.fastest ?? Infinity, r.seconds),
  };
  const out = { ...records, [sceneId]: next };
  try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* private window: bests last the session */ }
  return { records: out, points, newBest: !prev || points > prev.best };
}
