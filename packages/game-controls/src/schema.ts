// Every setting the Controls panel knows about, grouped into the sections a player can fold. Pure data, so a test
// reaches it without a page. A game turns a row on with `enable: [id]`; until then it shows greyed out ("not in this
// game"), so the whole list is visible everywhere and adding a feature to a game is one word, not a new row.
import type { IconName } from "./icons.ts";

export type Tab = "controls" | "audio";
export type Unit = "x" | "%" | "deg";

interface Base { id: string; label: string; icon: IconName }
export type Extra =
  | (Base & { kind: "slider"; def: number; min: number; max: number; step: number; unit: Unit })
  | (Base & { kind: "toggle"; def: boolean });

export interface SectionDef {
  id: string;
  tab: Tab;
  title: string;
  icon: IconName;
  /** Rows a game may enable (stored in `Settings.more`); greyed out when it hasn't. */
  rows: Extra[];
}

const slider = (id: string, label: string, icon: IconName, def: number, min: number, max: number, step: number, unit: Unit): Extra => ({ kind: "slider", id, label, icon, def, min, max, step, unit });
const toggle = (id: string, label: string, icon: IconName, def: boolean): Extra => ({ kind: "toggle", id, label, icon, def });

/** In display order. The built-in rows (look X/Y, touch, audio, view) are placed by panel.ts; these are the optional ones. */
export const SECTIONS: SectionDef[] = [
  { id: "keys", tab: "controls", title: "Keyboard", icon: "Keyboard", rows: [
    toggle("holdToggle", "Toggle instead of hold", "Hand", false),
  ] },
  { id: "lookX", tab: "controls", title: "X axis", icon: "MoveHorizontal", rows: [] },
  { id: "lookY", tab: "controls", title: "Y axis", icon: "MoveVertical", rows: [] },
  { id: "mouse", tab: "controls", title: "Mouse", icon: "Mouse", rows: [
    toggle("rawInput", "Raw mouse input", "Mouse", true),
    toggle("accel", "Mouse acceleration", "Gauge", false),
    slider("smoothing", "Look smoothing", "Waves", 0, 0, 1, 0.05, "%"),
  ] },
  { id: "touch", tab: "controls", title: "Touch", icon: "Smartphone", rows: [
    slider("stickSize", "Stick size", "Smartphone", 1, 0.6, 1.6, 0.05, "x"),
    toggle("leftHanded", "Left-handed layout", "Hand", false),
    toggle("touchHaptics", "Touch haptics", "Vibrate", true),
  ] },
  { id: "gamepad", tab: "controls", title: "Gamepad", icon: "Gamepad2", rows: [
    slider("stickDead", "Stick dead zone", "Gamepad2", 0.15, 0, 0.5, 0.01, "%"),
    slider("triggerAt", "Trigger threshold", "Gauge", 0.5, 0.05, 1, 0.05, "%"),
    toggle("swapSticks", "Swap sticks", "Gamepad2", false),
    toggle("padInvertY", "Invert stick Y", "MoveVertical", false),
    toggle("rumble", "Rumble", "Vibrate", true),
    slider("rumbleLevel", "Rumble strength", "Vibrate", 1, 0, 1, 0.05, "%"),
    slider("aimAssist", "Aim assist", "Crosshair", 0, 0, 1, 0.05, "%"),
  ] },
  { id: "vision", tab: "controls", title: "Vision", icon: "Eye", rows: [
    slider("fov", "Field of view", "Camera", 75, 60, 110, 1, "deg"),
    toggle("headBob", "Head bob", "Timer", true),
    slider("shake", "Screen shake", "Waves", 1, 0, 1, 0.05, "%"),
    toggle("motionBlur", "Motion blur", "Waves", false),
    toggle("reduceMotion", "Reduce motion", "Accessibility", false),
    slider("crosshair", "Crosshair size", "Crosshair", 1, 0.5, 2, 0.05, "x"),
    toggle("highContrast", "High contrast", "Contrast", false),
    slider("textSize", "Text size", "Eye", 1, 0.8, 1.6, 0.05, "x"),
  ] },
  { id: "game", tab: "controls", title: "This game", icon: "Puzzle", rows: [] },
  { id: "game", tab: "controls", title: "This game", icon: "Puzzle", rows: [] },
  { id: "music", tab: "audio", title: "Music", icon: "Music", rows: [] },
  { id: "fx", tab: "audio", title: "Effects", icon: "Volume2", rows: [] },
  { id: "mix", tab: "audio", title: "Mix and captions", icon: "Ear", rows: [
    slider("master", "Master volume", "Volume2", 1, 0, 1, 0.05, "%"),
    slider("ambient", "Ambience volume", "Waves", 1, 0, 1, 0.05, "%"),
    slider("voice", "Voice volume", "Volume2", 1, 0, 1, 0.05, "%"),
    toggle("mono", "Mono audio", "Ear", false),
    toggle("captions", "Captions", "Captions", false),
  ] },
];

export const section = (id: string): SectionDef => SECTIONS.find((s) => s.id === id)!;

/** Every optional row by id. */
export const EXTRAS: Record<string, Extra> = Object.fromEntries(SECTIONS.flatMap((s) => s.rows).map((r) => [r.id, r]));
