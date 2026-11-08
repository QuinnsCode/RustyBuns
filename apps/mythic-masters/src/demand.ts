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
 * them bound it is quiet, for now. A reply can turn it to one kind of beast. */
export function demandOf(j: Journey | null, roster: readonly Creature[] = ROSTER): string {
  if (!j) return "Item 1: all of them. Start with three.";
  const owned = new Set([...j.party, ...j.journal].map((m) => m.id)), item = owned.size + 1;
  // a reply can ask it to want one kind (book.ts `wants`): it does, while one of that kind is left
  const all = roster.filter((c) => !owned.has(c.id)), want = j.talk?.wants;
  const left = want && all.some((c) => c.archetype === want) ? all.filter((c) => c.archetype === want) : all;
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

/** How a fight ended, as far as the book cares. `item` is the ledger count after a bind. */
export type Outcome =
  | { kind: "bound"; item: number; repeat: boolean }
  | { kind: "won"; foe: "wild" | "keeper" | "mythic" | "deadly" }
  | { kind: "down"; next: boolean; deadly: boolean }
  | { kind: "versus" };

/** The book's line on a fight's result note (#3468), in the voice of docs/MARGIN-NOTES.md: a receipt for a bind, the
 * standing demand after a win that brought it nothing, an order to get up after a loss. `signed` when it is a demand. */
export function reactionOf(o: Outcome, j: Journey | null): { ask: string; signed: boolean } {
  switch (o.kind) {
    case "bound":
      if (o.repeat) return { ask: "I have one of those. Keep it. Bring me one I have not.", signed: true };
      return { ask: `Item ${o.item}. Received.${RECEIPTS[o.item % RECEIPTS.length]}`, signed: false };
    case "won":
      if (o.foe === "mythic") return { ask: "It ran. I have its smell on this page now. Go back for it.", signed: true };
      if (o.foe === "wild") return { ask: "You beat it and let it walk. That is not how a ledger works.", signed: true };
      if (o.foe === "keeper") return { ask: `A keeper is not an item. ${demandOf(j)}`, signed: true };
      return { ask: "Noted. Not entered.", signed: false };
    case "down":
      if (o.deadly) return { ask: "I said bring it. I did not say go and lie down near it.", signed: false };
      if (o.next) return { ask: "Get up. Send the next one.", signed: true };
      return { ask: "All of them, down. The ledger is patient. I am less so.", signed: false };
    case "versus":
      return { ask: "Practice. I keep no accounts of practice.", signed: false };
  }
}
const RECEIPTS = ["", " Late.", " Smaller than described.", " Wipe its feet.", "", " About time."];

/** The book's line on the bestiary deck: it wants the card on top, the first in the deck's order it does not have,
 * by name (the deck prints every name anyway). With every card bound it only keeps them in order. */
export function deckDemandOf(j: Journey | null, roster: readonly Creature[] = ROSTER): { ask: string; signed: boolean } {
  if (!j) return { ask: `Item 1: the ${roster[0]?.name ?? "first one"}, top of this deck. Then the rest, in order.`, signed: true };
  const owned = new Set([...j.party, ...j.journal].map((m) => m.id)), top = roster.find((c) => !owned.has(c.id));
  if (!top) return { ask: "Every card in this deck is mine. Keep them in order.", signed: false };
  const item = owned.size + 1;
  if (j.seen.includes(top.id)) return { ask: `Item ${item}: the ${top.name}, top of my deck. You have seen it. Bring it.`, signed: true };
  return { ask: `Item ${item}: the ${top.name}, top of my deck. Go and find it.`, signed: true };
}
