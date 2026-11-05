// Fields: the energies a creature and its moves are made of. Twelve of them, our own chart.
// A matchup leans, it doesn't decide: +12.5% into a field it's strong against, -10% into one that resists it. At twice
// that, one lean in each direction made a fight between bots a lock (#3501).
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

/** A field's glyph: lucide-style 24x24 paths (the elemental HUD, the field chart). */
export const GLYPH: Record<Field, string> = {
  ember: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.4 1-3 0 1.7 1 2.5 2.5 2.5z"/>',
  tide: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  gale: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  stone: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  frost: '<path d="M2 12h20M12 2v20m-7-5 14-10M5 7l14 10"/>',
  storm: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  grove: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.5 6-7"/>',
  venom: '<circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><path d="M8 20v2h8v-2"/><path d="M12.5 17h-1"/><path d="M16 20a2 2 0 0 0 1.6-3.2A8 8 0 1 0 6.4 16.8 2 2 0 0 0 8 20"/>',
  spirit: '<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
  shadow: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  iron: '<path d="M20 13c0 5-3.5 7.5-7.7 8.9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
  wild: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.8 1.2c-.4-1.2-1.5-1.6-2.7-2A3.5 3.5 0 0 1 5.5 11c1.4 0 2.5-.2 3.5-1z"/>',
};

/** A field's colour as CSS. */
export const hex = (f: Field) => `#${COLOR[f].toString(16).padStart(6, "0")}`;

export function typeMul(field: Field, target: readonly Field[]): number {
  let m = 1;
  for (const t of target) {
    if (STRONG[field].includes(t)) m += 0.125;
    else if (STRONG[t].includes(field) || t === field) m -= 0.1;
  }
  return clamp(m, 0.9, 1.125);
}
