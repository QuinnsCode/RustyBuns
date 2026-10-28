// The numbers every game's Controls panel holds. Pure, so a test can reach it without a page.
export interface Settings {
  /** Mouse (or stick) look speed left/right, 1 as shipped. */
  lookX: number;
  /** Mouse (or stick) look speed up/down, 1 as shipped. */
  lookY: number;
  /** Touch drag look speed, 1 as shipped. */
  touch: number;
  invertY: boolean;
  /** Touch trims per axis, multiplied with `touch`, 1 as shipped. */
  touchX: number;
  touchY: number;
  /** Screen brightness multiplier, 1 as shipped. */
  brightness: number;
  /** Music and sound-effect loudness, 0 to 1. */
  music: number;
  sfx: number;
  /** Music and sound effects on or off as a whole. */
  musicOn: boolean;
  sfxOn: boolean;
  /** Sound pieces the player switched off, by the id the game gave them (footsteps, voices...). */
  muted: string[];
  /** Camera zoom multiplier (above 1 is closer) and tilt in degrees, 1 and 0 as shipped. */
  zoom: number;
  tilt: number;
}

export const DEFAULTS: Settings = {
  lookX: 1, lookY: 1, touch: 1, invertY: false,
  touchX: 1, touchY: 1, brightness: 1, music: 1, sfx: 1, musicOn: true, sfxOn: true, muted: [], zoom: 1, tilt: 0,
};

export type NumKey = "lookX" | "lookY" | "touch" | "touchX" | "touchY" | "brightness" | "music" | "sfx" | "zoom" | "tilt";
/** Slider bounds per number, with how it reads ("x" for a multiplier, "%" of full, "deg"). */
export const RANGES: Record<NumKey, { min: number; max: number; step: number; unit: "x" | "%" | "deg" }> = {
  lookX: { min: 0.25, max: 3, step: 0.05, unit: "x" },
  lookY: { min: 0.25, max: 3, step: 0.05, unit: "x" },
  touch: { min: 0.25, max: 3, step: 0.05, unit: "x" },
  touchX: { min: 0.25, max: 3, step: 0.05, unit: "x" },
  touchY: { min: 0.25, max: 3, step: 0.05, unit: "x" },
  brightness: { min: 0.5, max: 1.5, step: 0.05, unit: "x" },
  music: { min: 0, max: 1, step: 0.05, unit: "%" },
  sfx: { min: 0, max: 1, step: 0.05, unit: "%" },
  zoom: { min: 0.7, max: 1.4, step: 0.05, unit: "x" },
  tilt: { min: -15, max: 15, step: 1, unit: "deg" },
};
export const RANGE = RANGES.lookX;

const clampTo = (k: NumKey, n: number) => Math.min(RANGES[k].max, Math.max(RANGES[k].min, n));

/** Whatever was stored (unknown: a hand-edited or older save) down to valid settings; a bad field falls back to its default. */
export function parseSettings(raw: unknown): Settings {
  const o: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw)) : {};
  const num = (k: NumKey) => { const v = o[k]; return typeof v === "number" && Number.isFinite(v) ? clampTo(k, v) : DEFAULTS[k]; };
  const flag = (k: "invertY" | "musicOn" | "sfxOn") => { const v = o[k]; return typeof v === "boolean" ? v : DEFAULTS[k]; };
  return {
    lookX: num("lookX"), lookY: num("lookY"), touch: num("touch"), invertY: flag("invertY"),
    touchX: num("touchX"), touchY: num("touchY"), brightness: num("brightness"),
    music: num("music"), sfx: num("sfx"), musicOn: flag("musicOn"), sfxOn: flag("sfxOn"),
    muted: Array.isArray(o.muted) ? o.muted.filter((m): m is string => typeof m === "string") : [],
    zoom: num("zoom"), tilt: num("tilt"),
  };
}

/** Loudness a sound piece should play at: 0 when its group or the piece itself is off. */
export function volumeOf(s: Settings, group: "music" | "sfx", piece?: string): number {
  if (!(group === "music" ? s.musicOn : s.sfxOn) || (piece && s.muted.includes(piece))) return 0;
  return s[group];
}
