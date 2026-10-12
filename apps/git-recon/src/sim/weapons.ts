// The arsenal is git. Each weapon is a git operation, and shoots like what it does:
//   git commit        the rifle. Small, often, never runs out.
//   git push          the bazooka. One heavy round that shoves everything near where it lands.
//   git merge         the grenade. Lobbed over cover; two things become one crater.
//   git rebase        the sniper. Rewrites one target's history from across the map.
//   git cherry-pick   picks one target and follows it there.
//   git revert        undoes a guard: it's back where it was a few seconds ago, and has forgotten you.
//   git stash         thrown down, it's a box to hide behind, and the guards shoot at it instead of you.
//   git blame         tags a guard, so you see it through walls.
//   git reset --hard  a rare crate, not a starting weapon: wherever it lands, that yard is wiped clean.

export type WeaponId = "commit" | "push" | "merge" | "rebase" | "cherry" | "revert" | "stash" | "blame" | "reset";

/** What a round does besides damage. */
export type Effect = "revert" | "stash" | "blame" | "reset";

export interface Weapon {
  id: WeaponId;
  /** What the HUD calls it. */
  cmd: string;
  /** Damage at the point of impact. */
  damage: number;
  /** Splash radius in metres (0: hits only what it touches); damage falls off to nothing at the edge. */
  splash: number;
  /** Shove, in metres per second, at the centre of the splash or on a direct hit. */
  knock: number;
  speed: number;
  /** Metres per second squared pulling the round down. */
  gravity: number;
  /** Seconds between shots. */
  cooldown: number;
  /** Rounds you start with; -1 never runs out. */
  ammo: number;
  /** Radians of random spread. */
  spread: number;
  /** Seconds before it goes off by itself (a grenade's fuse; a bullet's range). */
  life: number;
  /** Blows up on whatever it touches first, or (false) bounces until its fuse runs out. */
  impact: boolean;
  /** Turns towards the target it picked when fired, in radians per second (0: flies straight). */
  homing: number;
  effect?: Effect;
}

const W = (w: Omit<Weapon, "homing"> & { homing?: number }): Weapon => ({ homing: 0, ...w });

export const WEAPONS: Record<WeaponId, Weapon> = {
  commit: W({ id: "commit", cmd: "git commit", damage: 9, splash: 0, knock: 1.5, speed: 110, gravity: 0, cooldown: 0.11, ammo: -1, spread: 0.025, life: 0.9, impact: true }),
  push: W({ id: "push", cmd: "git push", damage: 70, splash: 4.5, knock: 16, speed: 38, gravity: 2, cooldown: 1.0, ammo: 6, spread: 0, life: 4, impact: true }),
  merge: W({ id: "merge", cmd: "git merge", damage: 75, splash: 5.5, knock: 11, speed: 21, gravity: 22, cooldown: 0.8, ammo: 5, spread: 0, life: 1.7, impact: false }),
  rebase: W({ id: "rebase", cmd: "git rebase -i", damage: 95, splash: 0, knock: 6, speed: 320, gravity: 0, cooldown: 1.3, ammo: 8, spread: 0, life: 1.2, impact: true }),
  cherry: W({ id: "cherry", cmd: "git cherry-pick", damage: 45, splash: 0, knock: 4, speed: 34, gravity: 0, cooldown: 0.9, ammo: 4, spread: 0, life: 3, impact: true, homing: 5 }),
  revert: W({ id: "revert", cmd: "git revert", damage: 10, splash: 0, knock: 0, speed: 90, gravity: 0, cooldown: 1.0, ammo: 3, spread: 0, life: 1, impact: true, effect: "revert" }),
  stash: W({ id: "stash", cmd: "git stash", damage: 0, splash: 0, knock: 0, speed: 14, gravity: 22, cooldown: 1.2, ammo: 2, spread: 0, life: 2, impact: true, effect: "stash" }),
  blame: W({ id: "blame", cmd: "git blame", damage: 5, splash: 0, knock: 0, speed: 200, gravity: 0, cooldown: 0.5, ammo: 4, spread: 0, life: 1, impact: true, effect: "blame" }),
  reset: W({ id: "reset", cmd: "git reset --hard", damage: 400, splash: 9, knock: 20, speed: 22, gravity: 22, cooldown: 1.5, ammo: 0, spread: 0, life: 2, impact: true, effect: "reset" }),
};

export const ORDER: WeaponId[] = ["commit", "push", "merge", "rebase", "cherry", "revert", "stash", "blame", "reset"];

/** Damage at distance d from an explosion's centre. */
export function splashDamage(w: Weapon, d: number): number {
  if (w.splash <= 0 || d >= w.splash) return 0;
  return w.damage * (1 - d / w.splash);
}
