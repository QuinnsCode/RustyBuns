import { describe, expect, test } from "bun:test";
import { answer, holdOf, LINES, Lines, momentFor, notesOf, tally, type Beat, type Ctx } from "../src/book.ts";
import { loadJourney, newJourney, type Journey } from "../src/journey.ts";

/** Plays one beat: what the Book asks, then its answer to `reply`. */
function beat(j: Journey, b: Beat, reply: string, ctx: Ctx = {}) {
  const m = momentFor(b, j, ctx);
  if (!m) throw new Error(`the Book had nothing to say at ${b}`);
  return { m, got: answer(j, m, reply)! };
}

describe("the Book talks back", () => {
  test("a journey: each reply is kept, survives a reload, shades the ledger, and comes back regions later", () => {
    let j = newJourney(["hodag", "squonk", "jackalope"])!;
    beat(j, "open", "all");
    const bound = beat(j, "bind", "more", { n: 1, item: 4 });
    expect(bound.m.ask).toStartWith("Item 4.");
    expect(bound.got.named).toBe(true); // the first nickname: the Book writes it down next
    expect(momentFor("named", j)?.ask).toBe("I have written you down as the eager one. In pencil, for now. Pencil is a courtesy.");
    beat(j, "bind-fail", "go", { n: 1 });
    const down = beat(j, "downed", "plan", { n: 1, down: "Hodag" });
    expect(down.got.said).toBe("Then the plan is also on the ground.");
    tally(j, true);
    expect(tally(j, true)).toBe(2); // a second lost fight in a row is a streak
    beat(j, "streak", "run", { n: 1 });
    beat(j, "campfire", "thanks", { n: 1 });
    beat(j, "mythic", "enough", { n: 1, regionId: "pine-barrens", mythic: "Jersey Devil" });
    expect(notesOf(j)).toEqual(["Promised all of them.", "Wanted to let one go.", "Thinks beating one is enough."]);

    j = loadJourney(JSON.stringify(j))!; // the save keeps the conversation
    expect(j.talk?.said).toMatchObject({ open: "all", "bind-first": "more", "downed-first": "plan", "fail-1": "go" });

    // the second region's mythic quotes the first page back, word for word
    expect(momentFor("mythic", j, { n: 2, item: 7 })!.recall)
      .toBe(`On the first page you said, and I quote, "I'll bring you all of them." Item 7 says otherwise.`);
    // four regions on, the lake's own mythic answers what you said at the first one, ahead of the generic talks
    const lake = momentFor("mythic", j, { n: 5, regionId: "great-lakes-and-lake-champlain", mythic: "Champ" })!;
    expect(lake.talk.id).toBe("mythic-champ");
    expect(lake.recall).toBe("Four regions ago you said beating one was enough. The lake disagrees. It has a long memory.");
  });

  test("in a party the guests' pages hold until the host answers", () => {
    expect(holdOf({ host: false, hostName: "Ryan" })).toEqual({ canAnswer: false, note: "The Book is waiting on Ryan." });
    expect(holdOf({ host: true, hostName: "Ryan" }).canAnswer).toBe(true);
  });

  test("the lines file: a guard turns away a broken talk, and the Book never says the same line twice", () => {
    expect(() => Lines([{ id: "x", beat: "dinner", ask: "?", replies: [] }])).toThrow();
    const said = LINES.flatMap((t) => [t.ask, ...t.replies.map((r) => r.book), ...(t.recall ?? []).map((r) => r.line)]);
    expect(said.length).toBeGreaterThanOrEqual(100);
    expect(new Set(said).size).toBe(said.length);
    for (const t of LINES) for (const r of t.recall ?? []) {
      const [id, reply] = r.of.split(".");
      expect(LINES.find((x) => x.id === id)?.replies.some((x) => x.id === reply)).toBe(true);
    }
  });
});
