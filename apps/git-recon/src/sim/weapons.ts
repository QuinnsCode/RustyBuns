// The arsenal is git. Each weapon is a git operation, and shoots like what it does:
//   git commit        the rifle. Small, often; the magazine runs dry, but there's always another.
//   git add -A        the shotgun. Stages everything in front of you at once; up close it's a wall.
//   git fetch --all   the machine gun. Pulls from everywhere, fast; hold it and it climbs off target.
//   git clean -fdx    the flamethrower. Short reach; it sets guards alight and burns files down to nothing.
//   git push          the bazooka. One heavy round that shoves everything near where it lands.
//   git merge         the grenade. Lobbed over cover; two things become one crater.
//   git rebase        the sniper. Rewrites one target's history from across the map.
//   git cherry-pick   picks one target and follows it there.
//   git revert        undoes a guard: it's back where it was a few seconds ago, and has forgotten you.
//   git stash         thrown down, it's a box to hide behind, and the guards shoot at it instead of you.
//   git blame         tags a guard, so you see it through walls.
//   git reset --hard  a rare crate, not a starting weapon: wherever it lands, that yard is wiped clean.

export type WeaponId = "commit" | "add" | "fetch" | "clean" | "push" | "merge" | "rebase" | "cherry" | "revert" | "stash" | "blame" | "reset";

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
  /** Rounds you start with, the magazine included; -1 never runs out (you still reload). */
  ammo: number;
  /** Rounds a magazine holds, and seconds to put a fresh one in. */
  mag: number;
  reload: number;
  /** Radians of random spread. */
  spread: number;
  /** Seconds before it goes off by itself (a grenade's fuse; a bullet's range). */
  life: number;
  /** Blows up on whatever it touches first, or (false) bounces until its fuse runs out. */
  impact: boolean;
  /** Turns towards the target it picked when fired, in radians per second (0: flies straight). */
  homing: number;
  /** Rounds per trigger pull: a shotgun's pellets. */
  pellets: number;
  /** Fires while the trigger is held, not once per click. */
  auto: boolean;
  /** Radians of spread each shot adds while you keep firing (it cools off when you stop). */
  bloom: number;
  /** Seconds a soldier it hits burns for. */
  burn: number;
  /** How much of its damage a file takes: lines deleted per point. */
  wreck: number;
  /** Radians your aim kicks up when you fire it. */
  kick: number;
  effect?: Effect;
}

type Opt = "homing" | "pellets" | "auto" | "bloom" | "burn" | "wreck" | "kick";
const W = (w: Omit<Weapon, Opt> & Partial<Pick<Weapon, Opt>>): Weapon => ({
  homing: 0, pellets: 1, auto: false, bloom: 0, burn: 0, wreck: w.splash > 0 ? 1 : 0.1, kick: 0.01, ...w,
});

export const WEAPONS: Record<WeaponId, Weapon> = {
  commit: W({ id: "commit", mag: 30, reload: 1.5, cmd: "git commit", damage: 9, splash: 0, knock: 1.5, speed: 110, gravity: 0, cooldown: 0.11, ammo: -1, spread: 0.025, life: 0.9, impact: true, auto: true, kick: 0.004 }),
  add: W({ id: "add", mag: 6, reload: 2.2, cmd: "git add -A", damage: 12, splash: 0, knock: 2, speed: 95, gravity: 0, cooldown: 0.85, ammo: 20, spread: 0.075, life: 0.3, impact: true, pellets: 9, wreck: 0.3, kick: 0.06 }),
  fetch: W({ id: "fetch", mag: 60, reload: 2.8, cmd: "git fetch --all", damage: 7, splash: 0, knock: 1, speed: 125, gravity: 0, cooldown: 0.07, ammo: 120, spread: 0.012, life: 0.9, impact: true, auto: true, bloom: 0.01, kick: 0.006 }),
  clean: W({ id: "clean", mag: 80, reload: 2.4, cmd: "git clean -fdx", damage: 3, splash: 0, knock: 0.3, speed: 16, gravity: -3, cooldown: 0.05, ammo: 160, spread: 0.07, life: 0.55, impact: true, auto: true, burn: 2.5, wreck: 2.5, kick: 0 }),
  push: W({ id: "push", mag: 1, reload: 1.8, cmd: "git push", damage: 70, splash: 4.5, knock: 16, speed: 38, gravity: 2, cooldown: 1.0, ammo: 6, spread: 0, life: 4, impact: true, kick: 0.04 }),
  merge: W({ id: "merge", mag: 1, reload: 0.7, cmd: "git merge", damage: 75, splash: 5.5, knock: 11, speed: 21, gravity: 22, cooldown: 0.8, ammo: 5, spread: 0, life: 1.7, impact: false }),
  rebase: W({ id: "rebase", mag: 4, reload: 2.4, cmd: "git rebase -i", damage: 95, splash: 0, knock: 6, speed: 320, gravity: 0, cooldown: 1.3, ammo: 8, spread: 0, life: 1.2, impact: true, wreck: 0.3, kick: 0.05 }),
  cherry: W({ id: "cherry", mag: 2, reload: 1.8, cmd: "git cherry-pick", damage: 45, splash: 0, knock: 4, speed: 34, gravity: 0, cooldown: 0.9, ammo: 4, spread: 0, life: 3, impact: true, homing: 5 }),
  revert: W({ id: "revert", mag: 1, reload: 1.2, cmd: "git revert", damage: 10, splash: 0, knock: 0, speed: 90, gravity: 0, cooldown: 1.0, ammo: 3, spread: 0, life: 1, impact: true, effect: "revert" }),
  stash: W({ id: "stash", mag: 1, reload: 0.8, cmd: "git stash", damage: 0, splash: 0, knock: 0, speed: 14, gravity: 22, cooldown: 1.2, ammo: 2, spread: 0, life: 2, impact: true, effect: "stash" }),
  blame: W({ id: "blame", mag: 2, reload: 1.4, cmd: "git blame", damage: 5, splash: 0, knock: 0, speed: 200, gravity: 0, cooldown: 0.5, ammo: 4, spread: 0, life: 1, impact: true, effect: "blame" }),
  reset: W({ id: "reset", mag: 1, reload: 1.5, cmd: "git reset --hard", damage: 400, splash: 9, knock: 20, speed: 22, gravity: 22, cooldown: 1.5, ammo: 0, spread: 0, life: 2, impact: true, effect: "reset" }),
};

export const ORDER: WeaponId[] = ["commit", "add", "fetch", "clean", "push", "merge", "rebase", "cherry", "revert", "stash", "blame", "reset"];

/** The keys that pick each weapon in ORDER: 1-9, 0, then - and =. */
export const KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"];
export const keyLabel = (code: string) => ({ Minus: "-", Equal: "=" } as Record<string, string>)[code] ?? code.slice(5);

/** Damage at distance d from an explosion's centre. */
export function splashDamage(w: Weapon, d: number): number {
  if (w.splash <= 0 || d >= w.splash) return 0;
  return w.damage * (1 - d / w.splash);
}
