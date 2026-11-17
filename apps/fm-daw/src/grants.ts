// Who may do what in a sesh. The sesh's maker is its leader; the leader grants each person (by their
// person id, src/chat.ts) what they can do: play (the live line, takes and the studio), edit (the groove),
// mix (the desk) or lead (grant others, set the floor and the code). No grant of their own, a person gets the
// floor's: Freezone lets everyone play, edit and mix, Hold only listen. Someone without a grant asks (a raised
// hand) and the leader answers Yes or No. The World checks every message against this; the page only shows it.
// Pure, so the World, the page and the tests share it.
import { arr, bool, check, obj, oneOf, opt, rec, str, type Guard, type Of } from "@rustybuns/util/guard";
import type { ClientMsg, Floor, Op } from "./project.ts";

export const CANS = ["play", "edit", "mix", "lead"] as const;
export type Can = (typeof CANS)[number];
const CAN = oneOf(CANS);
/** People a sesh keeps a grant for; past it, a new grant is refused (the leader can take one back). */
export const MAX_GRANTED = 64;

const ID = str(64, { re: /^[0-9a-f]{8,64}$/ });
const ids = <T>(of: Guard<T>, max: number): Guard<Record<string, T>> => (v) =>
  Object.fromEntries(Object.entries(rec(of, max)(v)).filter(([k]) => check(ID, k) !== null));
/**
 * `who`: each person with a grant of their own, and what it is (an empty list is listen only). `maker`: the
 * maker's person id, once they said hello. `handed`: the maker handed the lead on, so leading is the granted ones'.
 */
export const Grants = obj({ who: ids(arr(CAN, CANS.length), MAX_GRANTED), maker: opt(ID), handed: opt(bool()) });
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
 * A leader may do everything; otherwise their own grant, or with none, the floor's.
 */
export function may(g: Grants, floor: Floor, who: string | undefined, maker: boolean, can: Can): boolean {
  const lead = who ? leaders(g).includes(who) : maker && (!g.handed || !leaders(g).length);
  if (lead) return true;
  const own = who ? g.who[who] : undefined;
  if (own) return own.includes(can);
  return floor === "free" && can !== "lead";
}

/** The leader sets what this person may do (`can` in full: [] is listen only, null is back to the floor's). */
export function grant(g: Grants, who: string, can: Can[] | null): Grants {
  const who2 = { ...g.who };
  if (can === null) delete who2[who];
  else {
    if (!(who in who2) && Object.keys(who2).length >= MAX_GRANTED) return g;
    who2[who] = CANS.filter((c) => can.includes(c));
  }
  const next = { ...g, who: who2 };
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

/** What an edit needs: the desk (mutes, solos, EQ, space and squash) is mix; the rest of the groove is edit. */
export function opNeeds(op: Op): Can {
  if (op.t === "track" || op.t === "eq" || op.t === "eqAuto" || op.t === "eqPhase") return "mix";
  if (op.t === "global" && op.bpm === undefined && op.swing === undefined && op.bars === undefined) return "mix";
  return "edit";
}

/** What a message from the page needs, or null when anyone may send it (a held room still lets a guest let go). */
export function needs(m: ClientMsg): Can | null {
  if (m.t === "op") return opNeeds(m.op);
  if (m.t === "init" || m.t === "takeBytes") return "edit";
  if (m.t === "floor" || m.t === "lock") return "lead";
  if (m.t === "rewind") return null;                // a look back is heard by its asker alone
  return "play";
}

/** Page to World: the leader grants (null: back to the floor's) or hands on the lead; anyone asks; the leader answers. */
export type GrantClient =
  | { t: "grant"; who: string; can: Can[] | null } | { t: "handOn"; who: string }
  | { t: "ask"; can: Can } | { t: "answer"; who: string; yes: boolean };
/** World to page: the grants, who has a hand up for what, and who's in (person ids). Sent when anyone says hello or leaves, and on every change. */
export const GrantsMsg = obj({ t: oneOf(["grants"]), grants: Grants, asks: ids(CAN, 256), here: arr(ID, 256) });
export type GrantServer = Of<typeof GrantsMsg>;

const CLIENT: Guard<GrantClient>[] = [
  obj({ t: oneOf(["grant"]), who: ID, can: (v: unknown) => (v === null ? null : arr(CAN, CANS.length)(v)) }),
  obj({ t: oneOf(["handOn"]), who: ID }),
  obj({ t: oneOf(["ask"]), can: CAN }),
  obj({ t: oneOf(["answer"]), who: ID, yes: bool() }),
];
export const decodeGrantClient = (v: unknown): GrantClient | null => CLIENT.reduce<GrantClient | null>((got, g) => got ?? check(g, v), null);
export const decodeGrantServer = (v: unknown): GrantServer | null => check(GrantsMsg, v);
