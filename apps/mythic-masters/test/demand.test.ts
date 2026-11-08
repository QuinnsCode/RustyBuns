import { describe, expect, test } from "bun:test";
import { demandOf, reactionOf, thumbAt, type Outcome } from "../src/demand.ts";
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
