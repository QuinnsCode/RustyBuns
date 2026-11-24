import { expect, test } from "bun:test";
import { parseArgs } from "./kick.ts";

const usage = { error: "usage: bun run kick <pr> [--dry-run]" };
test.each([
  [["5840"], { pr: 5840, dry: false }],
  [["#5840", "--dry-run"], { pr: 5840, dry: true }],
  [["--dry-run", "12"], { pr: 12, dry: true }],
  [[], usage],
  [["abc"], usage],
  [["1", "2"], usage],
  [["1", "--force"], { error: "unknown flag --force" }],
])("kick %p", (argv, want) => expect(parseArgs(argv)).toEqual(want));
