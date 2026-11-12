// The book's own voice (#3278). There is no wizard: the Eldritch Compendium itself wants the earth's cryptids
// collected, and says so like a boss keeping accounts. Its demands are scrawled in its own hand over the printed
// page, numbered like a ledger and signed "the Book". And every page carries one rust-brown thumbprint, somewhere
// different each time it is opened, never explained: someone held this page. No DOM here; main.ts and page.ts draw it.
import { mulberry32 } from "@rustybuns/util";
import type { Archetype } from "./creatures.ts";
import { cleared, hpOf, SECTIONS, sections, TRAIL_REGIONS, WITCH_SHEET, type Journey } from "./journey.ts";
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
      if (o.foe === "wild") return { ask: "You beat it, then you let it go. Next time, bind it.", signed: true };
      if (o.foe === "keeper") return { ask: `A keeper is not an item. ${demandOf(j)}`, signed: true };
      return { ask: "Noted. Not entered.", signed: false };
    case "down":
      // plain words on a loss: what happened and what to do next (the owner adds the Book's flair on top)
      if (o.deadly) return { ask: "You lost. Heal up and try again.", signed: false };
      if (o.next) return { ask: "This one can't fight. Send in the next.", signed: false };
      return { ask: "No creatures left to fight. Back to the last stone.", signed: false };
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

/** What a world fight left the book with, for the toast when you walk back out (#3912): a creature bound (`repeat`
 * when it already had one), or a section's keeper beaten or bound (`k`, `of` sections, `mythic` the region's own). */
export type Back =
  | { kind: "bound"; repeat: boolean }
  | { kind: "cleared"; section: string; k: number; of: number; mythic: string; beat: boolean };

/** The book's line in the world's toast after a fight: not the receipt (the result note gave that) but what it wants
 * next. A bind is entered and the next item named; a cleared section is written in and you are sent on to the next
 * stone, or to the arena once the last keeper is down; a mythic beaten and let go is wanted back. */
export function worldLineOf(b: Back, j: Journey | null): { ask: string; signed: boolean } {
  if (b.kind === "bound") return { ask: `${b.repeat ? "A copy. I keep one of each." : "Entered."} ${demandOf(j)}`, signed: true };
  if (b.beat) return { ask: `${b.section}, written in. The roads are open. The ${b.mythic} is not in my pages yet. Go back for it.`, signed: true };
  if (b.k >= b.of - 2) return { ask: `${b.section}, written in. The ${b.mythic} is at the arena. Bring it.`, signed: true };
  return { ask: `${b.section}, written in. The next stone is lit. Walk.`, signed: true };
}

/** The book's margin note on the Settings card, true for when it was opened: over a fight or the walk it is the pause,
 * and the book does not stop counting; with its quill turned down it is still writing; on the title, the keys. */
export function settingsLineOf(o: { paused: boolean; quillMuted: boolean }): string {
  if (o.quillMuted) return "You turned my quill down. I am still writing.";
  if (o.paused) return "Rest if you must. The ledger does not pause.";
  return "Move the keys where you like. The accounts stay where they are.";
}

/** A compendium chapter the Book writes its own line over (#4166): the line-up, the bestiary, the regions, the factions. */
export type Chapter = "lineup" | "bestiary" | "regions" | "factions";

/** The book's line at the head of a compendium chapter, about your record there instead of the shared demand: who you
 * lead with and who is hurt, the last beast you bound and where, the last page you wrote it, or the fights you keep
 * losing past it. No journey yet, every chapter wants the same thing: three, from the witch. */
export function pageLineOf(ch: Chapter, j: Journey | null, roster: readonly Creature[] = ROSTER): { ask: string; signed: boolean } {
  if (!j) return { ask: demandOf(null, roster), signed: true };
  const name = (id: string) => roster.find((c) => c.id === id)?.name ?? "that one";
  if (ch === "lineup") {
    const lead = j.party[0]!, down = j.party.find((m) => hpOf(m) <= 0), hurt = j.party.find((m) => hpOf(m) > 0 && hpOf(m) < 1);
    if (hpOf(lead) <= 0) return { ask: `The ${name(lead.id)} leads, flat on its back. Move it down or wake it.`, signed: true };
    if (down) return { ask: `The ${name(lead.id)} leads. The ${name(down.id)} is down. A fire, before you walk.`, signed: true };
    if (hurt) return { ask: `The ${name(lead.id)} leads. The ${name(hurt.id)} is dripping on my page.`, signed: false };
    return { ask: `The ${name(lead.id)} leads. Nobody is dripping. Go and earn the ink.`, signed: true };
  }
  if (ch === "bestiary") {
    const last = [...j.party, ...j.journal].filter((m) => m.caught && m.caught.where !== WITCH_SHEET).sort((a, b) => a.caught!.at - b.caught!.at).at(-1);
    if (!last) return { ask: "Three from the witch's sheet. You have not bound one yourself. Yet.", signed: true };
    const where = last.caught!.where.split(",")[0];
    return { ask: `Last in: the ${name(last.id)}${where ? `, ${where}` : ""}. The ink is dry. Next.`, signed: true };
  }
  if (ch === "factions") {
    // the ones behind you (src/factions/engine.ts): none yet, some, or quests they have closed on you
    const met = j.factions?.met.length ?? 0, done = j.factions?.done.length ?? 0;
    if (!met) return { ask: "Nobody follows you yet. Somebody will. They always bring forms.", signed: true };
    if (!done) return { ask: `${met === 1 ? "One of them has" : `${met} of them have`} found you. They want me. They may ask.`, signed: true };
    return { ask: `${done} of their little errands done. They still think they know what I am.`, signed: false };
  }
  // the last page you wrote it (pages are pushed as sections clear), and the fights you lost since
  const at = j.pages.at(-1)?.split(":").map(Number), g = at && TRAIL_REGIONS.find((r) => r.n === at[0]);
  const sec = g && sections(g)[at[1]!], losses = j.talk?.losses ?? 0;
  if (!g || !sec) return { ask: "Not one page written. The Pine Barrens are not going to walk themselves.", signed: true };
  if (losses >= 2) return { ask: `${losses} lost in a row past ${sec.name}. Same country, same mud. Mend them first.`, signed: true };
  if (cleared(j, g.n) >= SECTIONS) return { ask: `${g.name}, the last page. Its mythic's number is in here somewhere.`, signed: false };
  return { ask: `${sec.name}, ${g.name}: the last page you wrote me. Write the next.`, signed: true };
}
