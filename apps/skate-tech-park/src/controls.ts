// The player's control settings: how the stick and the flick pad feel and look, kept per player in the browser. Plain
// data and no DOM; the Controls cog (main.ts) edits it, main.ts applies it live.
import { type Profile, scaled } from "./flick.ts";
import { bool, check, maybe, num, obj, oneOf, type Of } from "@rustybuns/util/guard";
import { parseJson } from "@rustybuns/util/http";

/** A number from `lo` to `hi`; anything else (out of range too) is `d`. */
const within = (lo: number, hi: number, d: number) => (v: unknown) => maybe(num(lo, hi))(v) ?? d;
/** The saved settings: every field checked, anything missing or wrong falls back to its default. */
const ControlsSave = obj({
  invertX: bool(false), // steer the other way
  swap: bool(false), // the flick pad on the other half of the screen (left-handed)
  size: within(0.6, 1.5, 1), // the flick pad's size, 1 as drawn
  opacity: within(0.15, 1, 1), // how solid the touch controls are
  labels: oneOf(["always", "first", "never"], "first"), // trick names on the pad: always, for the first few seconds, or never
  dead: within(0.04, 0.45, 0.18), // the stick's dead zone, share of its radius
});
export type Controls = Of<typeof ControlsSave>;

export const DEFAULT_CONTROLS: Controls = ControlsSave({});
export const CONTROLS_KEY = "skate-controls";

/** Settings from stored JSON; a damaged save starts over. */
export const parseControls = (text: string | null): Controls => check(ControlsSave, parseJson(text)) ?? { ...DEFAULT_CONTROLS };

export const loadControls = (): Controls => { try { return parseControls(localStorage.getItem(CONTROLS_KEY)); } catch { return { ...DEFAULT_CONTROLS }; } };
export const saveControls = (c: Controls) => { try { localStorage.setItem(CONTROLS_KEY, JSON.stringify(c)); } catch { /* private window: the settings last this visit */ } };

/** The layout as this player rides it: strokes scaled by the sensitivity, the pad on the side they chose. */
export const tuned = (p: Profile, c: Controls, sens = 1): Profile => {
  const s = sens === 1 ? p : scaled(p, 1 / sens, p.name, p.about);
  return c.swap ? { ...s, side: s.side === "right" ? "left" : "right" } : s;
};
