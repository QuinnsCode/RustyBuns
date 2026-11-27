import { expect, test } from "bun:test";
import { cards, sectorOf } from "./qollab-board.ts";

test.each([
  ["Qollab Studio look, round 13: no glare blob in the glass", "Look"],
  ["Qollab Studio LEARN: a lesson in QDAW", "LEARN"],
  ["Q Amp: cable each pedal on its own", "Q Amps"],
  ["Q Builder: change the circuit itself", "Q Builder"],
  ["QDAW: sidechain driven by a clip", "QDAW"],
  ["Qollab Studio door: sign-in up top right", "Door"],
  ["Qollab Studio jam room: touch controls on phones", "Rooms"],
])("%s -> %s", (title, sector) => expect(sectorOf(title)).toBe(sector));

test("an open PR that closes an issue folds into it as in review; old merges and other apps stay off", () => {
  const issues = [
    { number: 1, title: "Q Amp: a new pedal", labels: [], updatedAt: "2026-11-26T00:00:00Z" },
    { number: 2, title: "QDAW: an idea", labels: [{ name: "future-idea" }], updatedAt: "2026-11-26T00:00:00Z" },
    { number: 3, title: "Skate: a park", labels: [], updatedAt: "2026-11-26T00:00:00Z" },
  ];
  const open = [{ number: 10, title: "Q Amp: the pedal", updatedAt: "2026-11-27T00:00:00Z", closingIssuesReferences: [{ number: 1 }] }];
  const merged = [
    { number: 11, title: "QDAW: song mode", updatedAt: "x", mergedAt: "2026-11-26T00:00:00Z" },
    { number: 12, title: "QDAW: old", updatedAt: "x", mergedAt: "2026-10-01T00:00:00Z" },
  ];
  const got = cards(issues, open, merged, "2026-11-20T00:00:00Z").map((c) => [c.kind, c.n, c.status, c.pr]);
  expect(got).toEqual([["issue", 1, "review", 10], ["issue", 2, "idea", undefined], ["pr", 11, "shipped", undefined]]);
});
