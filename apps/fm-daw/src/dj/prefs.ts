// The DJ's own settings for the decks, kept in this browser: the nudge amount, the locks (pitch faders, jog wheels,
// grabbing the waveform, loading onto a playing deck), how the waveform looks and what a grab on it does, and the
// keys. No DOM here but the one localStorage read and write, so the arithmetic and the key map test plainly.
//
// The nudge, as a club DJ program has it: a tap moves the track `nudgeMs` either way (one press, one move: hold it
// and nothing more happens, so it is spammed); the fast nudge is held, and while held the deck drifts ten nudges a
// second either way (a speed bend, let go and it's back).
import { bool, check, int, obj, oneOf, or, rec, str, type Of } from "@rustybuns/util/guard";
import type { Side } from "./engine.ts";
import { BEND_MAX } from "./player.ts";

/** What a key can do. `*A` / `*B` are per deck; nudge and fast are back (−) and on (+). */
export const ACTIONS = [
  "playA", "cueA", "hot1A", "hot2A", "hot3A", "hot4A", "nudgeBackA", "nudgeOnA", "fastBackA", "fastOnA",
  "playB", "cueB", "hot1B", "hot2B", "hot3B", "hot4B", "nudgeBackB", "nudgeOnB", "fastBackB", "fastOnB",
  "xLeft", "xRight",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Each action's key to start (KeyboardEvent.code). */
export const DEFAULT_KEYS: Record<Action, string> = {
  playA: "KeyQ", cueA: "KeyW", hot1A: "Digit1", hot2A: "Digit2", hot3A: "Digit3", hot4A: "Digit4",
  nudgeBackA: "KeyA", nudgeOnA: "KeyS", fastBackA: "KeyZ", fastOnA: "KeyX",
  playB: "KeyP", cueB: "KeyO", hot1B: "Digit7", hot2B: "Digit8", hot3B: "Digit9", hot4B: "Digit0",
  nudgeBackB: "KeyK", nudgeOnB: "KeyL", fastBackB: "Comma", fastOnB: "Period",
  xLeft: "ArrowLeft", xRight: "ArrowRight",
};

/** How each action reads in the key list. */
export const ACTION_LABEL: Record<Action, string> = {
  playA: "A play", cueA: "A cue", hot1A: "A hot cue 1", hot2A: "A hot cue 2", hot3A: "A hot cue 3", hot4A: "A hot cue 4",
  nudgeBackA: "A nudge back", nudgeOnA: "A nudge on", fastBackA: "A 10× nudge back (hold)", fastOnA: "A 10× nudge on (hold)",
  playB: "B play", cueB: "B cue", hot1B: "B hot cue 1", hot2B: "B hot cue 2", hot3B: "B hot cue 3", hot4B: "B hot cue 4",
  nudgeBackB: "B nudge back", nudgeOnB: "B nudge on", fastBackB: "B 10× nudge back (hold)", fastOnB: "B 10× nudge on (hold)",
  xLeft: "Crossfader left", xRight: "Crossfader right",
};

/** The nudge amount's range, ms a tap. */
export const NUDGE_MS = { min: 1, max: 200, start: 10 } as const;
/** The fast nudge: this many taps' worth a second while held. */
export const FAST_TIMES = 10;

export const Prefs = obj({
  nudgeMs: int(NUDGE_MS.min, NUDGE_MS.max, NUDGE_MS.start),
  /** The waveform coloured by its sound (bass one end of the deck's gradient, highs the other) or plain. */
  wave: or(oneOf(["tone", "plain"]), "tone"),
  /** A press on the close-up: VINYL holds the track under your hand and drags it (a scratch); SLIDE moves it and plays on. */
  grab: or(oneOf(["vinyl", "slide"]), "vinyl"),
  lockPitch: bool(false),
  lockJog: bool(false),
  lockWave: bool(false),
  lockLoad: bool(false),
  keys: or(rec(str(40), 64), {}),
});
export type Prefs = Of<typeof Prefs>;
export const DEFAULT_PREFS: Prefs = { nudgeMs: NUDGE_MS.start, wave: "tone", grab: "vinyl", lockPitch: false, lockJog: false, lockWave: false, lockLoad: false, keys: {} };

const KEY = "qdj.prefs";
export function loadPrefs(): Prefs {
  try { const s = localStorage.getItem(KEY); return (s && check(Prefs, JSON.parse(s))) || { ...DEFAULT_PREFS }; } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p: Prefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: this visit only */ } }

/** Every action's key: the DJ's own over the defaults. */
export function keysOf(p: Prefs): Record<Action, string> {
  const out = { ...DEFAULT_KEYS };
  for (const a of ACTIONS) { const k = p.keys[a]; if (k !== undefined) out[a] = k; }
  return out;
}
/** `action` on `code`: a key belongs to one action, so whatever had it lets go (its key is blank until set again). */
export function bindKey(p: Prefs, action: Action, code: string): Prefs {
  const now = keysOf(p), keys: Record<string, string> = {};
  for (const a of ACTIONS) { const k = a === action ? code : now[a] === code ? "" : now[a]; if (k !== DEFAULT_KEYS[a]) keys[a] = k; }
  return { ...p, keys };
}
/** The action on a key, or null. */
export function actionOf(p: Prefs, code: string): Action | null {
  const keys = keysOf(p);
  return ACTIONS.find((a) => keys[a] === code) ?? null;
}
/** An action's deck and what it does there (null for the crossfader's). */
export function deckAction(a: Action): { side: Side; what: string } | null {
  const m = /^(.+)([AB])$/.exec(a);
  return m ? { side: m[2] === "A" ? 0 : 1, what: m[1]! } : null;
}
/** A key as the list shows it: "Q", "1", "Left", "," . */
export function keyName(code: string): string {
  if (!code) return "—";
  const named: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", Backslash: "\\", Space: "Space" };
  return named[code] ?? code.replace(/^Key|^Digit|^Arrow|^Numpad/, (m) => (m === "Numpad" ? "Num " : ""));
}

/** A tap of the nudge: seconds the track moves, `dir` back (−1) or on (1). */
export const tapShift = (dir: -1 | 1, ms: number) => (dir * ms) / 1000;
/** The fast nudge held: the speed factor that drifts FAST_TIMES taps a second, no more than the jog's own bend. */
export const holdBend = (dir: -1 | 0 | 1, ms: number) => 1 + dir * Math.min(BEND_MAX, (FAST_TIMES * ms) / 1000);

// ---- the waveform's colours

/**
 * Each deck's gradient from bass to highs, as [stop 0..1, r, g, b]: deck A fire, from deep red through orange and
 * yellow to near white; deck B from a blue-green (the kick, the bass) to a whitish purple (the clap, the hats).
 */
export const TONE_STOPS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [[0, 170, 18, 8], [0.35, 255, 80, 16], [0.7, 255, 196, 52], [1, 255, 246, 214]],
  [[0, 18, 196, 160], [0.45, 70, 130, 255], [0.75, 170, 140, 255], [1, 238, 226, 255]],
];
/** Deck `side`'s colour at `t` (0 all bass, 1 all highs). */
export function toneRgb(side: Side, t: number): [number, number, number] {
  const s = TONE_STOPS[side]!, x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1]!, b = s[i]!;
    if (x <= b[0]) { const f = (x - a[0]) / (b[0] - a[0] || 1); return [0, 1, 2].map((k) => Math.round(a[k + 1]! + (b[k + 1]! - a[k + 1]!) * f)) as [number, number, number]; }
  }
  const l = s[s.length - 1]!;
  return [l[1], l[2], l[3]];
}
/** The colours a waveform is drawn in: this many steps of each deck's gradient. */
export const TONE_STEPS = 24;
export const TONE_LUT = ([0, 1] as const).map((side) => Array.from({ length: TONE_STEPS }, (_, i) => `rgb(${toneRgb(side, i / (TONE_STEPS - 1)).join(",")})`));
