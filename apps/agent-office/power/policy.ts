// How hard the 3D office draws. Upstream renders every frame the display offers (120 a second on a ProMotion Mac),
// at up to 2x pixels with MSAA, shadows and a second outline pass, whether you're looking or not. This picks a frame
// rate and a pixel ratio from what you're doing, so an office left open in a side window costs a trickle.

export const KEY = "rustybuns.power";
export type Mode = "auto" | "smooth" | "saver";
export const MODES: Mode[] = ["auto", "smooth", "saver"];

/** No pointer, key or wheel for this long and you're watching, not playing. */
export const IDLE_MS = 10_000;

export interface State {
  mode: Mode;
  /** The page has focus: you're in the office, not another window. */
  focused: boolean;
  /** Since your last pointer, key or wheel. */
  idleMs: number;
  /** Unplugged, per the Battery Status API; false where the browser doesn't say. */
  onBattery: boolean;
}

/** Frames a second to draw; Infinity draws every one the display offers. */
export function fps({ mode, focused, idleMs, onBattery }: State): number {
  if (mode === "smooth") return focused ? Infinity : 30;
  const saver = mode === "saver" || onBattery;
  if (!focused) return saver ? 5 : 15;
  if (idleMs > IDLE_MS) return saver ? 20 : 30;
  return mode === "saver" ? 30 : 60;
}

/** The renderer's pixel ratio: upstream's min(dpr, 2), less on battery. */
export function pixelRatio(mode: Mode, onBattery: boolean, dpr: number): number {
  const cap = mode === "saver" ? 1 : mode === "auto" && onBattery ? 1.5 : 2;
  return Math.min(dpr, cap);
}

/** A frame gate: true when a frame at `now` (rAF's timestamp, ms) is due at `rate` a second. */
export function gate() {
  let last = -Infinity;
  return (now: number, rate: number) => {
    // a couple of ms early still counts, or 60 on a 60 Hz display would drop every other frame to jitter
    if (rate !== Infinity && now - last < 1000 / rate - 2) return false;
    last = now;
    return true;
  };
}

export const parseMode = (s: string | null): Mode => (MODES.includes(s as Mode) ? (s as Mode) : "auto");
