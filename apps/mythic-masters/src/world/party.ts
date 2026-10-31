// Your party: the creatures you've collected walking the world, how far each has grown, and which one leads
// (walks the world and fights). You start with a few starters and the one you picked; a wild creature you
// beat joins you, and every win in the world grows the one that won it. Plain data, saved by src/world/view.ts.
import { clamp } from "@rustybuns/util";
import { int, obj, rec, str, type Of } from "@rustybuns/util/guard";
import type { Creature } from "../roster.ts";

/** One of each body: a skirmisher, a tank and a flyer from the first regions on the route. */
export const STARTERS = ["jackalope", "hodag", "mothman"] as const;

export const Party = obj({ lead: str(64), xp: rec(int(0, 1e9), 256) });
export type Party = Of<typeof Party>;

export const newParty = (pick?: string): Party => {
  const xp: Record<string, number> = Object.fromEntries(STARTERS.map((id) => [id, 0]));
  if (pick) xp[pick] ??= 0;
  return { lead: pick ?? STARTERS[0], xp };
};

/** Level from experience: 1 to start, 2 after one even win, then slower. */
export const levelOf = (xp: number) => 1 + Math.floor(Math.sqrt(xp / 6));
/** What a win over a creature of `level` is worth. */
export const xpFor = (level: number) => 4 + 2 * level;
/** Each level past the first is 4% on every stat, capped where the sim's stats stop. */
export function grown(c: Creature, level: number): Creature {
  const k = 1 + 0.04 * (level - 1), g = (v: number) => clamp(Math.round(v * k), 1, 255);
  const s = c.stats;
  return { ...c, stats: { vigor: g(s.vigor), might: g(s.might), guard: g(s.guard), focus: g(s.focus), will: g(s.will), speed: g(s.speed) } };
}

/** Adds a creature you beat; true when it's new to the party. */
export function collect(p: Party, id: string): boolean {
  if (id in p.xp) return false;
  p.xp[id] = 0;
  return true;
}
/** The lead grows from a win over a creature of `level`; its new level. */
export function win(p: Party, level: number): number {
  p.xp[p.lead] = (p.xp[p.lead] ?? 0) + xpFor(level);
  return levelOf(p.xp[p.lead]!);
}
