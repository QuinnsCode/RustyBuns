// How much more the AI side fields when a human leads the other, measured with the scripted
// player (scripts/balance.ts, with orders) against the defender-leaning battle in sim.ts. A human
// holding is worth a lot: at even forces the scripted defender won every one of 48 battles, 83%
// against an AI attacker with 45% more and 71% against twice the force (past about +35% the
// troop caps in sim.ts hold the attacker's numbers and only its tickets grow). 0.45 is the owner's
// figure from #2409; a person at the controls still wants a hands-on check. A human attacking a
// dug-in defender gets no handicap against them: the defender's ground already is one, and at even
// forces the scripted attacker won only about a fifth (it dies two or three times a battle).
// AI against AI gets nothing either way.
import type { BattleSpec, Side } from "./contract.ts";
import { other } from "./contract.ts";

export const HUMAN_HANDICAP = 0.45;    // on the AI attacker when the human defends
export const ATTACKER_HANDICAP = 0;    // on the AI defender when the human attacks

// The share more (0.45 = 45% more armies and tickets) the side a human is not on should field.
// Takes the spec so a mode or a hero's level can weigh in later; today only the hero's side does.
export const humanHandicap = (spec: Pick<BattleSpec, "hero" | "mode" | "heroLevel">): number =>
  spec.hero === "defender" ? HUMAN_HANDICAP : ATTACKER_HANDICAP;

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
