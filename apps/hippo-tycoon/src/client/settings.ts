import { DEFAULT_ROUND_SECS, type Difficulty } from "../sim/rules.ts";

export type Quality = "low" | "medium" | "high";
export const QUALITIES: readonly Quality[] = ["low", "medium", "high"];

export interface Settings {
  name: string; difficulty: Difficulty; secs: number;
  /** Everything off. */
  muted: boolean;
  /** The synth pulse under the game, and the effects (chomps, bellows, the finale, the jungle), each on its own. */
  music: boolean; effects: boolean;
  /** No shake, sway, fly-ins, flailing or bouncing text. null = follow the system's prefers-reduced-motion. */
  reducedMotion: boolean | null;
  /** Colour fringe, grain, scanline and vignette. The colour grade stays. */
  filmLook: boolean;
  quality: Quality;
  /** How many sit at this machine in a LAN or online game (one socket, that many seats). */
  players: 1 | 2;
}
const KEY = "hippo-tycoon.settings";
export const DEFAULTS: Settings = {
  name: "", difficulty: "normal", secs: DEFAULT_ROUND_SECS, muted: false,
  music: true, effects: true, reducedMotion: null, filmLook: true, quality: "high", players: 1,
};

/** Saved settings over the defaults; anything malformed falls back field by field. */
export function parseSettings(raw: string | null): Settings {
  let saved: Partial<Record<keyof Settings, unknown>> = {};
  try { const v = JSON.parse(raw ?? "{}"); if (v && typeof v === "object") saved = v; } catch { /* corrupt: defaults */ }
  const out = { ...DEFAULTS } as Record<keyof Settings, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const v = saved[k], d = DEFAULTS[k];
    if (k === "reducedMotion") { if (v === null || typeof v === "boolean") out[k] = v; }
    else if (k === "quality") { if (QUALITIES.includes(v as Quality)) out[k] = v; }
    else if (k === "players") { if (v === 1 || v === 2) out[k] = v; }
    else if (v !== undefined && typeof v === typeof d) out[k] = v;
  }
  return out as unknown as Settings;
}

export function loadSettings(): Settings {
  try { return parseSettings(localStorage.getItem(KEY)); } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: fine */ }
}
/** A name that is never empty, capped to what the LAN host accepts (1-32). */
export const nameOf = (s: Settings, fallback = "Tycoon") => (s.name.trim() || fallback).replace(/\p{C}/gu, "").slice(0, 32);

/** Whether the system asks for less motion (false where there is no window, as in tests). */
export function systemPrefersReducedMotion(): boolean {
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}
export const motionReduced = (s: Settings, system = systemPrefersReducedMotion()) => s.reducedMotion ?? system;

/** What the renderer needs from the settings. */
export interface ViewSettings { reducedMotion: boolean; filmLook: boolean; quality: Quality }
export const viewOf = (s: Settings, system = systemPrefersReducedMotion()): ViewSettings => ({ reducedMotion: motionReduced(s, system), filmLook: s.filmLook, quality: s.quality });

/** The quality presets: what each one turns down. */
export interface Preset {
  shadows: boolean; shadowMap: number;
  bloom: boolean;
  /** Fraction of the jungle's undergrowth, flowers and far palms that get planted. */
  foliage: number;
  /** Most geyser droplets alive at once (the fluid's own cap is 1400). */
  fluidCap: number;
  /** Most device pixels per CSS pixel. */
  pixelRatio: number;
}
export const PRESETS: Record<Quality, Preset> = {
  low: { shadows: false, shadowMap: 512, bloom: false, foliage: 0.35, fluidCap: 350, pixelRatio: 1 },
  medium: { shadows: true, shadowMap: 1024, bloom: true, foliage: 0.65, fluidCap: 800, pixelRatio: 1.5 },
  high: { shadows: true, shadowMap: 2048, bloom: true, foliage: 1, fluidCap: 1400, pixelRatio: 2 },
};
