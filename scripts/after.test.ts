import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runs } from "./pr.ts";
import { lineMerge } from "../apps/codesplitter/scripts/shadow.ts";
import { type AfterPr, type Gh, type Head, NO_CHECKS, type PrState, KICK_MESSAGE, pass } from "./after.ts";

setDefaultTimeout(30_000);

const pushes: { token: boolean; pushed: string; comments: string[] }[] = [
  { token: true, pushed: "#12 merged main in and pushed", comments: [] },
  { token: false, pushed: "::warning::#12 merged main in and pushed, but the push starts no checks without AFTER_TOKEN (#5733): commented", comments: [NO_CHECKS] },
];
test.each(pushes)("a PR that says merge after #9 waits while #9 is open, then gets main merged in and pushed once #9 lands (token: $token)", ({ token, pushed, comments }) => {
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
    const git = (...a: string[]) => run(ci, ...a);
    const head = (): Head => ({ headRefOid: ok(origin, "rev-parse", "mine"), commits: [{ committedDate: new Date(0).toISOString(), messageHeadline: "merge", authors: [{ name: ok(origin, "log", "-1", "--format=%an", "mine") }] }], comments: [] });
    const said: string[] = [];
    const gh: Gh = { open: () => [pr], state: (n) => states[n]!, comment: (_, text) => { said.push(text); }, setBody: (_, b) => { pr.body = b; }, head, runs: () => [], closedBlockers: () => [] };

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
    // The merge was a person's here (git name t), so there is no bot head to watch.
    expect(pass(gh, git)).toEqual([]);
    expect(pass(gh, git, { token })).toEqual([]);
    // The push-time comment carries the head's marker, which the later CI check reads as already flagged.
    expect(said.map((s) => s.split("\n")[0])).toEqual(comments);
    if (!token) expect(said[0]).toContain(`<!-- after:unchecked ${ok(origin, "rev-parse", "mine")} -->`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Main's conflicts Mervin's line merge settles are pushed; a real one still stops for a person. The first two are
// #5997 (fm-daw README) and #5983 (GEAR_SIZES) from 2026-11-25.
const A = "- **Live line:** everything in the room edits one groove.", NEW = "- **Takes:** record a loop and keep it.", B = "- **Private seshes:** set a room code.";
const HIGH = '  "stack-mid-high": [0.6, 0.9, 0.5],', BASS = '  "stack-mid-bass": [0.75, 0.75, 0.85],';
const doc = (...l: string[]) => `# fm-daw\n\n## Features\n\n${l.join("\n")}\n\nThe end.\n`;
const gear = (...l: string[]) => `export const GEAR_SIZES = {\n  turntable: [0.453, 0.169, 0.353],\n${l.join("\n")}\n  "horn-sub-21": [1.1, 0.8, 1.0],\n};\n`;
const settles: { why: string; file: string; base: string; main: string; branch: string; want: string | null }[] = [
  { why: "a bullet the branch grew, a bullet main added after it", file: "README.md", base: doc(A, B), main: doc(A, NEW, B), branch: doc(`${A} It plays back in time.`, B), want: doc(`${A} It plays back in time.`, NEW, B) },
  { why: "next-door rows each side changed", file: "gear.ts", base: gear(HIGH, BASS), main: gear('  "stack-mid-high": [0.522, 0.92, 0.56],', BASS), branch: gear(HIGH, '  "stack-mid-bass": [0.7, 0.8, 0.85],'), want: gear('  "stack-mid-high": [0.522, 0.92, 0.56],', '  "stack-mid-bass": [0.7, 0.8, 0.85],') },
  { why: "one row changed two ways stops", file: "gear.ts", base: gear(HIGH, BASS), main: gear(HIGH, '  "stack-mid-bass": [0.8, 0.75, 0.85],'), branch: gear(HIGH, '  "stack-mid-bass": [0.7, 0.8, 0.85],'), want: null },
];
test.each(settles)("main's conflict: $why", ({ file, base, main, branch, want }) => {
  const root = mkdtempSync(join(tmpdir(), "after-"));
  try {
    const run = (cwd: string, ...a: string[]) => {
      const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
      return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
    };
    const ok = (cwd: string, ...a: string[]) => { const r = run(cwd, ...a); if (r.code !== 0) throw new Error(r.out); return r.out; };
    const origin = join(root, "origin.git"), dev = join(root, "dev"), ci = join(root, "ci");
    ok(root, "init", "-q", "--bare", "-b", "main", origin);
    ok(root, "clone", "-q", origin, dev);
    const commit = (text: string) => { writeFileSync(join(dev, file), text); ok(dev, "commit", "-qam", "x"); };
    writeFileSync(join(dev, file), base); ok(dev, "add", "-A"); ok(dev, "commit", "-qm", "base");
    ok(dev, "push", "-q", "origin", "HEAD:main");
    ok(dev, "checkout", "-q", "-b", "mine"); commit(branch); ok(dev, "push", "-q", "origin", "mine");
    ok(dev, "checkout", "-q", "main"); commit(main); ok(dev, "push", "-q", "origin", "main");
    ok(root, "clone", "-q", origin, ci);
    const pr: AfterPr = { number: 12, headRefName: "mine", body: "Merge after #9\n", author: { login: "someone" }, isCrossRepository: false, labels: [] };
    const said: string[] = [];
    const gh: Gh = { open: () => [pr], state: () => "MERGED", comment: (_, t) => { said.push(t); }, setBody: (_, b) => { pr.body = b; }, head: () => { throw new Error("no head"); }, runs: () => [], closedBlockers: () => [] };
    const before = ok(origin, "rev-parse", "mine");
    const out = pass(gh, (...a) => run(ci, ...a), { token: true, lineMerge });
    if (want === null) {
      expect(out).toEqual([`#12 conflicts with main in ${file}: commented`]);
      expect(ok(origin, "rev-parse", "mine")).toBe(before);
      expect(pr.body).toStartWith("Main conflicts after #9");
      expect(said[0]).toContain(`- \`${file}\`: Mervin left 1 card`);
      return;
    }
    expect(out).toEqual(["#12 merged main in and pushed (settled its conflicts)"]);
    expect(ok(origin, "show", `mine:${file}`)).toBe(want);
    expect(ok(origin, "rev-list", "--parents", "-1", "mine").trim().split(" ")).toHaveLength(3);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`- \`${file}\``);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a PR a Claude watch holds is left to it: no push, no body change, picked up once the label goes", () => {
  const pr: AfterPr = { number: 12, headRefName: "mine", body: "Merge after #9\n", author: { login: "someone" }, isCrossRepository: false, labels: [{ name: "claude-pr-steward-is-working" }] };
  const gh: Gh = { open: () => [pr], state: () => "OPEN", comment: () => { throw new Error("no comment"); }, setBody: () => { throw new Error("no body change"); }, head: () => { throw new Error("no head"); }, runs: () => [], closedBlockers: () => [] };
  const git = () => { throw new Error("no git"); };
  expect(pass(gh, git)).toEqual(["#12 skipped: a Claude watch holds it (claude-pr-steward-is-working) and merges main in itself"]);
  pr.labels = [{ name: "bug" }];
  expect(pass(gh, git)).toEqual(["#12 waits on #9"]);
});

// #5837: a head the after bot pushed that never got CI is started (token) or flagged once (no token).
const SHA = "abc1234".padEnd(40, "0"), KICK = "def5678".padEnd(40, "0"), NOW = Date.parse("2026-11-24T19:00:00Z");
const mins = (m: number) => new Date(NOW - m * 60_000).toISOString();
const flag = `<!-- after:unchecked ${SHA} -->`;
interface Row { why: string; author: string; age: number; runs: Runs; token: boolean; comments: Head["comments"]; line?: string; push: boolean; comment: boolean }
const rows: Row[] = [
  { why: "bot head, no runs, old, token: pushes an empty commit", author: "rustybuns-after", age: 7, runs: [], token: true, comments: [], line: "#12 head abc1234 had no CI after 7 min: started CI (pushed def5678)", push: true, comment: false },
  { why: "same without a token: one comment and a warning", author: "rustybuns-after", age: 7, runs: [], token: false, comments: [], line: "#12 head abc1234 has no CI after 7 min: flagged", push: false, comment: true },
  { why: "already flagged: no second comment", author: "rustybuns-after", age: 50, runs: [], token: false, comments: [{ body: flag }], line: "#12 head abc1234 has no CI after 50 min: already flagged", push: false, comment: false },
  { why: "a queued run counts as started", author: "rustybuns-after", age: 7, runs: [{ workflowName: "apps", status: "queued" }], token: true, comments: [], line: "#12 head abc1234 has CI", push: false, comment: false },
  { why: "young head: waits", author: "rustybuns-after", age: 2, runs: [], token: true, comments: [], line: "#12 head abc1234 has no CI run yet (2 min old)", push: false, comment: false },
  { why: "a person's head: nothing", author: "Someone", age: 30, runs: [], token: true, comments: [], push: false, comment: false },
];
test.each(rows)("$why", ({ author, age, runs, token, comments, line, push, comment }) => {
  const pr: AfterPr = { number: 12, headRefName: "mine", body: "Merged main in after #9\n", author: { login: "someone" }, isCrossRepository: false, labels: [] };
  const said: string[] = [], pushed: string[] = [];
  const gh: Gh = {
    open: () => [pr], state: () => "MERGED", setBody: () => { throw new Error("no body change"); },
    comment: (_, t) => { said.push(t); },
    head: () => ({ headRefOid: SHA, commits: [{ committedDate: mins(age), messageHeadline: "Merge main into mine", authors: [{ name: author }] }], comments }),
    runs: () => runs, closedBlockers: () => [],
  };
  const git = (...a: string[]) => {
    if (a[0] === "rev-parse") return { code: 0, out: SHA + "\n" };
    if (a[0] === "commit-tree") { expect(a).toEqual(["commit-tree", `${SHA}^{tree}`, "-p", SHA, "-m", KICK_MESSAGE]); return { code: 0, out: KICK + "\n" }; }
    if (a[0] === "push") pushed.push(a.join(" "));
    return { code: 0, out: "" };
  };
  const out = pass(gh, git, { token, now: NOW });
  expect(out.map((l) => l.split("\n")[0])).toEqual(line ? [line] : []);
  expect(pushed).toEqual(push ? [`push -q origin ${KICK}:refs/heads/mine`] : []);
  expect(said.length).toBe(comment ? 1 : 0);
  if (comment) expect(said[0]).toStartWith(flag);
  if (!token && line) expect(out[0]).toContain("::warning::#12 head abc1234");
});
