// The book's own voice (#3278). There is no wizard: the Eldritch Compendium itself wants the earth's cryptids
// collected, and says so like a boss keeping accounts. Its demands are scrawled in its own hand over the printed
// page, numbered like a ledger and signed "the Book". And every page carries one rust-brown thumbprint, somewhere
// different each time it is opened, never explained: someone held this page. No DOM here; main.ts and page.ts draw it.
import { mulberry32 } from "@rustybuns/util";
import type { Archetype } from "./creatures.ts";
import type { Journey } from "./journey.ts";
import { ROSTER, type Creature } from "./roster.ts";

export const SIGNATURE = "the Book";

const LOOKS: Record<Archetype, string> = {
  skirmisher: "the quick one", flyer: "the one with wings", tank: "the heavy one", bruiser: "the one that hits back",
};

/** The book's next demand: item n is the next beast it wants bound, n counting the ones it already has. A beast you
 * have met it names; one you have not it only describes. With no journey it wants everything, and with all of
 * them bound it is quiet, for now. */
export function demandOf(j: Journey | null, roster: readonly Creature[] = ROSTER): string {
  if (!j) return "Item 1: all of them. Start with three.";
  const owned = new Set([...j.party, ...j.journal].map((m) => m.id)), item = owned.size + 1;
  const left = roster.filter((c) => !owned.has(c.id));
  const met = left.find((c) => j.seen.includes(c.id));
  if (met) return `Item ${item}: the ${met.name}. You saw it. You let it go. Bring it.`;
  const next = [...left].sort((a, b) => a.region - b.region)[0];
  if (!next) return `Item ${item}: nothing. For now.`;
  return `Item ${item}: ${LOOKS[next.archetype]}, ${next.fields[0]} in its blood. Bring it.`;
}

/** Where the thumbprint lands on the page opened for the `n`th time: near an edge (where a hand would hold it),
 * in percent of the page, turned and sized a little differently each time. */
export function thumbAt(n: number): { x: number; y: number; turn: number; size: number } {
  const r = mulberry32(0x7b1d14 + n * 977);
  const edge = Math.floor(r() * 4), along = 8 + r() * 84, inset = 3 + r() * 9;
  const [x, y] = edge === 0 ? [along, inset] : edge === 1 ? [100 - inset, along] : edge === 2 ? [along, 100 - inset] : [inset, along];
  return { x: Math.round(x), y: Math.round(y), turn: Math.round(r() * 360), size: Math.round(34 + r() * 14) };
}
