import { expect, test } from "bun:test";
import { mine, report } from "./builder-nightly.ts";

const job = (app: string, runner: string, target: string) => ({ app, runner, target, prep: "", build: "true" });

test("the builder takes its own Mac jobs and the cross-compile-everything ones, and nothing else", () => {
  const matrix = { include: [job("a", "ubuntu-latest", "all"), job("b", "macos-latest", "darwin-arm64"), job("b", "windows-latest", "windows-x64"), job("b", "macos-15-intel", "darwin-x64")] };
  expect(mine(matrix).map((j) => `${j.app} ${j.target}`)).toEqual(["a all", "b darwin-arm64"]);
  expect(mine(matrix, ["b"]).map((j) => j.target)).toEqual(["darwin-arm64"]);
  expect(mine("nonsense")).toEqual([]);
});

// What `bun run builder nightly` prints from the file the last run wrote.
const night = (...results: { app: string; ok: boolean }[]) =>
  JSON.stringify({ at: "2026-11-09T05:00:00.000Z", commit: "abc1234", results: results.map((r) => ({ ...r, target: "darwin-arm64", seconds: 40, tail: r.ok ? "" : "error: link failed" })) });
test.each<[string, string, boolean, string[]]>([
  ["all built", night({ app: "a", ok: true }, { app: "b", ok: true }), true, ["2026-11-09 05:00 at abc1234: 2 of 2 built"]],
  ["one failed", night({ app: "a", ok: true }, { app: "b", ok: false }), false, ["2026-11-09 05:00 at abc1234: 1 of 2 built", "FAIL b darwin-arm64 40s", "     error: link failed"]],
  ["never ran", "cat: nightly/results.json: No such file or directory", false, []],
])("nightly report: %s", (_, text, ok, lines) => {
  const r = report(text);
  expect(r.ok).toBe(ok);
  if (lines.length) expect(r.text.split("\n")).toEqual(lines);
  else expect(r.text).toContain("has the nightly run yet");
});
