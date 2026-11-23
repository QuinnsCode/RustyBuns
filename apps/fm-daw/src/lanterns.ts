// The lanterns in an open-air studio room (src/studio/lanterns.ts draws them): who carries each one, or where it was
// set down. A lantern nobody has moved stands where the room puts it (`Outdoor.lanterns`), so it isn't in here at all.
// The World keeps this beside the groove and says who got a lantern (two hands on one: the first in wins); a carrier
// who leaves drops theirs where their body last stood. It belongs to one room: when the sesh moves to another room
// the lanterns start over there.
//
// Pure, no DOM: the World applies each step and sends everyone the whole (small) state back.
import { arr, Bad, check, num, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { ROOM_M } from "./studio.ts";

/** How many lanterns a room may have. */
export const MAX_LANTERNS = 16;
const ROOM = str(64, { re: /^[a-z0-9-]+$/ });
const INDEX = num(0, MAX_LANTERNS - 1);
const AT = (v: unknown): [number, number, number] => { const [x, y, z] = arr(num(-ROOM_M, ROOM_M), 3, { min: 3 })(v); return [x, y, z]; };
const PEER = num(1, Infinity);

/** One lantern off its starting place: in someone's hand (their peer number), or standing at (x, y, z). */
const Lantern = (v: unknown): Lantern => check(obj({ by: PEER }), v) ?? obj({ at: AT })(v);
export type Lantern = { by: number } | { at: [number, number, number] };
/** A room's lanterns that have moved, by their index in the room's list. */
const Lanterns = obj({ room: ROOM, moved: rec(Lantern, MAX_LANTERNS) });
export type Lanterns = Of<typeof Lanterns>;

/** Page to world: take lantern `i` of `room`, or set the one in your hand down at `at`. */
export type LanternClient = { t: "lantern"; room: string; i: number; take: true } | { t: "lantern"; room: string; i: number; at: [number, number, number] };
/** World to page: every lantern that has moved, on joining and after each change. `you`: your number on the live line. */
export type LanternServer = { t: "lanterns"; lanterns: Lanterns; you?: number };
const tag = <T extends string>(t: T) => oneOf([t]);
const CLIENT: Guard<LanternClient>[] = [
  obj({ t: tag("lantern"), room: ROOM, i: INDEX, take: (v: unknown): true => { if (v !== true) throw new Bad("true"); return true; } }),
  obj({ t: tag("lantern"), room: ROOM, i: INDEX, at: AT }),
];
const SERVER = obj({ t: tag("lanterns"), lanterns: Lanterns, you: opt(PEER) });
export const decodeLanternClient = (v: unknown): LanternClient | null => CLIENT.reduce<LanternClient | null>((got, g) => got ?? check(g, v), null);
export const decodeLanternServer = (v: unknown): LanternServer | null => {
  const m = check(SERVER, v);
  return m ? { t: "lanterns", lanterns: m.lanterns, ...(m.you ? { you: m.you } : {}) } : null;
};
/** A saved state, fitted: anything that isn't one reads as every lantern where it started. */
export const sanitizeLanterns = (v: unknown): Lanterns => check(Lanterns, v) ?? noLanterns("");
export const noLanterns = (room: string): Lanterns => ({ room, moved: {} });

/** Who holds lantern `i`, if anyone. */
export const carrier = (ls: Lanterns, i: number): number | null => { const l = ls.moved[i]; return l && "by" in l ? l.by : null; };
/** The lantern a player carries, if any: one hand, one lantern. */
export const carried = (ls: Lanterns, peer: number): number | null => {
  for (const k of Object.keys(ls.moved)) if (carrier(ls, Number(k)) === peer) return Number(k);
  return null;
};

/**
 * Pure: the lanterns after `peer` did `m`, or the same object when they can't (someone else has it, their hand is
 * full, they set down one they don't hold). A step in another room than the one kept starts that room over first.
 */
export function applyLantern(ls: Lanterns, peer: number, m: LanternClient): Lanterns {
  const base = ls.room === m.room ? ls : noLanterns(m.room);
  if ("take" in m) {
    if (carrier(base, m.i) !== null || carried(base, peer) !== null) return ls;
    return { room: m.room, moved: { ...base.moved, [m.i]: { by: peer } } };
  }
  if (carrier(base, m.i) !== peer) return ls;
  return { room: m.room, moved: { ...base.moved, [m.i]: { at: m.at } } };
}

/**
 * A player left (or the room is saved with them in it): what they carried stands where they last stood, on the ground
 * there (`y` 0: the page lifts it onto a stage it lands on). With no body to go by it goes back where it started.
 */
export function dropLanterns(ls: Lanterns, peer: number, stood?: [number, number]): Lanterns {
  const i = carried(ls, peer);
  if (i === null) return ls;
  const moved = { ...ls.moved };
  if (stood) moved[i] = { at: [stood[0], 0, stood[1]] }; else delete moved[i];
  return { ...ls, moved };
}
