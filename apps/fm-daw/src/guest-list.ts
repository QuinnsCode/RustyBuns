// Qollab Studio's guest list (@rustybuns/util/guests): its roles, the sesh's four grants as permissions beside the list's own,
// and the studio's eqosys skin, so its panel looks like the jam room. `cansOf` reads someone's grants off the list.
import type { Skin } from "@rustybuns/util/skin";
import { can, type GuestList, type Role } from "@rustybuns/util/guests";
import { CANS, type Can } from "./grants.ts";

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
