// Who may do what in a sesh. The sesh's maker is its leader; the leader grants each person (by their
// person id, src/chat.ts) what they can do: play (the live line, takes and the studio), edit (the groove),
// mix (the desk) or lead (grant others, set the floor and the code). No grant of their own, a person gets the
// floor's: Freezone lets everyone play, edit and mix, Hold only listen. Someone without a grant asks (a raised
// hand) and the leader answers Yes or No. The World checks every message against this; the page only shows it.
// Pure, so the World, the page and the tests share it.
import { arr, bool, check, int, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import { P, TRACKS } from "./engine/params.ts";
import type { ClientMsg, Floor, Op } from "./project.ts";

export const CANS = ["play", "edit", "mix", "lead"] as const;
export type Can = (typeof CANS)[number];
const CAN = oneOf(CANS);
/** People a sesh keeps a grant for; past it, a new grant is refused (the leader can take one back). */
export const MAX_GRANTED = 64;

const TRACK_LIST = arr(int(0, TRACKS - 1), TRACKS);
const ID = str(64, { re: /^[0-9a-f]{8,64}$/ });
const ids = <T>(of: Guard<T>, max: number): Guard<Record<string, T>> => (v) =>
  Object.fromEntries(Object.entries(rec(of, max)(v)).filter(([k]) => check(ID, k) !== null));
/**
 * `who`: each person with a grant of their own, and what it is (an empty list is listen only). `maker`: the
 * maker's person id, once they said hello. `handed`: the maker handed the lead on, so leading is the granted ones'.
 * `muted`: the people the leader muted for everyone: the World passes on none of their notes.
 * `tracks`: the people who may play only some tracks (by number), not the whole seat; set beside a grant without play.
 */
export const Grants = obj({
  who: ids(arr(CAN, CANS.length), MAX_GRANTED), maker: opt(ID), handed: opt(bool()), muted: opt(arr(ID, MAX_GRANTED)),
  tracks: opt(ids(TRACK_LIST, MAX_GRANTED)),
});
export type Grants = Of<typeof Grants>;
export const noGrants = (): Grants => ({ who: {} });
/** Stored or backed-up grants read back, or none. */
export const sanitizeGrants = (v: unknown): Grants => check(Grants, v) ?? noGrants();

/** The person ids that lead: the maker (unless they handed it on and someone has it), and everyone granted lead. */
export function leaders(g: Grants): string[] {
  const granted = Object.keys(g.who).filter((id) => g.who[id].includes("lead"));
  return g.maker && (!g.handed || !granted.length) && !granted.includes(g.maker) ? [g.maker, ...granted] : granted;
}

/**
 * Whether this person may do this. `maker`: the socket brought the maker's key (before their hello names them).
 * A leader may do everything; otherwise their own grant, or with none, the floor's. `track`: play on this track,
 * which a grant of some tracks (`tracks`) gives too.
 */
export function may(g: Grants, floor: Floor, who: string | undefined, maker: boolean, can: Can, track?: number): boolean {
  const lead = who ? leaders(g).includes(who) : maker && (!g.handed || !leaders(g).length);
  if (lead) return true;
  const own = who ? g.who[who] : undefined;
  if (own) return own.includes(can) || (can === "play" && track !== undefined && !!g.tracks?.[who!]?.includes(track));
  return floor === "free" && can !== "lead";
}

/** The tracks this person may play when it is some and not the whole seat, or null (all of them, or none). */
export const playTracks = (g: Grants, who: string): number[] | null =>
  g.who[who] && !g.who[who].includes("play") ? (g.tracks?.[who] ?? null) : null;

/**
 * The leader sets what this person may do (`can` in full: [] is listen only, null is back to the floor's), and
 * with `tracks`, which tracks they may play when `can` has no play (left out: the tracks they had stay theirs).
 */
export function grant(g: Grants, who: string, can: Can[] | null, tracks?: number[]): Grants {
  const who2 = { ...g.who };
  if (can === null) delete who2[who];
  else {
    if (!(who in who2) && Object.keys(who2).length >= MAX_GRANTED) return g;
    who2[who] = CANS.filter((c) => can.includes(c));
  }
  const keep = can !== null && !who2[who].includes("play") ? [...new Set(tracks ?? g.tracks?.[who] ?? [])].sort((a, b) => a - b) : [];
  const { tracks: had, ...rest } = g;
  const tracks2 = { ...had };
  if (keep.length) tracks2[who] = keep; else delete tracks2[who];
  const next: Grants = Object.keys(tracks2).length ? { ...rest, who: who2, tracks: tracks2 } : { ...rest, who: who2 };
  // nobody may take the last lead away: the maker gets it back
  if (g.handed && !leaders(next).length) delete next.handed;
  return next;
}

/** The lead handed on: `to` leads, and `from` (who handed it) no longer does. */
export function handOn(g: Grants, from: string, to: string): Grants {
  if (from === to) return g;
  let next = grant(g, to, [...new Set([...(g.who[to] ?? []), "lead" as const])]);
  if (from === g.maker) next = { ...next, handed: true };
  if (next.who[from]?.includes("lead")) next = grant(next, from, next.who[from].filter((c) => c !== "lead"));
  return next;
}

/** The leader mutes this person for everyone, or lets them be heard again. */
export function mute(g: Grants, who: string, on: boolean): Grants {
  const had = g.muted ?? [];
  if (had.includes(who) === on || (on && had.length >= MAX_GRANTED)) return g;
  const muted = on ? [...had, who] : had.filter((x) => x !== who);
  const { muted: _, ...rest } = g;
  return muted.length ? { ...rest, muted } : rest;
}
export const isMuted = (g: Grants, who: string | undefined) => !!who && !!g.muted?.includes(who);

/** A track's params that belong to the desk, not the patch: its level, pan, Space send and its own hi- and low-cut. */
export const MIX_PARAMS: readonly number[] = [P.GAIN, P.PAN, P.SEND, P.HICUT, P.LOCUT];

/** What an edit needs: the desk (mutes, solos, EQ, amps, levels, sends, space and squash, the room's level) is mix; the rest of the groove is edit. */
export function opNeeds(op: Op): Can {
  if (op.t === "param" && MIX_PARAMS.includes(op.i)) return "mix";
  if (op.t === "track" || op.t === "eq" || op.t === "eqAuto" || op.t === "eqPhase" || op.t === "amp") return "mix";
  if (op.t === "global" && op.bpm === undefined && op.swing === undefined && op.bars === undefined) return "mix";
  return "edit";
}

/** The track a live note or bend is on: a grant of some tracks lets these through on its tracks (takes stay edit). */
export function trackOf(m: ClientMsg): number | undefined {
  if (m.t === "live" && (m.e.t === "on" || m.e.t === "off" || m.e.t === "bend" || (m.e.t === "sound" && m.e.track >= 0))) return m.e.track;
  return undefined;
}

/** What a message from the page needs, or null when anyone may send it (a held room still lets a guest let go). */
export function needs(m: ClientMsg): Can | null {
  if (m.t === "op") return opNeeds(m.op);
  if (m.t === "init" || m.t === "takeBytes") return "edit";
  if (m.t === "floor" || m.t === "lock") return "lead";
  if (m.t === "rewind") return null;                // a look back is heard by its asker alone
  return "play";
}

/** Page to World: the leader grants (null: back to the floor's), hands on the lead or mutes someone; anyone asks; the leader answers. */
export type GrantClient =
  | { t: "grant"; who: string; can: Can[] | null; tracks?: number[] } | { t: "handOn"; who: string } | { t: "mute"; who: string; on: boolean }
  | { t: "ask"; can: Can } | { t: "answer"; who: string; yes: boolean };
/**
 * World to page: the grants, who has a hand up for what, who's in (person ids), and which person each live-line peer
 * number is (`peers`, so a page can name the person behind a note). Sent when anyone says hello or leaves, and on every change.
 */
export const GrantsMsg = obj({ t: oneOf(["grants"]), grants: Grants, asks: ids(CAN, 256), here: arr(ID, 256), peers: rec(ID, 256) });
export type GrantServer = Of<typeof GrantsMsg>;

const CLIENT: Guard<GrantClient>[] = [
  obj({ t: oneOf(["grant"]), who: ID, can: (v: unknown) => (v === null ? null : arr(CAN, CANS.length)(v)), tracks: opt(TRACK_LIST) }),
  obj({ t: oneOf(["handOn"]), who: ID }),
  obj({ t: oneOf(["mute"]), who: ID, on: bool() }),
  obj({ t: oneOf(["ask"]), can: CAN }),
  obj({ t: oneOf(["answer"]), who: ID, yes: bool() }),
];
export const decodeGrantClient = (v: unknown): GrantClient | null => CLIENT.reduce<GrantClient | null>((got, g) => got ?? check(g, v), null);
export const decodeGrantServer = (v: unknown): GrantServer | null => check(GrantsMsg, v);
