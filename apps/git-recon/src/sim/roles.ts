// Roles: what you carry. You pick one for your next life: it takes effect when you respawn
// or start the next level, never mid-fight. Each role's first gun never runs out of spare
// magazines (you still reload it); the rest have what they start with, plus crates. Every kit
// ends in the pistol, which never runs dry either, so nobody is ever without a gun.
// git reset --hard isn't anyone's: it's a crate you find.

import type { WeaponId } from "./weapons.ts";

export type RoleId = "committer" | "maintainer" | "reviewer" | "releaser";

export interface Role {
  id: RoleId;
  name: string;
  /** What it's for, in a few words. */
  blurb: string;
  /** What it carries; the first never runs dry. */
  weapons: WeaponId[];
}

export const ROLES: Record<RoleId, Role> = {
  committer: { id: "committer", name: "Committer", blurb: "rifle, shotgun, grenades, plasma, a stash to hide behind, a pistol", weapons: ["commit", "add", "merge", "squash", "stash", "blame", "amend"] },
  maintainer: { id: "maintainer", name: "Maintainer", blurb: "machine gun, flamethrower, bazooka, plasma, a pistol", weapons: ["fetch", "clean", "push", "squash", "stash", "amend"] },
  // The shotty-snipes kit: a sniper rifle for across the map and a shotgun for round the corner.
  reviewer: { id: "reviewer", name: "Reviewer", blurb: "sniper rifle, shotgun, homing rounds, revert and blame, a pistol for the last shot", weapons: ["rebase", "add", "cherry", "revert", "blame", "amend"] },
  releaser: { id: "releaser", name: "Releaser", blurb: "shotgun, bazooka, grenades, plasma, fire, a pistol", weapons: ["add", "push", "merge", "squash", "clean", "amend"] },
};

export const ROLE_ORDER: RoleId[] = ["committer", "maintainer", "reviewer", "releaser"];

export const isRole = (id: unknown): id is RoleId => typeof id === "string" && id in ROLES;

/** The role after this one, for cycling through them with a key. */
export const nextRole = (id: RoleId): RoleId => ROLE_ORDER[(ROLE_ORDER.indexOf(id) + 1) % ROLE_ORDER.length]!;
