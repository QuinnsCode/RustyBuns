// The audio thread reports ~30 times a second. Only the playhead and the meter
// care, so they subscribe here instead of re-rendering the whole app.
import { useSyncExternalStore } from "react";
import type { FromWorklet } from "../engine/messages.ts";
import type { EqDoc } from "../engine/eq.ts";

export type Tick = Extract<FromWorklet, { t: "tick" }>;

let tick: Tick = { t: "tick", pos: 0, abs: 0, synced: false, late: 0, playing: false, countIn: 0, peakL: 0, peakR: 0, minGain: 1, nans: 0, ampMisses: 0, pluginMisses: 0 };
const subs = new Set<() => void>();

export function pushTick(t: Tick) { tick = t; for (const s of subs) s(); }
export function useTick<T>(pick: (t: Tick) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => pick(tick));
}

/** The master EQ as its automation plays it (null: as saved), for Shape's dots and curve to follow. */
let eqPlayed: EqDoc | null = null;
const eqSubs = new Set<() => void>();
export function pushEqPlayed(d: EqDoc | null) { eqPlayed = d; for (const s of eqSubs) s(); }
export function useEqPlayed(): EqDoc | null {
  return useSyncExternalStore((cb) => { eqSubs.add(cb); return () => eqSubs.delete(cb); }, () => eqPlayed);
}
