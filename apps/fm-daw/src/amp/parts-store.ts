// Each pedal's knob and part swaps, kept in one place: localStorage "q-amp-parts". Q Amp, Q Builder and the build
// sheet read and write them here, so a part swapped on one page is on the other, and an open page takes the other's
// change as it happens (the `storage` event). They have a key of their own, away from Q Amp's store ("q-amp"):
// Q Amp saves that one on every footswitch and knob, and a save of its old copy of the swaps there could land after
// Q Builder's swap and undo it (#6459). Here a page writes only when the knobs or swaps themselves change.
import { check, num, obj, or, rec, str } from "@rustybuns/util/guard";
import type { Swaps } from "../circuit/circuits.ts";

export const PARTS_KEY = "q-amp-parts";
/** Q Amp's own store, where the knobs and swaps lived before they had their key: read once if that key is empty. */
const OLD_KEY = "q-amp";

/** Each pedal's knob where nobody has turned it, by pedal id (5 for the rest). */
export const DEFAULT_DRIVE: Record<string, number> = { drive: 3, dist: 5, fuzz: 7, germ: 4 };

/** The pedals' knobs (pedal id → 0 to 10) and swaps (pedal id → socket → choice), as Q Amp keeps them. */
export const Parts = obj({
  drive: or(rec(num(0, 10, 5), 32), {}),
  swaps: or(rec(rec(str(12), 40), 32), {}),
});
export type Parts = ReturnType<typeof Parts>;

const parse = (raw: string | null): unknown => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const stored = (): unknown => {
  try { return parse(localStorage.getItem(PARTS_KEY)) ?? parse(localStorage.getItem(OLD_KEY)) ?? {}; } catch { return {}; }
};

/** The knobs and swaps as they stand (`raw` from a `storage` event, else read now). */
export function readParts(raw?: string | null): Parts {
  const p = check(Parts, raw === undefined ? stored() : parse(raw) ?? {}) ?? { drive: {}, swaps: {} };
  return { drive: { ...DEFAULT_DRIVE, ...p.drive }, swaps: p.swaps };
}

/** JSON with every object's keys in order, so two copies of the same parts read the same. */
const sorted = (v: unknown): string => JSON.stringify(v, (_, x: unknown) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const same = (a: Parts, b: Parts) => sorted(a) === sorted(b);

/** Every pedal's knobs and swaps, written only if they differ from what is kept, so a page's save of the same
 *  values never lands on top of another page's newer change. */
export function keepParts(p: Parts): void {
  try {
    if (same(readParts(), { drive: { ...DEFAULT_DRIVE, ...p.drive }, swaps: p.swaps })) return;
    localStorage.setItem(PARTS_KEY, JSON.stringify({ drive: p.drive, swaps: p.swaps }));
  } catch { /* private window or full: not kept, fine */ }
}

/** `pedal`'s knob and swaps; an empty `swaps` is the stock board. The other pedals stay as they are. */
export function writeParts(pedal: string, drive: number, swaps: Swaps): void {
  const p = readParts(), kept = { ...p.swaps };
  if (Object.keys(swaps).length) kept[pedal] = swaps; else delete kept[pedal];
  keepParts({ drive: { ...p.drive, [pedal]: drive }, swaps: kept });
}

/** Calls `then` with the knobs and swaps whenever another page (a tab of Q Amp or Q Builder) changes them. */
export function onParts(then: (p: Parts) => void): void {
  window.addEventListener("storage", (e) => { if (e.key === PARTS_KEY || e.key === null) then(readParts(e.newValue)); });
}
