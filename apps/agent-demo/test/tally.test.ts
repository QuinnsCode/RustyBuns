import { expect, test } from "bun:test";
import { banner, leader, total, vote } from "../src/tally.ts";

test("votes add up and the leader leads", () => {
  const v = vote(vote(vote({}, "popcorn"), "popcorn"), "chips");
  expect(total(v)).toBe(3);
  expect(leader(v)).toBe("popcorn");
  expect(banner(v)).toBe("popcorn is winning");
});

test("an empty room has no leader", () => {
  expect(leader({})).toBeNull();
  expect(banner({})).toBe("No votes yet");
});

test("a snack off the menu is refused", () => {
  expect(() => vote({}, "kale")).toThrow("not on the menu");
});
