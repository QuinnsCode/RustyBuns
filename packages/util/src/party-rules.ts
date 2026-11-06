// A Qollab party's rules (#3881): every choice about who gets in and how the lobby runs is a setting, with today's
// behaviour as the default. The host sets them from the lobby's Settings (./lobby.ts); the party Durable Object
// (apps/eqosys/src/qollab/party.ts) keeps and enforces them. Who is blocked is the host's list, kept beside these;
// muting someone for yourself is the page's, never the party's (`hide` on `party()`).
import { bool, int, obj, oneOf, type Of } from "./guard.ts";

export const JOINS = ["friends", "friends-of-members", "anyone"] as const;
export const READY = ["everyone", "majority", "host"] as const;
export const CHAT = ["everyone", "host", "off"] as const;

/** One party's rules. Each field is one control in the lobby's Settings. */
export const PartyRules = obj({
  /** Who may come in: the host's eqosys friends, a friend of anyone already in, or anyone on the app with the code. */
  join: oneOf(JOINS),
  /** Whether someone may still join once the host has started (they are handed the same room). */
  late: bool(),
  /** The most people in the party at once, the host included. */
  size: int(2, 50),
  /** Who must be ready before the host can start. */
  ready: oneOf(READY),
  /** Who may talk in the party's chat. */
  chat: oneOf(CHAT),
});
export type PartyRules = Of<typeof PartyRules>;

/** A party's rules before the host changes any: how a party behaved before there were rules. */
export const defaultRules = (open = false): PartyRules => ({ join: open ? "anyone" : "friends", late: true, size: 16, ready: "everyone", chat: "everyone" });

/** The rules as people read them in Settings: one label and the words for each choice. */
export const RULE_TEXT = {
  join: { label: "Who can join", friends: "The host's friends", "friends-of-members": "Friends of anyone in the party", anyone: "Anyone with the code" },
  late: { label: "Late joiners", on: "Let in after the start", off: "Closed once started" },
  size: { label: "Party size" },
  ready: { label: "Start needs", everyone: "Everyone ready", majority: "Most ready", host: "Just the host" },
  chat: { label: "Chat", everyone: "Everyone talks", host: "Only the host", off: "Off" },
} as const;

/** Whether the start may go ahead: the ready rule, over everyone in but the host. */
export function readyEnough(rule: PartyRules["ready"], others: number, ready: number): boolean {
  if (rule === "host" || others === 0) return true;
  return rule === "everyone" ? ready >= others : ready * 2 > others;
}
