import { DEFAULT_ROUND_SECS, type Difficulty } from "../sim/rules.ts";

export interface Settings { name: string; difficulty: Difficulty; secs: number; muted: boolean }
const KEY = "hippo-tycoon.settings";
export const DEFAULTS: Settings = { name: "", difficulty: "normal", secs: DEFAULT_ROUND_SECS, muted: false };

export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: fine */ }
}
/** A name that is never empty, capped to what the LAN host accepts (1-32). */
export const nameOf = (s: Settings, fallback = "Tycoon") => (s.name.trim() || fallback).replace(/\p{C}/gu, "").slice(0, 32);
