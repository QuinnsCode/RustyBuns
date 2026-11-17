// Wind back: the World keeps a snapshot of the groove at the start of each minute somebody edits it,
// thinned on a ladder so one is always kept about 1 min, 5, 10, 20, 1 h, 4 h and 1 day old. Pick a rung
// and the page plays the groove as it was, alone; the leader can bring everyone back to it (an edit, so undo works).
import { arr, int, obj, oneOf, raw } from "@rustybuns/util/guard";

export const MINUTE = 60_000;
/** How far back each rung goes, in minutes. */
export const RUNGS = [1, 5, 10, 20, 60, 240, 1440] as const;
export type Rung = (typeof RUNGS)[number];
export const RUNG = oneOf(RUNGS);
export const rungName = (r: Rung) => (r < 60 ? `${r} min` : r < 1440 ? `${r / 60} h` : "1 day");

/**
 * Snapshots younger than `below` minutes are kept one per `grain` minutes (the latest in each). Each rung's
 * grain runs past the next rung by its own size, so rung r always has one between r and r plus the rung under it.
 * The grains divide each other (1, 5, 10, 20, 60, 240, 1440), so a snapshot kept in one band is the one kept in the next.
 */
const BANDS = RUNGS.map((grain, k) => ({ grain, below: (RUNGS[k + 1] ?? grain) + grain }));
/** At most this many snapshots are ever kept (the sum of each band's cells, with a little slack). */
export const MAX_SNAPS = 40;

/** The minutes (since 1970) of the snapshots kept at minute `now`, oldest first. */
export function thin(snaps: readonly number[], now: number): number[] {
  const cells = new Map<string, number>();
  // the sesh's oldest groove stays until it's past every band, so a young sesh still winds back to its start
  const first = Math.min(...snaps);
  if (now - first < BANDS[BANDS.length - 1].below) cells.set("first", first);
  for (const at of snaps) {
    const band = BANDS.find((b) => now - at < b.below);
    if (!band || at > now) continue;
    const cell = `${band.grain}:${Math.floor(at / band.grain)}`;
    if ((cells.get(cell) ?? -Infinity) < at) cells.set(cell, at);
  }
  return [...new Set(cells.values())].sort((a, b) => a - b);
}

/**
 * The groove `ago` minutes before `now` (ms): "now" when nobody has edited since then, the snapshot
 * of the latest minute at or before it, or null when the ladder doesn't reach that far back.
 */
export function pick(ladder: Ladder, now: number, ago: number): "now" | number | null {
  const t = now - ago * MINUTE;
  if (t >= ladder.edited) return "now";
  let best: number | null = null;
  for (const at of ladder.snaps) if (at * MINUTE <= t) best = at;
  return best;
}

/** The World's index: the snapshot minutes it holds (each under `snap:<minute>`) and when the groove last changed (ms). */
export type Ladder = { snaps: number[]; edited: number };
export const LadderGuard = obj({ snaps: arr(int(0, Infinity), MAX_SNAPS), edited: int(0, Infinity) });
/** The ladder in the backup bucket: each snapshot with its groove (checked with `sanitize` on the way back in). */
export const BackupLadder = obj({ edited: int(0, Infinity), snaps: arr(obj({ at: int(0, Infinity), project: raw }), MAX_SNAPS) });

