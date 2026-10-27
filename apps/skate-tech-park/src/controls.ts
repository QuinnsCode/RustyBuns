// The player's control settings: how the stick and the flick pad feel and look, kept per player in the browser. Plain
// data and no DOM; controls-panel.ts edits it, main.ts applies it live.
import { type Profile, scaled } from "./flick.ts";

export type Controls = {
  invertX: boolean; // steer the other way
  invertY: boolean; // throttle the other way
  swap: boolean; // the flick pad on the other half of the screen (left-handed)
  size: number; // the flick pad's size, 1 as drawn
  opacity: number; // how solid the touch controls are
  labels: "always" | "first" | "never"; // trick names on the pad: always, for the first few seconds, or never
  dead: number; // the stick's dead zone, share of its radius
  sens: number; // flick sensitivity: above 1 a shorter drag counts
};

export const DEFAULT_CONTROLS: Controls = { invertX: false, invertY: false, swap: false, size: 1, opacity: 1, labels: "first", dead: 0.18, sens: 1 };
export const CONTROLS_KEY = "skate-controls";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Settings from stored JSON: every field checked, anything missing or wrong falls back to its default. */
export function parseControls(text: string | null): Controls {
  const d = DEFAULT_CONTROLS;
  let v: unknown = null;
  try { v = text ? JSON.parse(text) : null; } catch { /* a damaged save: start over */ }
  if (!isObj(v)) return { ...d };
  return {
    invertX: flag(v.invertX, d.invertX), invertY: flag(v.invertY, d.invertY), swap: flag(v.swap, d.swap),
    size: num(v.size, 0.6, 1.5, d.size), opacity: num(v.opacity, 0.15, 1, d.opacity),
    labels: v.labels === "always" || v.labels === "never" || v.labels === "first" ? v.labels : d.labels,
    dead: num(v.dead, 0.04, 0.45, d.dead), sens: num(v.sens, 0.5, 2, d.sens),
  };
}

export const loadControls = (): Controls => { try { return parseControls(localStorage.getItem(CONTROLS_KEY)); } catch { return { ...DEFAULT_CONTROLS }; } };
export const saveControls = (c: Controls) => { try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)); } catch { /* private window: the settings last this visit */ } };

/** The layout as this player rides it: strokes scaled by the sensitivity, the pad on the side they chose. */
export const tuned = (p: Profile, c: Controls): Profile => {
  const s = c.sens === 1 ? p : scaled(p, 1 / c.sens, p.name, p.about);
  return c.swap ? { ...s, side: s.side === "right" ? "left" : "right" } : s;
};
