// Each pedal's knob and part swaps, kept in one place: Q Amp's own store (localStorage "q-amp"). Q Amp and Q Builder
// both read and write them here, so a part swapped on one page is on the other, and an open page takes the other's
// change as it happens (the `storage` event). The rest of Q Amp's store is left as it is.
import { check, isRecord, num, obj, or, rec, str } from "@rustybuns/util/guard";
import type { Swaps } from "../circuit/circuits.ts";

export const AMP_KEY = "q-amp";

/** Each pedal's knob where nobody has turned it, by pedal id (5 for the rest). */
export const DEFAULT_DRIVE: Record<string, number> = { drive: 3, dist: 5, fuzz: 7, germ: 4 };

/** The pedals' knobs (pedal id → 0 to 10) and swaps (pedal id → socket → choice), as Q Amp keeps them. */
export const Parts = obj({
  drive: or(rec(num(0, 10, 5), 32), {}),
  swaps: or(rec(rec(str(12), 40), 32), {}),
});
export type Parts = ReturnType<typeof Parts>;

const stored = (raw?: string | null): unknown => {
  try { const r = raw === undefined ? localStorage.getItem(AMP_KEY) : raw; return r ? JSON.parse(r) : {}; } catch { return {}; }
};

/** The knobs and swaps out of Q Amp's store as it stands (`raw` from a `storage` event, else read now). */
export function readParts(raw?: string | null): Parts {
  const p = check(Parts, stored(raw)) ?? { drive: {}, swaps: {} };
  return { drive: { ...DEFAULT_DRIVE, ...p.drive }, swaps: p.swaps };
}

/** `pedal`'s knob and swaps into Q Amp's store; an empty `swaps` is the stock board. Everything else there stays. */
export function writeParts(pedal: string, drive: number, swaps: Swaps): void {
  try {
    const all = stored(), o = isRecord(all) ? all : {};
    const p = readParts();
    const kept = { ...p.swaps };
    if (Object.keys(swaps).length) kept[pedal] = swaps; else delete kept[pedal];
    localStorage.setItem(AMP_KEY, JSON.stringify({ ...o, drive: { ...p.drive, [pedal]: drive }, swaps: kept }));
  } catch { /* private window or full: not kept, fine */ }
}

/** Calls `then` with the knobs and swaps whenever another page (a tab of Q Amp or Q Builder) changes them. */
export function onParts(then: (p: Parts) => void): void {
  window.addEventListener("storage", (e) => { if (e.key === AMP_KEY || e.key === null) then(readParts(e.newValue)); });
}
