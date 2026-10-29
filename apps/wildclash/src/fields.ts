// Fields: the energies a creature and its moves are made of. Twelve of them, our own chart.
// A matchup leans, it doesn't decide: +25% into a field it's strong against, -20% into one that resists it.
import { clamp } from "@rustybuns/util";

export const FIELDS = ["ember", "tide", "gale", "stone", "frost", "storm", "grove", "venom", "spirit", "shadow", "iron", "wild"] as const;
export type Field = (typeof FIELDS)[number];

/** What each field is strong against. Every field is strong against two to four and weak to at least one. */
export const STRONG: Record<Field, Field[]> = {
  ember: ["grove", "frost", "iron"],
  tide: ["ember", "stone"],
  gale: ["grove", "wild", "venom"],
  stone: ["ember", "storm", "gale"],
  frost: ["grove", "gale", "tide"],
  storm: ["tide", "gale", "iron"],
  grove: ["tide", "stone", "storm"],
  venom: ["grove", "wild", "spirit"],
  spirit: ["shadow", "venom"],
  shadow: ["spirit", "wild"],
  iron: ["frost", "stone", "shadow"],
  wild: ["iron", "frost", "shadow"],
};

/** Neighbouring fields: a creature can be taught (not born knowing) the moves of its fields' neighbours. */
export const KIN: Record<Field, Field[]> = {
  ember: ["stone", "storm"], tide: ["frost", "venom"], gale: ["storm", "spirit"], stone: ["iron", "wild"],
  frost: ["tide", "gale"], storm: ["gale", "ember"], grove: ["wild", "tide"], venom: ["shadow", "grove"],
  spirit: ["shadow", "gale"], shadow: ["spirit", "venom"], iron: ["stone", "ember"], wild: ["grove", "stone"],
};

/** What a field's hit leaves on the one it lands on (sim.ts `hit` applies these; guarded hits leave none,
 * except iron's, which is the one that gets through a guard). Small leans, so a matchup is still a fight. */
export const MARK: Record<Field, string> = {
  ember: "burns: a tenth more damage over three seconds",
  tide: "pushes: a fifth more knockback",
  gale: "lifts: the knockback sends higher",
  stone: "stacks: a third more launch %",
  frost: "chills: a third slower to run and turn for two seconds",
  storm: "shocks: a tenth of a second longer stunned",
  grove: "roots: no dash or jump for a second",
  venom: "poisons: a fifth more damage over five seconds",
  spirit: "drains: takes eight energy",
  shadow: "dreads: no super armour against it",
  iron: "pierces: a guarded hit does twice what it would",
  wild: "feeds: the hitter gains five more energy",
};

/** A field's colour: the radar on its card, its moves' trails and bursts. */
export const COLOR: Record<Field, number> = {
  ember: 0xff6b35, tide: 0x3d8bfd, gale: 0x9fe8e0, stone: 0xb8a07a, frost: 0xdff4ff, storm: 0xffd23f,
  grove: 0x58b85c, venom: 0xa05fd0, spirit: 0xcbb8ff, shadow: 0x6b4f8a, iron: 0x9aa4b0, wild: 0xc08850,
};

export function typeMul(field: Field, target: readonly Field[]): number {
  let m = 1;
  for (const t of target) {
    if (STRONG[field].includes(t)) m += 0.25;
    else if (STRONG[t].includes(field) || t === field) m -= 0.2;
  }
  return clamp(m, 0.8, 1.25);
}
