// Each pedal's knob, part swaps and circuit edits (../circuit/edits.ts), kept in one place: localStorage "q-amp-parts". Q Amp, Q Builder and the build
// sheet read and write them here, so a part swapped (or added, or rewired) on one page is on the other, and an open page takes the other's
// change as it happens (the `storage` event). They have a key of their own, away from Q Amp's store ("q-amp"):
// Q Amp saves that one on every footswitch and knob, and a save of its old copy of the swaps there could land after
// Q Builder's swap and undo it (#6459). Here a page writes only when the knobs or swaps themselves change, and only
// Q Builder writes the edits (`writeEdits`): every other save carries over the ones in storage.
import { arr, check, isRecord, num, obj, or, rec, str } from "@rustybuns/util/guard";
import type { Swaps } from "../circuit/circuits.ts";
import { Edit } from "../circuit/edits.ts";

export const PARTS_KEY = "q-amp-parts";
/** Q Amp's own store, where the knobs and swaps lived before they had their key: read once if that key is empty. */
const OLD_KEY = "q-amp";
/** Q Builder's own store, where the circuit edits lived before they came here (#6446). */
const OLD_EDITS_KEY = "qbuilder:v1";

/** Each pedal's knob where nobody has turned it, by pedal id (5 for the rest). */
export const DEFAULT_DRIVE: Record<string, number> = { drive: 3, dist: 5, fuzz: 7, germ: 4 };

/** The pedals' knobs (pedal id → 0 to 10), swaps (pedal id → socket → choice) and circuit edits (pedal id → in order). */
export const Parts = obj({
  drive: or(rec(num(0, 10, 5), 32), {}),
  swaps: or(rec(rec(str(12), 40), 32), {}),
  edits: or(rec(arr(Edit, 64, { drop: true }), 32), {}),
});
export type Parts = ReturnType<typeof Parts>;

const parse = (raw: string | null): unknown => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const stored = (): unknown => {
  try {
    const kept = parse(localStorage.getItem(PARTS_KEY)) ?? parse(localStorage.getItem(OLD_KEY)) ?? {};
    const old = parse(localStorage.getItem(OLD_EDITS_KEY));
    if (!isRecord(kept) || kept.edits || !isRecord(old) || !old.edits) return kept;
    // Written at once: Q Builder's next save of its own store leaves the edits out.
    const moved = check(Parts, { ...kept, edits: old.edits });
    if (moved) localStorage.setItem(PARTS_KEY, JSON.stringify(moved));
    return moved ?? kept;
  } catch { return {}; }
};
const partsOf = (v: unknown): Parts => {
  const p = check(Parts, v) ?? { drive: {}, swaps: {}, edits: {} };
  return { drive: { ...DEFAULT_DRIVE, ...p.drive }, swaps: p.swaps, edits: p.edits };
};
/** What a page may have changed under its own feet: the knobs and swaps, with the defaults in, as `sorted` JSON. */
const mineOf = (p: Pick<Parts, "drive" | "swaps">) => sorted({ drive: { ...DEFAULT_DRIVE, ...p.drive }, swaps: p.swaps });

/** JSON with every object's keys in order, so two copies of the same parts read the same. */
const sorted = (v: unknown): string => JSON.stringify(v, (_, x: unknown) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** The knobs and swaps this page last read or wrote, as `sorted` JSON (a copy: a page edits what it was handed in
 *  place). A save that hasn't moved off them has nothing of its own to keep. */
let seen: string | null = null;

/** The parts as they stand (`raw` from a `storage` event, else read now). */
export function readParts(raw?: string | null): Parts {
  const parts = partsOf(raw === undefined ? stored() : parse(raw) ?? {});
  seen = mineOf(parts);
  return parts;
}

const put = (p: Parts) => localStorage.setItem(PARTS_KEY, JSON.stringify(p));

/** Every pedal's knobs and swaps, written only if this page changed them since it last read or wrote them. A save of
 *  the page's old copy (a Q Amp footswitch just after Q Builder's swap, before its `storage` event lands) then never
 *  undoes the other page's newer change (#6459). */
export function keepParts(p: Pick<Parts, "drive" | "swaps">): void {
  try {
    const mine = mineOf(p);
    if (mine === (seen ?? mineOf(readParts()))) return;
    put({ drive: p.drive, swaps: p.swaps, edits: partsOf(stored()).edits });
    seen = mine;
  } catch { /* private window or full: not kept, fine */ }
}

/** `pedal`'s knob and swaps; an empty `swaps` is the stock board. The other pedals stay as they are. */
export function writeParts(pedal: string, drive: number, swaps: Swaps): void {
  const p = readParts(), kept = { ...p.swaps };
  if (Object.keys(swaps).length) kept[pedal] = swaps; else delete kept[pedal];
  keepParts({ drive: { ...p.drive, [pedal]: drive }, swaps: kept });
}

/** `pedal`'s circuit edits, every one in order; empty is the stock circuit. The knobs, swaps and other pedals stay. */
export function writeEdits(pedal: string, edits: readonly Edit[]): void {
  const p = partsOf(stored()), kept = { ...p.edits };
  if (edits.length) kept[pedal] = [...edits]; else delete kept[pedal];
  try { put({ ...p, edits: kept }); } catch { /* private window or full: not kept, fine */ }
}

/** Calls `then` with the parts whenever another page (a tab of Q Amp or Q Builder) changes them. */
export function onParts(then: (p: Parts) => void): void {
  window.addEventListener("storage", (e) => { if (e.key === PARTS_KEY || e.key === null) then(readParts(e.newValue)); });
}
