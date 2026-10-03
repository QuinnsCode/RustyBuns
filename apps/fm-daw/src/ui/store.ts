// The audio thread reports ~30 times a second. Only the playhead and the meter
// care, so they subscribe here instead of re-rendering the whole app.
import { useSyncExternalStore } from "react";
import type { FromWorklet } from "../engine/messages.ts";

export type Tick = Extract<FromWorklet, { t: "tick" }>;

let tick: Tick = { t: "tick", pos: 0, playing: false, countIn: 0, peakL: 0, peakR: 0, minGain: 1, nans: 0 };
const subs = new Set<() => void>();

export function pushTick(t: Tick) { tick = t; for (const s of subs) s(); }
export function useTick<T>(pick: (t: Tick) => T): T {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => pick(tick));
}
