import { describe, expect, test } from "bun:test";
import { CONFLICT_ROUNDS, failureKey, handoffTask, noteFor, readNote, sameFailure, tokens, tripped, writeNote } from "../src/budget.ts";

describe("agent budgets (#1077)", () => {
  test("tokens are counted at four characters each", () => {
    expect(tokens(0)).toBe(0);
    expect(tokens(4000)).toBe(1000);
    expect(tokens(5)).toBe(2);
  });

  test("the same failure is the same test or error text, whatever the times, durations and colours", () => {
    const a = "\x1b[31m(fail) sum > adds [3.21ms]\x1b[0m\n2026-10-12T10:00:00.123Z expected 3, got 4";
    const b = "(fail) sum > adds [12ms]\n2026-10-12T11:42:07.900Z   expected 3, got 4";
    expect(failureKey(a)).toBe(failureKey(b));
    expect(sameFailure(a, b)).toBe(true);
    expect(sameFailure(a, "expected 3, got 5")).toBe(false);
    expect(sameFailure("", "")).toBe(false);
  });

  test("a run trips past its budget, on the same failure twice, or before a third conflict round", () => {
    expect(tripped({ spent: 10, budget: 100 })).toBeNull();
    expect(tripped({ spent: 120_000, budget: 100_000 })).toBe("context past 100k tokens");
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1"], conflictRounds: 1 })).toBeNull();
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1", "edits lost on a.ts:L1"], conflictRounds: 2 })).toBe("same failure twice");
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1", "edits lost on a.ts:L2"], conflictRounds: CONFLICT_ROUNDS - 1 })).toBe("a third conflict round");
  });

  test("the note is four blunt lines, empty ones left out, and reads back from an agent's reply", () => {
    expect(writeNote({ done: ["x", "y"], next: ["z (a.ts:12)"], broke: [], dont: ["tried a, failed because b"] }))
      .toBe("DONE: x, y\nNEXT: z (a.ts:12)\nDONT: tried a, failed because b");
    expect(readNote("I did most of it.\n\n**DONE:** renamed foo\n- NEXT: the tests (a.test.ts:4)\nBROKE: test sum, wrong import\nDON'T: rename in the lockfile"))
      .toEqual({ done: ["renamed foo"], next: ["the tests (a.test.ts:4)"], broke: ["test sum, wrong import"], dont: ["rename in the lockfile"] });
  });

  test("a run cut short gets a note from its own lines, else from what's known", () => {
    expect(noteFor({ path: "a.ts", task: "rename foo to bar\nand its tests", why: "a third conflict round", applied: 3, conflicts: [{}, {}] }))
      .toBe("DONE: 3 line edits to a.ts\nNEXT: rename foo to bar (a.ts)\nBROKE: 2 edits lost to others' changes, a third conflict round\nDONT: redo lines others changed; work round them");
    expect(noteFor({ path: "a.ts", task: "t", why: "context past 1k tokens", applied: 0, output: "NEXT: do b (a.ts:9)" }))
      .toBe("DONE: nothing landed\nNEXT: do b (a.ts:9)\nBROKE: context past 1k tokens");
    // Notes its owner sent that it never acted on lead NEXT, in their words, with room past a line's usual length (#1090).
    const long = "x".repeat(400);
    expect(noteFor({ path: "a.ts", task: "t", why: "context past 1k tokens", applied: 0, output: "NEXT: do b (a.ts:9)", notes: ["leave c\n alone", long] }))
      .toBe(`DONE: nothing landed\nNEXT: owner says "leave c alone", "${long}", do b (a.ts:9)\nBROKE: context past 1k tokens`);
    expect(handoffTask("a.ts", "same failure twice", "NEXT: x")).toBe("Fresh eyes on a.ts: the last agent stopped (same failure twice) and left you this note. Pick up from NEXT.\nNEXT: x");
  });
});
