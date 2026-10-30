import { expect, test } from "bun:test";
import { orphanLine, type Tree } from "../scripts/orphans.ts";

const tree = (over: Partial<Tree>): Tree => ({ dir: "/w/.agent-office/worktrees/byte-3349", branch: "office/byte-3349", dirty: 0, unlanded: 0, pr: "", ...over });

test.each([
  ["a worker still owns the branch", tree({ dirty: 4 }), "owned", false],
  ["unpushed commits with no PR", tree({ unlanded: 3 }), "", true],
  ["uncommitted edits on a branch whose PR merged", tree({ dirty: 2, unlanded: 1, pr: "MERGED" }), "", true],
  ["commits whose PR merged (squash) and a clean tree", tree({ unlanded: 1, pr: "MERGED" }), "", false],
  ["nothing at all", tree({}), "", false],
])("%s", (_name, t, owner, listed) => {
  const line = orphanLine(t, new Set(owner ? [t.branch] : []));
  expect(line !== null).toBe(listed);
});

test("the line says what is stranded", () => {
  expect(orphanLine(tree({ unlanded: 1, dirty: 2, pr: "OPEN" }), new Set())).toBe("byte-3349  office/byte-3349  1 commit not on main, 2 uncommitted, PR OPEN");
});
