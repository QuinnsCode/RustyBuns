import { expect, test } from "bun:test";
import { heldBy, pick, type Row } from "./phil.ts";

test("Phil picks the oldest Mythic Masters issue nobody holds", () => {
  const row = (number: number, title: string, createdAt: string, body = ""): Row => ({ number, title, body, createdAt });
  const rows = [
    row(10, "Mythic Masters: fix the map", "2026-11-03T00:00:00Z"),
    row(1, "MANUAL RUN: Mythic Masters deploy", "2026-10-01T00:00:00Z"),
    row(2, "Mythic Masters: tome UI, hill climb to 8/10", "2026-10-02T00:00:00Z"),
    row(3, "Mythic Masters: bestiary art", "2026-10-03T00:00:00Z", "Score: 4/10 (target 7)"),
    row(4, "Mythic Masters: held by a PR", "2026-10-04T00:00:00Z"),
    row(3031, "Mythic Masters: waiting on the owner", "2026-10-05T00:00:00Z"),
    row(6, "Skate: an older issue in another app", "2026-09-01T00:00:00Z"),
    row(7, "Mythic Masters: journal page", "2026-10-07T00:00:00Z"),
  ];
  const held = heldBy(["Bestiary fix (Part of #4)", "Desk task: nothing numbered"]);
  const cases: [Set<number>, number | null][] = [[held, 7], [new Set([4, 7]), 10], [new Set([4, 7, 10]), null]];
  for (const [h, want] of cases) expect(pick(rows, h)?.number ?? null).toBe(want);
});
