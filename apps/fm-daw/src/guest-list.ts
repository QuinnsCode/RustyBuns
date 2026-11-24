// Qollab Studio's guest list (@rustybuns/util/guests): its roles, the sesh's four grants as permissions beside the list's own,
// and the studio's eqosys skin, so its panel looks like the jam room. `cansOf` reads someone's grants off the list.
// The sesh World keeps one list beside the grants (packages/desktop/world.ts): `GuestClient` asks it to act, `GuestServer`
// is the list it fans out and its answer to the asker. `mayHere` is who may do what with the list counted in.
import type { Skin } from "@rustybuns/util/skin";
import { bool, check, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { can, GuestAct, GuestList, rankOf, type Role } from "@rustybuns/util/guests";
import { CANS, may, type Can, type Grants } from "./grants.ts";
import type { Floor } from "./project.ts";

/** The studio's permissions and their words in the Roles tab: the grants of src/grants.ts. */
export const STUDIO_PERMS: Record<Can, string> = { play: "Play", edit: "Edit groove", mix: "Mix", lead: "Lead" };

export const STUDIO_ROLES: Role[] = [
  { id: "lead", name: "Co-lead", rank: 60, perms: ["play", "edit", "mix", "lead", "invite", "revoke", "block", "roles"] },
  { id: "band", name: "Band", rank: 40, perms: ["play", "edit", "mix", "invite"] },
  { id: "player", name: "Player", rank: 20, perms: ["play"] },
  { id: "listener", name: "Listener", rank: 0, perms: [] },
];

/** The jam room's look for every eqosys surface, the guest list's included. */
export const SKIN: Skin = { theme: {
  "--ui-bg": "rgba(21, 23, 27, 0.94)", "--ui-ink": "#f4f1ea", "--ui-dim": "#a9adb4", "--ui-line": "#3a3e45", "--ui-soft": "#23262c",
  "--ui-accent": "#ff6b4a", "--ui-on-accent": "#15171b", "--ui-radius": "14px", "--ui-radius-sm": "8px",
} };

/** What someone on the list may do in the sesh: the owner leads, a guest gets their role's grants, anyone else listens. */
export const cansOf = (l: GuestList, who: string): Can[] => CANS.filter((c) => can(l, who, c));

/** Whether this person may do this: someone on the list gets their role's grants, anyone else the sesh's grants and floor (src/grants.ts). */
export function mayHere(list: GuestList | null | undefined, g: Grants, floor: Floor, who: string | undefined, maker: boolean, c: Can, track?: number): boolean {
  if (list && who && list.guests[who]) return can(list, who, c);
  return may(g, floor, who, maker, c, track);
}

/** The list as `me` sees it: everyone, but only the invites they made or could take back (an invite code is a way in). */
export function listFor(l: GuestList, me: string | undefined): GuestList {
  if (me === l.owner) return l;
  const mine = me ? rankOf(l, me) : -1, mod = !!me && can(l, me, "revoke");
  return { ...l, invites: l.invites.filter((i) => i.by === me || (mod && rankOf(l, i.by) < mine)) };
}

/** Page to World: one act on the sesh's guest list. */
export const GuestClient = obj({ t: oneOf(["guest"]), a: GuestAct });
export type GuestClient = Of<typeof GuestClient>;
/** World to page: the list (on hello and on every change), or the World's answer to this page's last act. */
const GuestsMsg = obj({ t: oneOf(["guests"]), list: GuestList });
/** The answer to this page's last act: ok with the list as it now sees it, or why not. */
const GuestSaid = obj({ t: oneOf(["guest-said"]), ok: bool(), why: opt(str(200)), list: opt(GuestList) });
export type GuestServer = Of<typeof GuestsMsg> | Of<typeof GuestSaid>;
export const decodeGuestClient = (v: unknown): GuestClient | null => check(GuestClient, v);
export const decodeGuestServer = (v: unknown): GuestServer | null => check(GuestsMsg, v) ?? check(GuestSaid, v);
