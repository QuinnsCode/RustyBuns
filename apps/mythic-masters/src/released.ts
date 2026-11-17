// A cryptid you let go stays in the country you let it go in (#3031). One that outclasses the region's wild ones makes
// them stronger: a level more for every LIFT_STEP it stands over the region's own, LIFT_MAX at most. And every one
// hunts: its prey turns up less (a den that would hold one stands empty), and the kind opposite it keeps out of its way.
// Who hunts whom goes round the four kinds: a flyer stoops on a skirmisher, a skirmisher runs a bruiser ragged, a
// bruiser breaks a tank, a tank shrugs a flyer off and crushes it. The opposite is the kind two along.
// No three.js and no DOM: world/view.ts stirs the dens with it, the tests play it.
import { int, num, obj, str, type Of } from "@rustybuns/util/guard";
import type { Archetype } from "./creatures.ts";
import { LIFT_MAX, wildLevel } from "./world/seed.ts";

export const Released = obj({ id: str(64), level: int(1, 100), n: int(0, 64), at: num(0, 1e15) });
export type Released = Of<typeof Released>;

const CHAIN: readonly Archetype[] = ["flyer", "skirmisher", "bruiser", "tank"];
/** The kind `a` hunts, and the kind opposite it. */
export const preyOf = (a: Archetype) => CHAIN[(CHAIN.indexOf(a) + 1) % 4]!;
export const oppositeOf = (a: Archetype) => CHAIN[(CHAIN.indexOf(a) + 2) % 4]!;

/** Levels a released one must stand over a region's own wild ones for each level it lifts them. */
export const LIFT_STEP = 4;
/** How much rarer each released hunter makes its prey, and the kind opposite it; and the most any kind thins out. */
export const THIN = { prey: 0.35, opposite: 0.2, most: 0.75 } as const;

export interface Stir {
  /** Levels the region's wild ones gain. */ lift: number;
  /** Per kind, the share of its dens that stand empty. */ thin: Partial<Record<Archetype, number>>;
}
/** What the cryptids released in region `n` do to it; `kindOf` says a creature's kind. */
export function stirOf(released: readonly Released[], n: number, kindOf: (id: string) => Archetype): Stir {
  const own = wildLevel(n, 0.5), thin: Partial<Record<Archetype, number>> = {};
  let lift = 0;
  for (const r of released) {
    if (r.n !== n) continue;
    lift = Math.max(lift, Math.min(LIFT_MAX, Math.floor((r.level - own) / LIFT_STEP)));
    const a = kindOf(r.id), add = (k: Archetype, by: number) => { thin[k] = Math.min(THIN.most, (thin[k] ?? 0) + by); };
    add(preyOf(a), THIN.prey);
    add(oppositeOf(a), THIN.opposite);
  }
  return { lift, thin };
}

/** A roll in [0, 1) from a den's name: the same den always says the same. */
function roll(den: string): number {
  let h = 2166136261;
  for (let i = 0; i < den.length; i++) h = Math.imul(h ^ den.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A wild den as the released ones leave it: empty (no `id`) when its kind is hunted out there, or a few levels up. */
export function stir<W extends { den: string; id: string; region: number; level: number }>(c: W, s: Stir, kindOf: (id: string) => Archetype): W {
  if (!c.id) return c;
  if (roll(c.den) < (s.thin[kindOf(c.id)] ?? 0)) return { ...c, id: "" };
  return s.lift ? { ...c, level: c.level + s.lift } : c;
}
