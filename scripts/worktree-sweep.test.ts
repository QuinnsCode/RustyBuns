import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Pr, removeAll, rescue, rescueRefs, survey, WORKTREES } from "./worktree-sweep.ts";

setDefaultTimeout(30_000);
const tmp = mkdtempSync(path.join(tmpdir(), "wt-sweep-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const sh = (cwd: string, ...args: string[]) => {
  const p = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};

test("clean and merged goes, half-removed goes, unpushed is rescued then goes, seated stays, a stray goes", async () => {
  const origin = path.join(tmp, "origin.git");
  const root = path.join(tmp, "repo");
  sh(tmp, "init", "--bare", "-q", "-b", "main", origin);
  sh(tmp, "clone", "-q", origin, root);
  writeFileSync(path.join(root, "a.txt"), "a\n");
  sh(root, "add", "-A");
  sh(root, "commit", "-qm", "first");
  sh(root, "push", "-q", "origin", "main");
  const wt = (name: string) => {
    const p = path.join(root, WORKTREES, name);
    sh(root, "worktree", "add", "-q", "-b", `office/${name}`, p);
    return p;
  };
  // merged: its PR's head was squash-merged and GitHub deleted the branch, so the commit is on no remote
  const merged = wt("merged-1");
  writeFileSync(path.join(merged, "b.txt"), "b\n");
  sh(merged, "add", "-A");
  sh(merged, "commit", "-qm", "work");
  const mergedHead = sh(merged, "rev-parse", "HEAD");
  // unpushed: a commit no remote has, plus an untracked file
  const unpushed = wt("unpushed-2");
  writeFileSync(path.join(unpushed, "c.txt"), "c\n");
  sh(unpushed, "add", "-A");
  sh(unpushed, "commit", "-qm", "not pushed");
  writeFileSync(path.join(unpushed, "notes.md"), "half done\n");
  // cut off part way through a `git worktree remove`: files gone, .git left; and deploy state, never saved
  const halfGone = wt("half-gone-5");
  rmSync(path.join(halfGone, "a.txt"));
  mkdirSync(path.join(halfGone, ".rustybuns"));
  writeFileSync(path.join(halfGone, ".rustybuns", "planned.live"), "account\n");
  const seated = wt("seated-3");
  writeFileSync(path.join(seated, "wip.txt"), "busy\n");
  // a stray, an hour old, and a workspace folder holding a checkout of another repo
  const stray = path.join(root, WORKTREES, "old-scratch.ts");
  writeFileSync(stray, "x");
  const old = (Date.now() - 2 * 3_600_000) / 1000;
  utimesSync(stray, old, old);
  const workspace = path.join(root, WORKTREES, "multi-4");
  mkdirSync(path.join(workspace, "other"), { recursive: true });
  writeFileSync(path.join(workspace, "other", ".git"), "gitdir: /elsewhere\n");
  utimesSync(workspace, old, old);

  const prs = new Map<string, Pr>([["office/merged-1", { state: "MERGED", head: mergedHead, number: 1 }]]);
  const look = async () => Object.fromEntries((await survey({ root, seated: [path.join(WORKTREES, "seated-3")], prs, rescues: await rescueRefs(root) })).map((e) => [e.name, e]));

  let e = await look();
  expect(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v.verdict]))).toEqual({
    "merged-1": "remove", "unpushed-2": "rescue", "seated-3": "skip", "old-scratch.ts": "remove", "multi-4": "keep", "half-gone-5": "remove",
  });
  expect([e["unpushed-2"]!.dirty, e["unpushed-2"]!.unpushed]).toEqual([1, 1]);

  // nothing unsaved is removed
  await removeAll(root, Object.values(e).map((x) => (x.verdict === "rescue" ? x : { ...x, verdict: "skip" as const })));
  expect(existsSync(unpushed)).toBe(true);

  const { saved, failed } = await rescue(root, Object.values(e));
  expect([saved, failed]).toEqual([["unpushed-2"], []]);
  // the rescue holds the unpushed commit and the untracked file, and the worktree itself is untouched
  sh(root, "fetch", "-q", "origin", "rescue/unpushed-2");
  expect(sh(root, "show", "FETCH_HEAD:notes.md")).toBe("half done");
  expect(sh(root, "show", "FETCH_HEAD:c.txt")).toBe("c");
  expect(sh(unpushed, "status", "--porcelain")).toBe("?? notes.md");

  e = await look();
  expect(e["unpushed-2"]!.verdict).toBe("remove");
  // a change after the rescue makes it unsaved again
  writeFileSync(path.join(unpushed, "notes.md"), "more\n");
  expect((await look())["unpushed-2"]!.verdict).toBe("rescue");
  writeFileSync(path.join(unpushed, "notes.md"), "half done\n");

  e = await look();
  const gone = await removeAll(root, Object.values(e));
  expect(gone.sort()).toEqual(["half-gone-5", "merged-1", "old-scratch.ts", "unpushed-2"]);
  expect([existsSync(merged), existsSync(unpushed), existsSync(stray), existsSync(seated), existsSync(workspace)]).toEqual([false, false, false, true, true]);
  expect(sh(root, "worktree", "list").split("\n")).toHaveLength(2);
});
