// Roles: what you carry. You pick one for your next life: it takes effect when you respawn
// or start the next level, never mid-fight. Each role's first gun never runs out of spare
// magazines (you still reload it); the rest have what they start with, plus crates.
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
  committer: { id: "committer", name: "Committer", blurb: "rifle, shotgun, grenades, a stash to hide behind", weapons: ["commit", "add", "merge", "stash", "blame"] },
  maintainer: { id: "maintainer", name: "Maintainer", blurb: "machine gun, flamethrower, bazooka", weapons: ["fetch", "clean", "push", "stash"] },
  reviewer: { id: "reviewer", name: "Reviewer", blurb: "sniper, homing rounds, revert and blame", weapons: ["rebase", "commit", "cherry", "revert", "blame"] },
  releaser: { id: "releaser", name: "Releaser", blurb: "shotgun, bazooka, grenades, fire", weapons: ["add", "push", "merge", "clean"] },
};

export const ROLE_ORDER: RoleId[] = ["committer", "maintainer", "reviewer", "releaser"];

export const isRole = (id: unknown): id is RoleId => typeof id === "string" && id in ROLES;

/** The role after this one, for cycling through them with a key. */
export const nextRole = (id: RoleId): RoleId => ROLE_ORDER[(ROLE_ORDER.indexOf(id) + 1) % ROLE_ORDER.length]!;
