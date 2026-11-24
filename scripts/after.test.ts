import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AfterPr, type Gh, NO_CHECKS, type PrState, pass } from "./after.ts";

setDefaultTimeout(30_000);

test.each<{ token: boolean; pushed: string; comments: string[] }>([
  { token: true, pushed: "#12 merged main in and pushed", comments: [] },
  { token: false, pushed: "::warning::#12 merged main in and pushed, but the push starts no checks without AFTER_TOKEN (#5733): commented", comments: [NO_CHECKS] },
])("a PR that says merge after #9 waits while #9 is open, then gets main merged in and pushed once #9 lands (token: $token)", ({ token, pushed, comments }) => {
  const root = mkdtempSync(join(tmpdir(), "after-"));
  try {
    const run = (cwd: string, ...a: string[]) => {
      const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
      return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
    };
    const ok = (cwd: string, ...a: string[]) => {
      const r = run(cwd, ...a);
      if (r.code !== 0) throw new Error(r.out);
      return r.out.trim();
    };
    const origin = join(root, "origin.git"), dev = join(root, "dev"), ci = join(root, "ci");
    ok(root, "init", "-q", "--bare", "-b", "main", origin);
    ok(root, "clone", "-q", origin, dev);
    const commit = (file: string, text: string) => { writeFileSync(join(dev, file), text); ok(dev, "add", "-A"); ok(dev, "commit", "-qm", file); };
    commit("a.ts", "base\n");
    ok(dev, "push", "-q", "origin", "HEAD:main");
    ok(dev, "checkout", "-q", "-b", "mine");
    commit("mine.ts", "mine\n");
    ok(dev, "push", "-q", "origin", "mine");
    ok(root, "clone", "-q", origin, ci);

    const states: Record<number, PrState> = { 9: "OPEN" };
    const pr: AfterPr = { number: 12, headRefName: "mine", body: "Does a thing.\n\nMerge after #9\n", author: { login: "someone" }, isCrossRepository: false, labels: [] };
    const said: string[] = [];
    const gh: Gh = { open: () => [pr], state: (n) => states[n]!, comment: (_, text) => { said.push(text); }, setBody: (_, b) => { pr.body = b; } };
    const git = (...a: string[]) => run(ci, ...a);

    expect(pass(gh, git, { token })).toEqual(["#12 waits on #9"]);

    // #9 lands on main.
    ok(dev, "checkout", "-q", "main");
    commit("theirs.ts", "theirs\n");
    ok(dev, "push", "-q", "origin", "main");
    states[9] = "MERGED";

    expect(pass(gh, git, { token })).toEqual([pushed]);
    const files = ok(origin, "ls-tree", "--name-only", "mine").split("\n");
    expect(files).toEqual(["a.ts", "mine.ts", "theirs.ts"]);
    expect(pr.body).toContain("Merged main in after #9");
    expect(pass(gh, git, { token })).toEqual([]);
    expect(said).toEqual(comments);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a PR a Claude watch holds is left to it: no push, no body change, picked up once the label goes", () => {
  const pr: AfterPr = { number: 12, headRefName: "mine", body: "Merge after #9\n", author: { login: "someone" }, isCrossRepository: false, labels: [{ name: "claude-pr-steward-is-working" }] };
  const gh: Gh = { open: () => [pr], state: () => "OPEN", comment: () => { throw new Error("no comment"); }, setBody: () => { throw new Error("no body change"); } };
  const git = () => { throw new Error("no git"); };
  expect(pass(gh, git)).toEqual(["#12 skipped: a Claude watch holds it (claude-pr-steward-is-working) and merges main in itself"]);
  pr.labels = [{ name: "bug" }];
  expect(pass(gh, git)).toEqual(["#12 waits on #9"]);
});
