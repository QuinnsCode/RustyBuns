import { describe, expect, test } from "bun:test";
import { answer, holdOf, LINES, Lines, momentFor, type Beat, type Ctx } from "../src/book.ts";
import { loadJourney, newJourney, type Journey } from "../src/journey.ts";

/** Plays one beat: what the Book asks, then its answer to `reply`. */
function beat(j: Journey, b: Beat, reply: string, ctx: Ctx = {}) {
  const m = momentFor(b, j, ctx);
  if (!m) throw new Error(`the Book had nothing to say at ${b}`);
  return { m, said: answer(j, m, reply) };
}

describe("the Book talks back", () => {
  test("a journey through five beats: each reply is kept, survives a reload, and comes back regions later", () => {
    let j = newJourney(["hodag", "squonk", "jackalope"])!;
    beat(j, "open", "all");
    const bound = beat(j, "bind", "more", { n: 1, item: 4 });
    expect(bound.m.ask).toStartWith("Item 4.");
    expect(j.talk?.nick).toBe("the eager one");
    const down = beat(j, "downed", "plan", { n: 1, down: "Hodag" });
    expect(down.said).toBe("Then the plan is also on the ground.");
    beat(j, "campfire", "thanks", { n: 1 });
    beat(j, "mythic", "enough", { n: 1, region: "the Pine Barrens", mythic: "Jersey Devil" });

    j = loadJourney(JSON.stringify(j))!; // the save keeps the conversation
    expect(j.talk?.said).toMatchObject({ open: "all", "bind-first": "more", "downed-first": "plan" });

    // the second region's mythic quotes the first page back, word for word
    const later = momentFor("mythic", j, { n: 2, item: 7 })!;
    expect(later.recall).toBe(`On the first page you said, and I quote, "I'll bring you all of them." Item 7 says otherwise.`);
    // a beat it has already had stays quiet; the next one of its kind recalls the reply from the first
    expect(momentFor("downed", j)?.recall).toBe("You said that was the plan. I kept the plan. It is on page one, lying down.");
  });

  test("in a party the guests' pages hold until the host answers", () => {
    expect(holdOf({ host: false, hostName: "Ryan" })).toEqual({ canAnswer: false, note: "The Book is waiting on Ryan." });
    expect(holdOf({ host: true, hostName: "Ryan" }).canAnswer).toBe(true);
  });

  test("the lines file: a guard turns away a broken talk, and the Book never says the same line twice", () => {
    expect(() => Lines([{ id: "x", beat: "dinner", ask: "?", replies: [] }])).toThrow();
    const said = LINES.flatMap((t) => [t.ask, ...t.replies.map((r) => r.book), ...(t.recall ?? []).map((r) => r.line)]);
    expect(said.length).toBeGreaterThanOrEqual(40);
    expect(new Set(said).size).toBe(said.length);
    for (const t of LINES) for (const r of t.recall ?? []) {
      const [id, reply] = r.of.split(".");
      expect(LINES.find((x) => x.id === id)?.replies.some((x) => x.id === reply)).toBe(true);
    }
  });
});
