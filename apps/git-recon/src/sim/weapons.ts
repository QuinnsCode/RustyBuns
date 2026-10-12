// The arsenal is git. Each weapon is a git operation, and shoots like what it does:
//   git commit   the rifle. Small, often, never runs out.
//   git push     the bazooka. One heavy round that shoves everything near where it lands.
//   git merge    the grenade. Lobbed over cover; two things become one crater.
//   git rebase   the sniper. Rewrites one target's history from across the map.

export type WeaponId = "commit" | "push" | "merge" | "rebase";

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
}

export const WEAPONS: Record<WeaponId, Weapon> = {
  commit: { id: "commit", cmd: "git commit", damage: 9, splash: 0, knock: 1.5, speed: 110, gravity: 0, cooldown: 0.11, ammo: -1, spread: 0.025, life: 0.9, impact: true },
  push: { id: "push", cmd: "git push", damage: 70, splash: 4.5, knock: 16, speed: 38, gravity: 2, cooldown: 1.0, ammo: 6, spread: 0, life: 4, impact: true },
  merge: { id: "merge", cmd: "git merge", damage: 75, splash: 5.5, knock: 11, speed: 21, gravity: 22, cooldown: 0.8, ammo: 5, spread: 0, life: 1.7, impact: false },
  rebase: { id: "rebase", cmd: "git rebase -i", damage: 95, splash: 0, knock: 6, speed: 320, gravity: 0, cooldown: 1.3, ammo: 8, spread: 0, life: 1.2, impact: true },
};

export const ORDER: WeaponId[] = ["commit", "push", "merge", "rebase"];

/** Damage at distance d from an explosion's centre. */
export function splashDamage(w: Weapon, d: number): number {
  if (w.splash <= 0 || d >= w.splash) return 0;
  return w.damage * (1 - d / w.splash);
}
