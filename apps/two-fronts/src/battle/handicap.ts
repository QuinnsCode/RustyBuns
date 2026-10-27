// How much more the AI side fields when a human leads the other. Measured with the scripted player
// in scripts/sim.ts (`--hero both --handicap 0,0.3,0.45,0.6`): at even forces the human wins about
// 73%, 60% against a foe with 30% more, and about 50% against 45% to 60% more. So the strategy
// layer hands the AI side this much more in armies and tickets, and the fight comes out even-ish.
// AI against AI gets nothing: the battle itself is tuned to lean to the defender (see sim.ts).
import type { BattleSpec, Side } from "./contract.ts";
import { other } from "./contract.ts";

export const HUMAN_HANDICAP = 0.45;

// The share more (0.45 = 45% more armies and tickets) the side a human is not on should field.
// Takes the spec so a mode or a hero's level can weigh in later; today every battle is the same.
export const humanHandicap = (_spec: Pick<BattleSpec, "hero" | "mode" | "heroLevel">): number => HUMAN_HANDICAP;

// The spec with `side` fielding `by` more: armies and tickets scaled, nothing else.
export function handicapped(spec: BattleSpec, side: Side, by: number): BattleSpec {
  if (by <= 0) return spec;
  return {
    ...spec,
    armies: { ...spec.armies, [side]: Math.round(spec.armies[side] * (1 + by)) },
    tickets: { ...spec.tickets, [side]: Math.round(spec.tickets[side] * (1 + by)) },
  };
}

// The spec a human will play: the AI side fields the human handicap more.
export const forHuman = (spec: BattleSpec): BattleSpec => handicapped(spec, other(spec.hero), humanHandicap(spec));
