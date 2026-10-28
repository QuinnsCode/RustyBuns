// The player's control settings, kept per player in the browser. One live object that the input code reads on every
// event, so a change applies mid-battle. No DOM here: ui/controls-panel.ts edits it, the battle views read it.
// The look speeds and invert Y live in the shared Controls cog (@rustybuns/game-controls); this holds what only this game has.

import { DEFAULTS as LOOK_DEFAULTS, type Settings as Look } from "@rustybuns/game-controls";

export type Action = "forward" | "back" | "left" | "right" | "strike" | "use" | "mute";
export const ACTIONS: { id: Action; label: string }[] = [
  { id: "forward", label: "Move forward" }, { id: "back", label: "Move back" }, { id: "left", label: "Move left" }, { id: "right", label: "Move right" },
  { id: "strike", label: "Orbital strike" }, { id: "use", label: "Vehicle or special" }, { id: "mute", label: "Sound on/off" },
];

export type Settings = {
  invertX: boolean; // mouse and touch look turn the other way left/right
  fov: number; // the ground camera's field of view in degrees (sprinting widens it a little)
  fireToggle: boolean; // click once to start firing and again to stop, instead of holding
  leftHanded: boolean; // touch: the stick on the right, the buttons on the left
  keys: Record<Action, string>; // lower-case `KeyboardEvent.key` per action
};

export const DEFAULTS: Settings = {
  invertX: false, fov: 65, fireToggle: false, leftHanded: false,
  keys: { forward: "w", back: "s", left: "a", right: "d", strike: "q", use: "e", mute: "m" },
};
export const SETTINGS_KEY = "two-fronts-controls";
/** Keys the game keeps for itself (squad orders, letting go of the mouse). */
export const RESERVED = ["1", "2", "3", "4", "f", "escape"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && v >= lo && v <= hi ? v : d);
const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Settings from stored JSON: every field checked, anything missing, wrong or clashing falls back to its default. */
export function parseSettings(text: string | null): Settings {
  const d = DEFAULTS;
  let v: unknown = null;
  try { v = text ? JSON.parse(text) : null; } catch { /* a damaged save: start over */ }
  if (!isObj(v)) return { ...d, keys: { ...d.keys } };
  const stored = isObj(v.keys) ? v.keys : {};
  const keys = { ...d.keys };
  for (const a of ACTIONS) { const k = stored[a.id]; if (typeof k === "string" && k.length > 0 && k.length < 16) keys[a.id] = k; }
  const used = ACTIONS.map((a) => keys[a.id]);
  if (new Set(used).size !== used.length || used.some((k) => RESERVED.includes(k))) Object.assign(keys, d.keys);
  return {
    invertX: flag(v.invertX, d.invertX),
    fov: num(v.fov, 50, 100, d.fov), fireToggle: flag(v.fireToggle, d.fireToggle), leftHanded: flag(v.leftHanded, d.leftHanded), keys,
  };
}

const load = (): Settings => { try { return parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { return parseSettings(null); } };
const save = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private window: the settings last this visit */ } };

export const settings: Settings = load();
const listeners = new Set<() => void>();
const changed = () => { save(); listeners.forEach((f) => f()); };

/** Run `f` now and after every change; returns the way to stop. */
export function onSettings(f: () => void): () => void { listeners.add(f); f(); return () => { listeners.delete(f); }; }

/** The shared cog's look speeds and invert Y, set on mount and after every change. */
let look: Look = { ...LOOK_DEFAULTS };
export function setLook(l: Look) { look = l; }
export function setSettings(patch: Partial<Omit<Settings, "keys">>) { Object.assign(settings, patch); changed(); }
export function resetSettings() { Object.assign(settings, { ...DEFAULTS, keys: { ...DEFAULTS.keys } }); changed(); }

/** Bind `key` to `action`. Returns what is wrong, if anything: the other action already on that key, or a reserved key. */
export function rebind(action: Action, key: string): { clash: Action } | { reserved: true } | null {
  const k = key.toLowerCase();
  if (RESERVED.includes(k)) return { reserved: true };
  const other = ACTIONS.find((a) => a.id !== action && settings.keys[a.id] === k);
  if (other) return { clash: other.id };
  settings.keys[action] = k;
  changed();
  return null;
}

export const keyName = (k: string) => (k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k.replace(/^arrow/i, "").replace(/^./, (c) => c.toUpperCase()));

/** How far a look moves for a mouse or finger drag of (dx, dy) pixels: the turn to the left and the pitch up, in radians. */
export function lookTurn(dx: number, dy: number, per: "mouse" | "touch"): { yaw: number; pitch: number } {
  const base = per === "mouse" ? 0.0025 : 0.006;
  const kx = base * (per === "mouse" ? look.lookX : look.touch), ky = base * (per === "mouse" ? look.lookY : look.touch);
  return { yaw: -dx * kx * (settings.invertX ? -1 : 1), pitch: -dy * ky * (look.invertY ? -1 : 1) };
}
