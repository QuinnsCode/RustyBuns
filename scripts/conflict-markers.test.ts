import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markers, scan } from "./conflict-markers.ts";

// Built, not written out, so this file never trips the check itself.
const OURS = "<".repeat(7), MID = "=".repeat(7), THEIRS = ">".repeat(7);
const conflict = [`${OURS} HEAD`, "a", MID, "b", `${THEIRS} origin/main`].join("\n");

test("finds each marker line", () => {
  expect(markers("x.json", `[\n${conflict}\n]`)).toEqual([2, 4, 6]);
  expect(markers("x.ts", `${MID}\r\n`)).toEqual([1]);
});

test("ignores look-alikes", () => {
  expect(markers("x.ts", ` ${OURS} HEAD\n${OURS}HEAD\n${MID}=\n"${MID}"\n${THEIRS}`)).toEqual([]);
});

test("skips fenced code in markdown, not outside it", () => {
  const md = ["# Merging", "```diff", conflict, "```", "~~~", MID, "~~~", MID].join("\n");
  expect(markers("doc.md", md)).toEqual([12]);
  expect(markers("doc.ts", md)).toEqual([3, 5, 7, 10, 12]);
});

test("a longer fence isn't closed by a shorter one", () => {
  expect(markers("a.md", ["````", "```", MID, "````", MID].join("\n"))).toEqual([5]);
});

test("scan reads tracked files, skips binary and untracked ones", async () => {
  const dir = mkdtempSync(join(tmpdir(), "markers-"));
  await Bun.$`git init -q`.cwd(dir);
  writeFileSync(join(dir, "bad.json"), conflict);
  writeFileSync(join(dir, "ok.md"), "```\n" + conflict + "\n```\n");
  writeFileSync(join(dir, "blob.bin"), Buffer.from(`\0\0${conflict}`));
  writeFileSync(join(dir, "untracked.txt"), conflict);
  await Bun.$`git add bad.json ok.md blob.bin`.cwd(dir);
  expect(await scan(dir)).toEqual(["bad.json:1", "bad.json:3", "bad.json:5"]);
});

test("the repo is clean", async () => {
  expect(await scan(join(import.meta.dir, ".."))).toEqual([]);
});
