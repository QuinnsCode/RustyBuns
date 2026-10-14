import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { humanEdit, roll } from "../scripts/borg-engine.ts";
import { pretend, replayCommit, rng, units } from "../scripts/borg-agents.ts";
import { local } from "../src/local.ts";

const sh = (dir: string, cmd: string) => {
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.exitCode > 1) throw new Error(r.stderr.toString());
};
const put = (dir: string, file: string, text: string, msg: string) => { writeFileSync(join(dir, file), text); sh(dir, `git add -A && git commit -qm '${msg}'`); };
const lines = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

test("a human edit is the lines they added and dropped, and a reordering is no edit", () => {
  const t = { main: "a\nm\nz", branch: "a\nb\nz", landed: "a\nb\nm\nnew\nz" };
  expect(humanEdit("a\nm\nb\nz", t)).toEqual({ added: ["new"], dropped: [], edited: 1 });
  // Mervin asked: the nearer side (main here would drop `b`) is the yardstick.
  expect(humanEdit(null, t).added.length).toBeGreaterThan(0);
});

test("runs of inserts after one anchor travel as one unit", () => {
  const u = units([
    { kind: "delete", line: "1", base: 1 },
    { kind: "insert", after: "2", text: "c" }, { kind: "insert", after: "2", text: "b" },
    { kind: "insert", after: "3", text: "z" },
  ]);
  expect(u.map((x) => x.length)).toEqual([1, 2, 1]);
});

test("agents writing one commit at once land it exactly, and rivals on a line leave one text", async () => {
  const call = await local({ GH_CLI: "off" });
  try {
    const base = lines(40, (i) => `line ${i}`), target = lines(40, (i) => (i % 3 ? `line ${i}` : `LINE ${i}`)).replace("line 7", "line 7 and more") + "\nappended";
    const plain = await pretend(call, "a.txt", base, target, { agents: 5, seed: 3, repo: "plain" });
    expect(plain.verdict).toBe("exact");
    for (const seed of [1, 2, 3]) {
      const fight = await pretend(call, "a.txt", base, target, { agents: 4, contest: 1, seed, repo: `fight${seed}` });
      expect(fight.contested).toBeGreaterThan(5);
      expect(["exact", "settled"]).toContain(fight.verdict);
    }
  } finally { call.close(); }
}, 60000);

test("a real commit is split across agents and the file ends as the commit wrote it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "borg-agents-"));
  sh(dir, "git init -q -b main");
  put(dir, "f.txt", lines(20, (i) => `row ${i}`) + "\n", "one");
  put(dir, "f.txt", lines(20, (i) => (i % 4 ? `row ${i}` : `ROW ${i}`)) + "\ntail\n", "two");
  const call = await local({ GH_CLI: "off" });
  try {
    const r = await replayCommit(call, dir, "HEAD", { agents: 3 });
    expect(r.files.map((f) => [f.path, f.verdict])).toEqual([["f.txt", "exact"]]);
  } finally { call.close(); }
  expect(rng(7)()).toBe(rng(7)());
}, 60000);

test("the engine keeps the human edit to a merge, and never replays a merge twice", async () => {
  const repo = mkdtempSync(join(tmpdir(), "borg-repo-")), home = mkdtempSync(join(tmpdir(), "borg-home-"));
  sh(repo, "git init -q -b main");
  put(repo, "list.txt", "a\nb\nc\n", "base");
  sh(repo, "git checkout -qb pr");
  put(repo, "list.txt", "a\nb\nbranch\nc\n", "pr adds after b");
  sh(repo, "git checkout -q main");
  put(repo, "list.txt", "a\nb\nmain\nc\n", "main adds after b");
  sh(repo, "git merge --no-ff -q pr -m 'Merge pr' || true");
  // The person kept both and added a line of their own.
  writeFileSync(join(repo, "list.txt"), "a\nb\nmain\nbranch\nby hand\nc\n");
  sh(repo, "git add -A && git commit -qm 'Merge pr'");

  const first = await roll(repo, home, { log: () => {} });
  expect(first.fought).toBe(1);
  expect(first.lessons).toBe(1);
  const lesson = JSON.parse(readFileSync(join(home, "lessons.jsonl"), "utf8").trim());
  expect(lesson.added).toEqual(["by hand"]);
  const second = await roll(repo, home, { log: () => {} });
  expect(second.fresh).toBe(0);
  expect(readFileSync(join(home, "lessons.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
}, 60000);

import { higher, mergeManifest } from "../src/manifest.ts";
import { fromText, merge, apply, empty, text } from "../src/lines.ts";

const pkg = (o: object) => JSON.stringify(o, null, 2) + "\n";
test("a package.json both sides touched merges by key: new keys land sorted, the higher bump wins", () => {
  const base = pkg({ name: "x", scripts: { test: "t" }, dependencies: { a: "^1.0.0", c: "^1.0.0" } });
  const main = pkg({ name: "x", scripts: { test: "t", lint: "l" }, dependencies: { a: "^1.2.0", c: "^1.0.0" } });
  const branch = pkg({ name: "x", scripts: { test: "t", build: "b" }, dependencies: { a: "^2.0.0", b: "^1.0.0", c: "^1.0.0" } });
  expect(JSON.parse(mergeManifest(base, main, branch)!)).toEqual({ name: "x", scripts: { test: "t", lint: "l", build: "b" }, dependencies: { a: "^2.0.0", b: "^1.0.0", c: "^1.0.0" } });
  // A script both rewrote is a guess: not settled here.
  expect(mergeManifest(base, pkg({ scripts: { test: "one" } }), pkg({ scripts: { test: "two" } }))).toBeNull();
  expect(higher("^1.2.0", "~1.10.0")).toBe("~1.10.0");
  expect(higher("latest", "^1")).toBeNull();
});

test("the line merge no longer asks on neighbouring dependency bumps in package.json, and still asks on other files", () => {
  const base = pkg({ dependencies: { a: "^1.0.0", b: "^1.0.0" } });
  const side = (t: string) => { const d = empty(); apply(d, fromText(base), "base"); return d; };
  const run = (path: string) => {
    const [b, m, br] = [side(base), side(base), side(base)];
    apply(m, [{ kind: "set", line: m.lines[2]!.id, base: m.lines[2]!.rev, text: '    "a": "^1.1.0",' }], "main");
    apply(br, [{ kind: "set", line: br.lines[2]!.id, base: br.lines[2]!.rev, text: '    "a": "^1.2.0",' }], "branch");
    return merge(b, br, m, {}, "branch", path, "branch");
  };
  expect(run("notes.json").conflicts.length).toBeGreaterThan(0);
  const r = run("package.json");
  expect(r.conflicts).toEqual([]);
  const m = side(base);
  apply(m, [{ kind: "set", line: m.lines[2]!.id, base: m.lines[2]!.rev, text: '    "a": "^1.1.0",' }], "main");
  expect(apply(m, r.ops, r.by).ok).toBe(true);
  expect(text(m)).toContain('"a": "^1.2.0"');
});
