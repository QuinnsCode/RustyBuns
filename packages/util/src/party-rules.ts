// A Qollab party's rules (#3881, #3903): every choice about who gets in and how the lobby runs is a setting, with today's
// behaviour as the default. The host sets them from the lobby's Settings (./lobby.ts); the party Durable Object
// (apps/eqosys/src/qollab/party.ts) keeps and enforces them. Who is blocked is the host's list, kept beside these, and
// `block` says what the list does; muting someone for yourself is the page's, never the party's (`hide` on `party()`).
import { bool, int, obj, oneOf, type Of } from "./guard.ts";

export const JOINS = ["friends", "friends-of-members", "anyone"] as const;
export const READY = ["everyone", "majority", "host"] as const;
export const CHAT = ["everyone", "host", "off"] as const;
export const MUTE = ["host", "everyone", "nobody"] as const;
export const REPORT = ["everyone", "host", "nobody"] as const;
export const INVITE = ["everyone", "host"] as const;
export const BLOCKS = ["out", "hidden"] as const;
/** The lifetimes Settings offers, in hours. A party lives at most a week. */
export const LIVES = [1, 3, 6, 12, 24, 72, 168] as const;

/** One party's rules. Each field is one control in the lobby's Settings. */
export const PartyRules = obj({
  /** Who may come in with the code alone: the host's eqosys friends, a friend of anyone already in, or anyone on the app.
   *  A party link (the code and the invite key) lets its holder in whatever this says: the link is the invitation. */
  join: oneOf(JOINS),
  /** Whether someone may still join once the host has started (they are handed the same room). */
  late: bool(),
  /** The most people in the party at once, the host included. */
  size: int(2, 50),
  /** Who must be ready before the host can start. */
  ready: oneOf(READY),
  /** Who may talk in the party's chat. */
  chat: oneOf(CHAT),
  /** Who may quiet a member for the whole party (and let them talk again). */
  mute: oneOf(MUTE),
  /** Who may report a member. */
  report: oneOf(REPORT),
  /** Who may bring people in: everyone's friends count for "friends of anyone in", and Copy link is theirs; or the host's alone. */
  invite: oneOf(INVITE),
  /** How long the party lives from when it was made, in hours. Shortened past its age, it ends now. */
  hours: oneOf(LIVES),
  /** What the host's block list does: keeps them out, or lets them in hidden from the host (and the host from them). */
  block: oneOf(BLOCKS),
});
export type PartyRules = Of<typeof PartyRules>;

/** A party's rules before the host changes any: how a party behaved before there were rules. */
export const defaultRules = (open = false): PartyRules => ({
  join: open ? "anyone" : "friends", late: true, size: 16, ready: "everyone", chat: "everyone",
  mute: "host", report: "everyone", invite: "everyone", hours: 24, block: "out",
});

/** The rules as people read them in Settings: one label and the words for each choice. */
export const RULE_TEXT = {
  join: { label: "Who can join by code", friends: "The host's friends", "friends-of-members": "Friends of anyone in the party", anyone: "Anyone with the code" },
  late: { label: "Late joiners", on: "Let in after the start", off: "Closed once started" },
  size: { label: "Party size" },
  ready: { label: "Start needs", everyone: "Everyone ready", majority: "Most ready", host: "Just the host" },
  chat: { label: "Chat", everyone: "Everyone talks", host: "Only the host", off: "Off" },
  mute: { label: "Mute for all", host: "The host", everyone: "Anyone in", nobody: "Nobody" },
  report: { label: "Who can report", everyone: "Anyone in", host: "The host", nobody: "Nobody" },
  invite: { label: "Who can hand out the link", everyone: "Anyone in", host: "The host" },
  hours: { label: "Party lasts", 1: "1 hour", 3: "3 hours", 6: "6 hours", 12: "12 hours", 24: "A day", 72: "3 days", 168: "A week" },
  block: { label: "Blocked people", out: "Kept out", hidden: "Let in, hidden" },
} as const;

/** Whether a member may do what a who-may rule covers: anyone, the host alone, or nobody. */
export const may = (rule: "everyone" | "host" | "nobody", host: boolean): boolean => rule === "everyone" || (rule === "host" && host);

/** Whether the start may go ahead: the ready rule, over everyone in but the host. */
export function readyEnough(rule: PartyRules["ready"], others: number, ready: number): boolean {
  if (rule === "host" || others === 0) return true;
  return rule === "everyone" ? ready >= others : ready * 2 > others;
}
