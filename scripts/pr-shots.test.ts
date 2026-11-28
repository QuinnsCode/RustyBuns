import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushShots, shotsMarkdown } from "./pr-shots.ts";

test("shots push to a new shots branch and then onto it, and the PR body points at them (#5951)", () => {
  const bare = mkdtempSync(join(tmpdir(), "shots-bare-")), src = mkdtempSync(join(tmpdir(), "shots-src-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", bare, ...a]).stdout.toString().trim();
  git("init", "-q", "--bare");
  const files = ["before.png", "after.png"].map((n) => join(src, n));
  for (const f of files) writeFileSync(f, f);

  pushShots(files, "golf/one", `file://${bare}`);
  pushShots(files.slice(1), "golf/two", `file://${bare}`);
  expect(git("ls-tree", "-r", "--name-only", "shots").split("\n")).toEqual(["golf/one/after.png", "golf/one/before.png", "golf/two/after.png"]);

  const md = shotsMarkdown("golf/one", files);
  expect(md).toContain("| before | after |");
  expect(md).toContain("/blob/shots/golf/one/after.png?raw=true");
  expect(() => pushShots(files, "golf/three", `file://${src}/nowhere`)).toThrow("could not push the shots");
});
