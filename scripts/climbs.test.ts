import { expect, test } from "bun:test";
import { board, isClimb, score, target } from "./climbs.ts";

test("a round's Score line sets the score and target; without one the last x/10 is a guess", () => {
  const rows: [string, string[], number | null, number | null, boolean][] = [
    ["Mythic Masters ground: reach 7/10", ["Judges scored the ground about 6.8/10 after (3.4 before)."], 7, 6.8, true],
    ["Graphics hill climb to 9/10", ["Toward the 9/10 goal.", "Round 4.\n\nScore: 6.0/10 (target 9)", "round 5 notes, no score"], 9, 6, false],
    ["Skate physics scorecard", ["Main scored 53.8.", "**Score:** 98.1/100"], null, 98.1, false],
    ["Plants hill climb (owner says 4/10, aim for 7)", [], 7, 4, true],
    ["Compendium hill climb", ["Make it look like the references."], null, null, true],
  ];
  for (const [title, texts, goal, s, guessed] of rows) {
    expect(target(title, texts)).toBe(goal);
    const got = score([title, ...texts], goal);
    expect([got.score, got.guessed]).toEqual([s, guessed]);
  }
  expect(isClimb("Fix the login button", "Score: 3/10")).toBe(true);
  expect(isClimb("Fix the login button", "nothing here")).toBe(false);
});

test("the board puts the climb furthest from its target first", () => {
  const now = Date.parse("2026-11-03T00:00:00Z"), touched = "2026-11-01T00:00:00Z";
  const c = (number: number, s: number | null, t: number | null) => ({ number, title: `climb ${number}`, score: s, scale: 10, target: t, guessed: false, touched });
  const lines = board([c(1, 6.8, 7), c(2, 4.5, 9), c(3, null, null)], now);
  expect(lines.map((l) => l.split(" ")[0])).toEqual(["#3", "#2", "#1"]);
  expect(lines[1]).toContain("4.5 of 9 /10");
  expect(lines[1]).toContain("2d  climb 2");
});
