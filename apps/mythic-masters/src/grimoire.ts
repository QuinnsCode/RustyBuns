// The versus screen as a book. Players do not browse a list: their hand is a few ribbons (the journey's line-up),
// and the opponent is summoned in a circle for ink, with a chance the book misreads the page. The Librarian's key
// (admin) turns the book back into the whole roster, for debugging.
import { PARTY_FIRST, slots, STARTERS, type Journey } from "./journey.ts";
import type { Field } from "./fields.ts";
import type { Creature } from "./roster.ts";
import { bool, obj, oneOf, str, type Of } from "@rustybuns/util/guard";

/** Ink in the pot for one sitting; each summon spends one, and pressing Fight refills it. */
export const PAGE_INK = 3;
/** How often the book gets it wrong and turns to a random page, and how often the right beast comes sulking. */
export const MISREAD = 0.2, GRUMPY = 0.25;

/** Who is on your ribbons: the journey's line-up (as many as it has slots), or the loaned first three starters. */
export const handOf = (j: Journey | null): string[] => (j ? j.party.slice(0, slots(j)).map((m) => m.id) : STARTERS.slice(0, PARTY_FIRST));
export const ribbonsOf = (j: Journey | null) => (j ? slots(j) : PARTY_FIRST);

/** How well the player knows a beast: bound (in the line-up or the journal), seen (met, and not a shrouded unknown), or never met. */
export type Known = "bound" | "seen" | "unknown";
export const knownOf = (j: Journey, id: string, tier: string): Known =>
  [...j.party, ...j.journal].some((m) => m.id === id) ? "bound" : j.seen.includes(id) && tier !== "unknown" ? "seen" : "unknown";

/** Who the book can summon: on a journey only the beasts you have met or bound (the pages still blank stay shut);
 * with no journey, and under the Librarian's key, the whole roster. */
export const poolOf = (j: Journey | null, roster: readonly Creature[], tier: (id: string) => string, librarian = false): Creature[] =>
  j && !librarian ? roster.filter((c) => knownOf(j, c.id, tier(c.id)) !== "unknown") : [...roster];

export type Outcome = "arrives" | "grumpy" | "misread";
export interface Summoned { id: string; outcome: Outcome; line: string; signed: boolean }

// What the book says when something steps out of the ink. A line that wants something done is a demand, signed
// "the Book" on the versus spread; the rest are margin notes (docs/MARGIN-NOTES.md).
const LINES: Record<Outcome, [line: string, signed: boolean][]> = {
  arrives: [["It steps out of the ink, already looking for the exit.", false], ["Summoned, as written. The book is smug about it.", false], ["Practice on this one. Then bring me one I do not have.", true]],
  grumpy: [["It came, but it wants you to know it was mid-nap.", false], ["Present. Unimpressed. Please do not make eye contact.", false], ["It came mid-nap. Wake it properly. I want it on its feet.", true]],
  misread: [["The book read the wrong line and sends this instead. It says sorry. It does not mean it.", false], ["Smudged ink! You asked politely and got this.", false], ["A page stuck to another page. Enjoy the surprise.", false]],
};
export const blank = "The circle is cold. Choose a field, then spend some ink.";
/** The circle with nothing met to summon: the book wants something met first, so this one is signed. */
export const bare = "I have no page for that yet. Go and meet something first.";
export const dry = "The pot is dry. Pressing Fight will have the book fetch more.";

/** Draw a beast from `pool` for the circle of `field` (null for any): usually one of that field, sometimes a misread. */
export function summon(field: Field | null, roll: () => number, pool: readonly Creature[]): Summoned | null {
  if (!pool.length) return null;
  const pick = (from: readonly Creature[]) => from[Math.floor(roll() * from.length) % from.length]!;
  const of = field ? pool.filter((c) => c.fields.includes(field)) : pool;
  const outcome: Outcome = !of.length || roll() < MISREAD ? "misread" : roll() < GRUMPY ? "grumpy" : "arrives";
  const lines = LINES[outcome], [line, signed] = lines[Math.floor(roll() * lines.length) % lines.length]!;
  return { id: pick(outcome === "misread" ? pool : of).id, outcome, line, signed };
}


/** The last practice bout or duel off the versus screen, as the book remembers it (kept in localStorage by main.ts). */
export const Bout = obj({
  kind: oneOf(["practice", "duel", "watched"]),
  you: str(60), foe: str(60), won: bool(),
  how: oneOf(["hp", "ring-out", "time", "none"], "none"),
});
export type Bout = Of<typeof Bout>;

const HOW: Record<Bout["how"], [verb: string, after: string]> = { hp: ["put", " down"], "ring-out": ["threw", " out of the ring"], time: ["outlasted", " on the clock"], none: ["beat", ""] };
const TAIL = {
  practice: ["Practice. Not entered.", "I keep no accounts of practice. I kept that one."],
  duel: ["Practice, with a witness. Still not entered.", "A friend did that. I will not be writing it down."],
} as const;

/** The book's line in the circle on the versus spread: what the last summon brought, else why nothing came; before any
 * summon, what became of your last bout or duel here and the book's view of it (#4276 round 11), else the instruction. */
export function circleLineOf(s: Summoned | null, bareLine: boolean, ink: number, last: Bout | null = null): { ask: string; signed: boolean } {
  if (s) return { ask: s.line, signed: s.signed };
  if (bareLine) return { ask: bare, signed: true };
  return { ask: ink <= 0 ? dry : last ? boutLineOf(last) : blank, signed: false };
}
function boutLineOf(last: Bout): string {
  const watched = last.kind === "watched";
  const mine = `${watched ? "the" : "your"} ${last.you}`, theirs = `${last.kind === "duel" ? "your friend's" : "the"} ${last.foe}`;
  const [w, l] = last.won ? [mine, theirs] : [theirs, mine], [verb, after] = HOW[last.how];
  const said = `${w[0]!.toUpperCase()}${w.slice(1)} ${verb} ${l}${after}.`;
  return `${said} ${last.kind === "watched" ? "You only watched. Watching fills no ledger." : TAIL[last.kind][last.won ? 0 : 1]}`;
}
