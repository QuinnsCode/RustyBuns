// The numbers every game's Controls panel holds. Pure, so a test can reach it without a page.
export interface Settings {
  /** Mouse (or stick) look speed left/right, 1 as shipped. */
  lookX: number;
  /** Mouse (or stick) look speed up/down, 1 as shipped. */
  lookY: number;
  /** Touch drag look speed, 1 as shipped. */
  touch: number;
  invertY: boolean;
}

export const DEFAULTS: Settings = { lookX: 1, lookY: 1, touch: 1, invertY: false };
export const RANGE = { min: 0.25, max: 3, step: 0.05 };

const clamp = (n: number) => Math.min(RANGE.max, Math.max(RANGE.min, n));

/** Whatever was stored (unknown: a hand-edited or older save) down to valid settings; a bad field falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v) : d);
  return {
    lookX: num(o.lookX, DEFAULTS.lookX),
    lookY: num(o.lookY, DEFAULTS.lookY),
    touch: num(o.touch, DEFAULTS.touch),
    invertY: typeof o.invertY === "boolean" ? o.invertY : DEFAULTS.invertY,
  };
}
