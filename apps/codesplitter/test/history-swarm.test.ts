import { expect, test } from "bun:test";
import type { Row } from "../scripts/jam-report.ts";
import { check, compare, slices, taskFile } from "../scripts/history-swarm.ts";

const row = (n: number, merged: number, o: Partial<Row> = {}): Row => ({ n, created: merged - 1, merged, commits: 1, conflicts: 0, pushes: 0, red: 0, files: [], ...o });
const reading = (pr: number, jammed: boolean) => ({ pr, jammed, why: "x", file: "", mervinWouldClear: false });

test("history is cut oldest first into slices, and too many slices is refused", () => {
  const rows = [row(5, 50), row(1, 10), row(3, 30), row(2, 20), row(4, 40)];
  expect(slices(rows, 2).map((s) => s.map((r) => r.n))).toEqual([[1, 2], [3, 4], [5]]);
  expect(() => slices(rows, 2, 2)).toThrow("cap is 2");
  expect(taskFile(0, slices(rows, 2)[0]!, "o/n")).toContain("PRs: 1, 2");
});

test("a reader's rows are checked against the PRs it was given", () => {
  const { rows, problems } = check([1, 2, 3], [reading(1, true), reading(1, false), reading(9, true), { pr: 2 }]);
  expect(rows.map((r) => r.pr)).toEqual([1]);
  expect(problems).toEqual(["#1 twice", "#9 was not in this slice", 'bad row {"pr":2}', "#2 has no row", "#3 has no row"]);
});

test("the merge reports where the reader and the title heuristic disagree", () => {
  const rows = [row(1, 1, { conflicts: 1 }), row(2, 2), row(3, 3)];
  const r = compare([reading(1, false), reading(2, false), { ...reading(3, true), mervinWouldClear: true }], rows);
  expect(r).toMatchObject({ prs: 3, jammed: 1, mervinWouldClear: 1 });
  expect(r.disagree.map((d) => d.pr)).toEqual([1, 3]);
});
