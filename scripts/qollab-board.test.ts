import { expect, test } from "bun:test";
import { goalOf, tasks } from "./qollab-board.ts";

test.each([
  ["Qollab Studio look, round 13: no glare blob in the glass", "real-rooms"],
  ["Qollab Studio LEARN: a lesson in QDAW", "learn"],
  ["Q Amp: cable each pedal on its own", "gear"],
  ["QDAW: sidechain driven by a clip", "song"],
  ["Stage Builder: the Event Planner as a level builder", "plan-show"],
  ["Qollab Events: RSVP, the attendee list and CSV", "events"],
  ["Qollab Studio jam room: touch controls on phones", "jam-easy"],
  ["Qollab Studio follow-ups: roller shutters", null],
])("%s -> %s", (title, goal) => expect(goalOf(title)).toBe(goal));

test("an open PR that closes an issue folds into it as in review; other apps stay off", () => {
  const issues = [
    { number: 1, title: "Q Amp: a new pedal", labels: [], updatedAt: "2026-11-26T00:00:00Z" },
    { number: 2, title: "QDAW: an idea", labels: [{ name: "future-idea" }], updatedAt: "2026-11-26T00:00:00Z" },
    { number: 3, title: "Skate: a park", labels: [], updatedAt: "2026-11-26T00:00:00Z" },
  ];
  const open = [{ number: 10, title: "Q Amp: the pedal (merge after #9)", updatedAt: "2026-11-27T00:00:00Z", closingIssuesReferences: [{ number: 1 }] }];
  const merged = [{ number: 11, title: "QDAW: song mode", updatedAt: "x", mergedAt: "2026-11-26T00:00:00Z" }];
  const got = tasks(issues, open, merged).map((t) => [t.kind, t.n, t.goal, t.status, t.pr]);
  expect(got).toEqual([["issue", 1, "gear", "review", 10], ["issue", 2, "song", "idea", undefined], ["pr", 11, "song", "shipped", undefined]]);
});
