import { expect, test } from "bun:test";
import { overlaps, type OpenPr } from "./preflight.ts";

const pr = (number: number, headRefName: string, ...files: string[]): OpenPr => ({ number, title: `t${number}`, headRefName, files: files.map((path) => ({ path })) });

test("open PRs sharing a file are listed, most shared first; generated-only and your own PR are not clashes", () => {
  const prs = [
    pr(1, "a", "x.ts"),
    pr(2, "b", "x.ts", "y.ts"),
    pr(3, "c", "bun.lock", "z.ts"),
    pr(4, "me", "x.ts", "y.ts"),
    pr(5, "d", "unrelated.ts"),
  ];
  const r = overlaps(["x.ts", "y.ts", "bun.lock"], prs, "me");
  expect(r.clash.map((o) => o.pr)).toEqual([2, 1]);
  expect(r.generated.map((o) => o.pr)).toEqual([3]);
});
