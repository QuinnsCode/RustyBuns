// Flick profiles: which stroke on the flick pad does which trick, as data. A profile is a list of strokes, each
// "start here, drag that way (or tap), this far" and what it does: pop an ollie or a nollie, flick a trick, or both.
// The pad shows the profile's board with its strokes drawn on like footprint grip tape (griptape.ts), so a player
// can read the paths off the deck. gesture.ts resolves a drag through whichever profile is in use; flick-profiles.ts
// holds the library, and a page can be handed its own through `?flick=` (see `pickProfile`).
import { type Flick, type Stance, TRICKS } from "./tricks.ts";
import { arr, Bad, check, maybe, num, obj, oneOf, raw, str, type Guard } from "@rustybuns/util/guard";

export type Pop = "ollie" | "nollie";
/** Where a press lands on the pad's board: its nose end, its tail end, or anywhere else (the middle, or off it). */
export type Zone = "nose" | "tail" | "mid";

export type Stroke = {
  from: Zone | "any";
  /** Degrees, screen up is 90 and right is 0; or "tap": down and up again without moving, quicker than a manual hold. */
  dir: number | "tap";
  spread?: number; // degrees either side of `dir` that still count (22.5 by default)
  min?: number; // pixels of drag at least (the profile's `minDrag` by default)
  max?: number; // pixels at most
  pop?: Pop;
  flick?: Flick;
};

export type Profile = {
  name: string;
  about: string; // one line: how to ride it
  side: "right" | "left"; // which half of a touch screen is the flick pad; the stick takes the other
  stance: Stance; // which foot forward the layout is drawn for; the sim names spins frontside or backside by it
  minDrag: number; // pixels before a press is a drag
  hold: number; // seconds a press stays put before it is a manual
  nudge: number; // pixels down while holding: a nose manual instead
  nose: number; // share of the pad's board, from each end, that counts as the nose or the tail
  tail: number;
  strokes: Stroke[];
};

export type Resolved = { jump?: boolean; nollie?: boolean; flick?: Flick };

const SPREAD = 22.5;

/** The angle of a drag, screen up 90, in 0..360. */
export const angleOf = (dx: number, dy: number) => ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
const gap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };

/** Which part of the pad's board a press is on, from where it lands along the board: 0 at the nose, 1 at the tail (null: off the board). */
export function zoneAt(p: Pick<Profile, "nose" | "tail">, along: number | null): Zone {
  if (along === null || along < 0 || along > 1) return "mid";
  return along <= p.nose ? "nose" : along >= 1 - p.tail ? "tail" : "mid";
}

/** The first stroke in `p` that a press from `zone`, dragged `dx, dy` pixels (y down) over `secs` seconds, matches. */
export function matchStroke(p: Profile, zone: Zone, dx: number, dy: number, secs: number): Stroke | null {
  const len = Math.hypot(dx, dy), tap = len < p.minDrag && secs < p.hold, angle = angleOf(dx, dy);
  for (const s of p.strokes) {
    if (s.from !== "any" && s.from !== zone) continue;
    if (s.dir === "tap") { if (tap) return s; continue; }
    if (len < (s.min ?? p.minDrag) || len > (s.max ?? Infinity)) continue;
    if (gap(angle, s.dir) <= (s.spread ?? SPREAD)) return s;
  }
  return null;
}

/** What a stroke asks the sim for. */
export function strokeInput(s: Stroke | null): Resolved {
  if (!s) return {};
  const out: Resolved = {};
  if (s.pop === "ollie") out.jump = true;
  if (s.pop === "nollie") out.nollie = true;
  if (s.flick) out.flick = s.flick;
  return out;
}

/** The same profile for the other foot forward: every drag mirrored left to right, and the stance swapped. */
export const mirror = (p: Profile, name: string, about = p.about): Profile => ({
  ...p, name, about, stance: p.stance === "regular" ? "goofy" : "regular", strokes: p.strokes.map((s) => (s.dir === "tap" ? s : { ...s, dir: (540 - s.dir) % 360 })),
});

/** The same strokes `k` times as long, for a smaller or bigger screen. */
export const scaled = (p: Profile, k: number, name: string, about: string): Profile => ({
  ...p, name, about, minDrag: p.minDrag * k, nudge: p.nudge * k,
  strokes: p.strokes.map((s) => ({ ...s, ...(s.min !== undefined && { min: s.min * k }), ...(s.max !== undefined && { max: s.max * k }) })),
});

// Reading a profile handed in from outside (the address or the browser's storage): every field checked, nothing assumed.
const isFlick = (v: unknown): v is Flick => typeof v === "string" && Object.hasOwn(TRICKS, v);
/** A trick name, as the guards read one. */
export const flick: Guard<Flick> = (v) => { if (isFlick(v)) return v; throw new Bad("a trick"); };
const StrokeIn = obj({
  from: oneOf(["nose", "tail", "mid", "any"]),
  dir: (v: unknown): number | "tap" => (v === "tap" ? "tap" : num(0, 360)(v)),
  spread: maybe(num(0, 180)), min: maybe(num(0, 2000)), max: maybe(num(0, 2000)),
  pop: maybe(oneOf(["ollie", "nollie"])), flick: maybe(flick),
});
const ProfileIn = obj({
  strokes: arr(raw, 200), name: str(40, { dflt: "custom" }), about: str(200, { min: 0, dflt: "" }),
  side: maybe(oneOf(["left", "right"])), stance: maybe(oneOf(["regular", "goofy"])),
  minDrag: maybe(num(4, 400)), hold: maybe(num(0.05, 2)), nudge: maybe(num(1, 400)), nose: maybe(num(0, 0.5)), tail: maybe(num(0, 0.5)),
});

/** A stroke that does something (pops or flicks), or null. */
function parseStroke(v: unknown): Stroke | null {
  const s = check(StrokeIn, v);
  return s && (s.pop || s.flick) ? s : null;
}

/** A profile from JSON-ish data, filling what it leaves out from `base`. Null if it has no strokes that do anything. */
export function parseProfile(v: unknown, base: Profile): Profile | null {
  const p = check(ProfileIn, v);
  const strokes = (p?.strokes ?? []).flatMap((s) => parseStroke(s) ?? []);
  if (!p || !strokes.length) return null;
  return {
    name: p.name, about: p.about, side: p.side ?? base.side, stance: p.stance ?? base.stance,
    minDrag: p.minDrag ?? base.minDrag, hold: p.hold ?? base.hold, nudge: p.nudge ?? base.nudge,
    nose: p.nose ?? base.nose, tail: p.tail ?? base.tail, strokes,
  };
}

const fromJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return null; } };
const fromB64 = (text: string): unknown => { try { return fromJson(atob(text.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; } };

/** The profile to ride: `?flick=<name>` from the library, or `?flick=` a profile as JSON (or base64url JSON); else what
 * the player picked last (`stored`, a name or JSON); else the first in the library. */
export function pickProfile(library: Profile[], param: string | null, stored: string | null): Profile {
  for (const v of [param, stored]) {
    if (!v) continue;
    const named = library.find((p) => p.name === v);
    if (named) return named;
    const custom = parseProfile(v.trimStart().startsWith("{") ? fromJson(v) : fromB64(v), library[0]);
    if (custom) return custom;
  }
  return library[0];
}
