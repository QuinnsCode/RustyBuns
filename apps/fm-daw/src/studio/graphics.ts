// The 3D rooms' graphics settings (#6475): four presets and the knobs behind them, kept per browser, and music first
// vs picture first. Music first means the audio never drops out: when a frame takes too long or the audio clock falls
// behind, the picture steps down (render scale, then the shadows stop following, then a 30 fps cap) and steps back up
// once there's headroom, holding each level a few seconds so it never flickers. Picture first keeps the look and opens
// the audio with a bigger buffer (more latency). Pure: no DOM, no three.js; look.ts applies it and main.ts feeds it.
import { bool, check, int, num, obj, oneOf } from "@rustybuns/util/guard";
import type { Of } from "@rustybuns/util/guard";

export const PRESETS = ["low", "medium", "high", "ultra"] as const;
export type Preset = (typeof PRESETS)[number];
export const SHADOWS = ["off", "contact", "full"] as const;
export type Shadows = (typeof SHADOWS)[number];
/** Frames a second at most; 0 is uncapped (the screen's own rate). */
export const CAPS = [30, 60, 0] as const;
export const PRIORITIES = ["music", "picture"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** Every downlight in the room: what `lights` reads as on high. */
export const ALL_LIGHTS = 64;

export const Graphics = obj({
  /** The preset these knobs came from, or "custom" once a knob moved off it. */
  preset: oneOf([...PRESETS, "custom"] as const),
  /** The render's pixel ratio, at most (the screen's own caps it). */
  scale: num(0.5, 2),
  /** off: none, not even the shade baked under things; contact: that shade only; full: the cans throw shadows too. */
  shadows: oneOf(SHADOWS),
  bloom: bool(),
  /** The camera's lens: depth of field, fringing, vignette and grain. */
  lens: bool(),
  /** Filmic tone mapping (ACES); off is the plain clip. */
  tone: bool(),
  /** How many of the ceiling's downlights light the room (the rest glow): each costs every lit shader. */
  lights: int(1, ALL_LIGHTS),
  /** Dancers on an open-air floor. */
  crowd: int(0, 24),
  cap: oneOf(CAPS),
  priority: oneOf(PRIORITIES),
});
export type Graphics = Of<typeof Graphics>;

const base = { tone: true, priority: "music" } as const;
export const PRESET: Record<Preset, Graphics> = {
  low: { ...base, preset: "low", scale: 1, shadows: "contact", bloom: false, lens: false, lights: 4, crowd: 6, cap: 60 },
  medium: { ...base, preset: "medium", scale: 1, shadows: "contact", bloom: true, lens: false, lights: 8, crowd: 9, cap: 60 },
  high: { ...base, preset: "high", scale: 1.5, shadows: "full", bloom: true, lens: true, lights: ALL_LIGHTS, crowd: 12, cap: 0 },
  // high's look (#6397 is the ceiling) at the screen's full pixel ratio and the biggest crowd
  ultra: { ...base, preset: "ultra", scale: 2, shadows: "full", bloom: true, lens: true, lights: ALL_LIGHTS, crowd: 18, cap: 0 },
};

/** The look's two old settings, which the gear kit, the drums and the open air still build to: low is plain, high is the rest. */
export type Quality = "low" | "high";
export const qualityOf = (g: Graphics): Quality => (g.shadows !== "full" && !g.bloom && !g.lens ? "low" : "high");

/** A preset with this browser's priority kept. */
export const preset = (p: Preset, priority: Priority = "music"): Graphics => ({ ...PRESET[p], priority });
/** One knob moved: the preset name stays only while every knob still matches it. */
export function tweak(g: Graphics, change: Partial<Omit<Graphics, "preset">>): Graphics {
  const next = { ...g, ...change };
  const same = PRESETS.find((p) => (Object.keys(PRESET[p]) as (keyof Graphics)[]).every((k) => k === "preset" || k === "priority" || PRESET[p][k] === next[k]));
  return { ...next, preset: same ?? "custom" };
}

/**
 * The setting: ?quality= first (low, medium, high, ultra), then what this browser kept (the knobs as JSON, or the old
 * "low"/"high"), else high unless it's a phone.
 */
export function pickGraphics(search: string, stored: string | null, coarse: boolean): Graphics {
  let kept: Graphics | null = null;
  if (stored) {
    const old = PRESETS.find((p) => p === stored);
    if (old) kept = PRESET[old];
    else try { kept = check(Graphics, JSON.parse(stored)); } catch { /* not JSON: none kept */ }
  }
  const asked = PRESETS.find((p) => p === new URLSearchParams(search).get("quality"));
  if (asked) return preset(asked, kept?.priority);
  return kept ?? PRESET[coarse ? "low" : "high"];
}

// ---- music first: the step-down rule ----

/** How far the picture has stepped down for the music: 0 not at all, up to STEPS. */
export const STEPS = 3;
/** A level is held this long before the next change either way, so it never flickers. */
export const HOLD_MS = 3000;
/** Headroom must last this long before a step back up. */
export const CALM_MS = 5000;
/** A frame this slow (ms, averaged over the last half second) is trouble; this quick is headroom. */
export const SLOW_MS = 40, QUICK_MS = 22;
/** The audio's stress from 0 (safe) to 1 (dropping out): trouble at or over this, headroom under the second. */
export const AUDIO_BAD = 0.5, AUDIO_OK = 0.1;

export interface Govern { level: number; /** when the level last changed (ms) */ at: number; /** since when there's been headroom (ms), or null */ calm: number | null }
export interface Sample { now: number; frameMs: number; audio: number }
export const calm = (now: number): Govern => ({ level: 0, at: now - HOLD_MS, calm: null });

/** The next level, from the last one and what the frames and the audio say now. Picture first never steps down. */
export function govern(g: Govern, s: Sample, priority: Priority): Govern {
  if (priority === "picture") return g.level === 0 && g.calm === null ? g : { level: 0, at: s.now, calm: null };
  const held = s.now - g.at >= HOLD_MS;
  const trouble = s.audio >= AUDIO_BAD || s.frameMs > SLOW_MS;
  const room = s.audio < AUDIO_OK && s.frameMs < QUICK_MS;
  if (trouble) return held && g.level < STEPS ? { level: g.level + 1, at: s.now, calm: null } : { ...g, calm: null };
  if (!room) return g.calm === null ? g : { ...g, calm: null };
  const since = g.calm ?? s.now;
  if (held && g.level > 0 && s.now - since >= CALM_MS) return { level: g.level - 1, at: s.now, calm: null };
  return g.calm === since ? g : { ...g, calm: since };
}

/** What the renderer runs at, `level` steps down from `g`: the render scale first, then frozen shadows, then a 30 fps cap. */
export interface Running { scale: number; freezeShadows: boolean; cap: number }
export function stepped(g: Graphics, level: number): Running {
  const scale = level >= 1 ? Math.max(0.5, g.scale * (level >= 2 ? 0.5 : 0.75)) : g.scale;
  return { scale, freezeShadows: level >= 2 && g.shadows === "full", cap: level >= 3 && (g.cap === 0 || g.cap > 30) ? 30 : g.cap };
}
/** The small status shown while stepped down, or null at full. */
export function stepWords(level: number): string | null {
  return level === 0 ? null : `Picture stepped down for the music (${level} of ${STEPS})`;
}

/**
 * The audio's stress from its clock: how far `ctx.currentTime` fell behind the wall clock over a window (a missed
 * render quantum isn't counted), and any underruns the browser reports. 0 safe, 1 dropping out.
 */
export function audioStress(wallMs: number, audioMs: number, underruns: number): number {
  if (underruns > 0) return 1;
  if (wallMs < 200) return 0;
  return Math.min(1, Math.max(0, (0.98 - audioMs / wallMs) * 25));
}
