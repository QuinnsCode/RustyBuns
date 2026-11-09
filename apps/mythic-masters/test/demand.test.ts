import { describe, expect, test } from "bun:test";
import { deckDemandOf, demandOf, reactionOf, settingsLineOf, thumbAt, worldLineOf, type Back, type Outcome } from "../src/demand.ts";
import { newJourney } from "../src/journey.ts";
import { ROSTER } from "../src/roster.ts";

describe("the book's demands", () => {
  test("it keeps a ledger: the item counts what you have bound, names what you met, describes what you have not", () => {
    expect(demandOf(null)).toStartWith("Item 1:");
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    const fresh = demandOf(j);
    expect(fresh).toStartWith(`Item ${j.party.length + 1}:`);
    expect(fresh).toEndWith("Bring it.");
    const met = ROSTER.find((c) => !j.party.some((m) => m.id === c.id))!;
    j.seen.push(met.id);
    expect(demandOf(j)).toContain(met.name);
  });

  test("with every beast bound it goes quiet", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    j.journal = ROSTER.filter((c) => !j.party.some((m) => m.id === c.id)).map((c) => ({ ...j.party[0]!, id: c.id }));
    expect(demandOf(j)).toBe(`Item ${ROSTER.length + 1}: nothing. For now.`);
  });

  test("the thumbprint lands on the page, somewhere new each time", () => {
    const at = Array.from({ length: 12 }, (_, n) => thumbAt(n));
    for (const t of at) for (const v of [t.x, t.y]) expect(v).toBeWithin(0, 101);
    expect(new Set(at.map((t) => `${t.x},${t.y}`)).size).toBeGreaterThan(8);
    expect(thumbAt(5)).toEqual(thumbAt(5));
  });
});

describe("the book on a result note", () => {
  const j = newJourney(["hodag", "squonk", "jackalope"])!;
  test.each([
    [{ kind: "bound", item: 4, repeat: false }, "Item 4. Received.", false],
    [{ kind: "bound", item: 4, repeat: true }, "I have one of those.", true],
    [{ kind: "won", foe: "keeper" }, "A keeper is not an item. Item 4:", true],
    [{ kind: "won", foe: "wild" }, "You beat it and let it walk.", true],
    [{ kind: "down", next: true, deadly: false }, "This one can't fight.", false],
    [{ kind: "down", next: false, deadly: false }, "No creatures left to fight.", false],
    [{ kind: "versus" }, "Practice.", false],
  ] satisfies [Outcome, string, boolean][])("%o", (o, start, signed) => {
    const r = reactionOf(o, j);
    expect(r.ask).toStartWith(start);
    expect(r.signed).toBe(signed);
    expect(r.ask.length).toBeLessThan(120);
  });
});

describe("the book on the bestiary deck", () => {
  test("it wants the top card it does not have, by name, and keeps quiet once it has them all", () => {
    expect(deckDemandOf(null)).toEqual({ ask: `Item 1: the ${ROSTER[0]!.name}, top of this deck. Then the rest, in order.`, signed: true });
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    const top = ROSTER.find((c) => !j.party.some((m) => m.id === c.id))!;
    expect(deckDemandOf(j)).toEqual({ ask: `Item 4: the ${top.name}, top of my deck. Go and find it.`, signed: true });
    j.seen.push(top.id);
    expect(deckDemandOf(j).ask).toEndWith("You have seen it. Bring it.");
    j.journal = ROSTER.filter((c) => !j.party.some((m) => m.id === c.id)).map((c) => ({ ...j.party[0]!, id: c.id }));
    expect(deckDemandOf(j)).toEqual({ ask: "Every card in this deck is mine. Keep them in order.", signed: false });
  });

  test("the Settings card: a different note over a fight than on the title, and it notices the quill turned down", () => {
    const lines = [settingsLineOf({ paused: false, quillMuted: false }), settingsLineOf({ paused: true, quillMuted: false }), settingsLineOf({ paused: true, quillMuted: true })];
    expect(new Set(lines).size).toBe(3);
    expect(lines[2]).toContain("quill");
  });
});

describe("the book in the world's toast after a fight", () => {
  test("it enters a bind and names the next item, and sends you on from a cleared section", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    const sec = { kind: "cleared", section: "The Sunk Road", of: 12, mythic: "Jersey Devil" } as const;
    const cases: [Back, string][] = [
      [{ kind: "bound", repeat: false }, `Entered. ${demandOf(j)}`],
      [{ kind: "bound", repeat: true }, `A copy. I keep one of each. ${demandOf(j)}`],
      [{ ...sec, k: 2, beat: false }, "The Sunk Road, written in. The next stone is lit. Walk."],
      [{ ...sec, k: 10, beat: false }, "The Sunk Road, written in. The Jersey Devil is at the arena. Bring it."],
      [{ ...sec, k: 11, beat: true }, "The Sunk Road, written in. The roads are open. The Jersey Devil is not in my pages yet. Go back for it."],
    ];
    for (const [b, ask] of cases) expect(worldLineOf(b, j)).toEqual({ ask, signed: true });
  });
});
