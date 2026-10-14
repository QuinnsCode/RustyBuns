import { expect, test } from "bun:test";
import { conflictCommits, hotFiles, jamByCrowd, perDay, svg, type Row } from "../scripts/jam-report.ts";

const H = 36e5;
const row = (n: number, from: number, to: number, o: Partial<Row> = {}): Row => ({ n, created: from * H, merged: to * H, commits: 1, conflicts: 0, pushes: 0, red: 0, files: [], ...o });

test("conflict commits are the ones that merge main in or resolve a conflict", () => {
  expect(conflictCommits(["Merge branch 'main' into office/x", "fix the thing", "resolve conflict in README", "Rebase onto main"])).toBe(3);
});

test("the jam rate is counted by how many PRs were already open", () => {
  const rows = [row(1, 0, 10), row(2, 1, 9, { conflicts: 1 }), row(3, 2, 8, { pushes: 1 }), row(4, 20, 21)];
  const by = Object.fromEntries(jamByCrowd(rows).map((b) => [b.label, b]));
  expect(by["0-2"]).toMatchObject({ prs: 4, jammed: 2, rate: 50 });
});

test("two PRs open together on one file are one toe step; sequential ones are none", () => {
  const rows = [row(1, 0, 5, { files: ["README.md"] }), row(2, 3, 8, { files: ["README.md"] }), row(3, 9, 10, { files: ["README.md"] })];
  expect(hotFiles(rows)[0]).toEqual({ file: "README.md", prs: 3, pairs: 1 });
});

test("per-day counts and the chart", () => {
  const rows = [row(1, 0, 1, { conflicts: 1 }), row(2, 0, 2, { red: 1 }), row(3, 30, 31)];
  expect(perDay(rows)).toEqual([{ day: "1970-01-01", merged: 2, jammed: 1, red: 1 }, { day: "1970-01-02", merged: 1, jammed: 0, red: 0 }]);
  expect(svg(rows)).toStartWith("<svg");
});
