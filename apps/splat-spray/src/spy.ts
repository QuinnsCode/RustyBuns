// The spy story laid over the room: every round is a mission with a codename, the intel is
// hidden inside one ordinary thing, and how few shots you took decides your rank.
// Pure and seeded, so everyone in an online room reads the same briefing.

const FIRST = ["Velvet", "Midnight", "Silver", "Black", "Crimson", "Glass", "Iron", "Golden", "Quiet", "Paper", "Winter", "Copper"];
const SECOND = ["Sparrow", "Heron", "Lantern", "Monsoon", "Cipher", "Orchid", "Falcon", "Harbour", "Marble", "Tango", "Domino", "Riviera"];
const INTEL = [
  "The microfilm", "The cipher key", "The vault combination", "The stolen blueprints", "A coded letter",
  "The embassy keys", "The defector's diary", "A roll of undeveloped film", "The double agent's notebook", "The safe-house address",
];

/** A small, stable hash so a seed picks the same words on every page. */
function mix(seed: number, salt: number): number {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = <T>(list: readonly T[], seed: number, salt: number) => list[mix(seed, salt) % list.length]!;

const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");

export interface Briefing {
  /** "Operation Velvet Sparrow" */
  operation: string;
  /** "The microfilm is hidden in a red crayon." */
  objective: string;
}

export function briefing(seed: number, thing: string): Briefing {
  return {
    operation: `Operation ${pick(FIRST, seed, 1)} ${pick(SECOND, seed, 2)}`,
    objective: `${pick(INTEL, seed, 3)} is hidden in ${article(thing)} ${thing}.`,
  };
}

/** Fewest shots wins: the rank a find earns, best first. Wrong picks already count as shots. */
export const RANKS = [
  { most: 3, title: "Super Spy" },
  { most: 6, title: "Secret Agent" },
  { most: 10, title: "Special Agent" },
  { most: 16, title: "Field Agent" },
  { most: Infinity, title: "Rookie" },
] as const;

export const rank = (shots: number) => RANKS.find((r) => shots <= r.most)!.title;
