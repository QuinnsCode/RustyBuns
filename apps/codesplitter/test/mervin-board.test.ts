import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciOf, diskCache, lanesOf, linesOf, order, regenerate, run, score, type BoardPr, type StageCache } from "../scripts/mervin-board.ts";

// scripts/mervin-board.ts: the open PRs merged in a sandbox one stage at a time, then scored against what landed.
describe("mervin board", () => {
  const repo = mkdtempSync(join(tmpdir(), "mervin-board-"));
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }).stdout.toString().trim();
  const commit = (files: Record<string, string>, msg: string) => {
    for (const [p, t] of Object.entries(files)) writeFileSync(join(repo, p), t);
    git("add", "-A"); git("commit", "-qm", msg);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q", "-b", "main"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
  const main = commit({ "a.ts": "a\nb\nc\n", "b.ts": "one\ntwo\n", "c.ts": "x\n" }, "base");
  git("checkout", "-qb", "p1");
  const p1 = commit({ "a.ts": "A\nb\nc\n", "c.ts": "X\np1\n" }, "p1");
  git("checkout", "-qb", "p2", main);
  const p2 = commit({ "a.ts": "a\nB\nc\n", "b.ts": "one\ntwo\nthree\n" }, "p2");
  git("checkout", "-qb", "p3", p1);
  const p3 = commit({ "c.ts": "X\np1\np3\n" }, "p3 on p1");
  git("checkout", "-qb", "p4", main);
  const p4 = commit({ "c.ts": "y\n" }, "p4");
  const prs: BoardPr[] = [
    { number: 4, headRefOid: p4, headRefName: "p4", baseRefName: "main" },
    { number: 3, headRefOid: p3, headRefName: "p3", baseRefName: "p1" },
    { number: 2, headRefOid: p2, headRefName: "p2", baseRefName: "main" },
    { number: 1, headRefOid: p1, headRefName: "p1", baseRefName: "main" },
  ];

  test("oldest first, a stacked PR right after the one it's built on, or the order given", () => {
    expect(order(prs).map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(order([prs[1]!, { ...prs[3]!, number: 9 }]).map((p) => p.number)).toEqual([9, 3]);
    expect(order(prs, [2, 1]).map((p) => p.number)).toEqual([2, 1]);
  });

  test("each stage files every file in a tier, and never writes a ref", () => {
    const refs = git("for-each-ref");
    const { board, tree } = run(repo, main, order(prs));
    expect(git("for-each-ref")).toBe(refs);
    const tiers = board.stages.map((s) => Object.fromEntries(s.files.map((f) => [f.path, f.tier])));
    expect(tiers).toEqual([
      { "a.ts": "certain", "c.ts": "certain" },
      { "a.ts": "mervin", "b.ts": "certain" },   // next-door lines: git conflicts, Mervin settles
      { "c.ts": "certain" },                     // stacked: merged from p1, which is already in
      { "c.ts": "card" },                        // rewrote the line p1 rewrote too
    ]);
    expect(board.stages[3]!.files[0]!.after).toEqual([1, 3]);
    expect(tree.get("a.ts")).toBe("A\nB\nc\n");
    expect(tree.get("c.ts")).toBe("X\np1\np3\n");
  });

  test("a cache reuses a stage until main, its head or a file it touches moves", () => {
    const cache: StageCache = new Map();
    const first = run(repo, main, order(prs), cache);
    expect(first.board.stages.some((s) => s.cached)).toBe(false);
    const again = run(repo, main, order(prs), cache);
    expect(again.board.stages.every((s) => s.cached)).toBe(true);
    expect(again.board.stages.map((s) => s.files)).toEqual(first.board.stages.map((s) => s.files));
    expect([...again.tree]).toEqual([...first.tree]);
    expect(again.board.clashes).toEqual(first.board.clashes);
    // p4 pushed again: only it reruns (p1..p3 are before it and unchanged)
    const moved = prs.map((p) => (p.number === 4 ? { ...p, headRefOid: p3 } : p));
    expect(run(repo, main, order(moved), cache).board.stages.map((s) => !!s.cached)).toEqual([true, true, true, false]);
    // p2 pushed again, now touching only d.ts: the later stages share no file with it, so they stay cached
    git("checkout", "-qb", "p2b", main);
    const p2b0 = commit({ "d.ts": "d\n" }, "p2 again");
    const p2b = prs.map((p) => (p.number === 2 ? { ...p, headRefOid: p2b0 } : p));
    expect(run(repo, main, order(p2b), cache).board.stages.map((s) => !!s.cached)).toEqual([true, false, true, true]);
  });

  test("the disk cache keeps stages between runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "mervin-board-cache-"));
    try {
      const a = diskCache(dir);
      run(repo, main, order(prs), a.cache); a.save();
      const b = diskCache(dir);
      expect(run(repo, main, order(prs), b.cache).board.stages.every((s) => s.cached)).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a conflict with main is blamed on main, not on an earlier PR", () => {
    git("checkout", "-qb", "m2", main);
    const moved = commit({ "c.ts": "main\n" }, "main moves c.ts");
    const { board } = run(repo, moved, order(prs, [4, 1]));
    const c = (i: number) => board.stages[i]!.files.find((f) => f.path === "c.ts")!;
    expect(c(0)).toMatchObject({ tier: "card", after: [], main: true });
    expect(c(1)).toMatchObject({ tier: "card", after: [], main: true });
    expect(board.stages[0]!.files.find((f) => f.path === "a.ts")).toBeUndefined();
  });

  test("the score: exact, wrong, asked, and a file someone else moved", () => {
    const { board, tree } = run(repo, main, order(prs, [1, 2, 4]));
    const dir = mkdtempSync(join(tmpdir(), "mervin-board-tree-"));
    try {
      for (const [p, t] of tree) writeFileSync(join(dir, p), t!);
      git("checkout", "-q", "main");
      commit({ "a.ts": "A\nB\nc\n", "c.ts": "X\np1\n" }, "p1 (#1)");
      commit({ "b.ts": "one\nTWO\nthree\n" }, "p2 (#2)");
      commit({ "c.ts": "y\n" }, "p4 (#4)");
      const { landed, rows } = score(repo, board, dir, git("rev-parse", "HEAD"));
      expect(landed).toEqual([1, 2, 4]);
      expect(Object.fromEntries(rows.map((r) => [r.path, r.score]))).toEqual({ "a.ts": "exact", "b.ts": "wrong", "c.ts": "asked" });
      commit({ "a.ts": "other\n" }, "outside the board (#99)");
      expect(score(repo, board, dir, git("rev-parse", "HEAD")).rows.find((r) => r.path === "a.ts")!.score).toBe("moved");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("a PR rebuilt after the board ran, then merged with a merge commit, still counts as landed", () => {
    const { board, tree } = run(repo, main, order(prs, [4]));
    const dir = mkdtempSync(join(tmpdir(), "mervin-board-tree-"));
    try {
      for (const [p, t] of tree) writeFileSync(join(dir, p), t!);
      git("checkout", "-q", "p4");
      commit({ "d.ts": "rebuilt\n" }, "merge main into p4");   // a new head sha, unknown to the board
      git("checkout", "-qb", "after", main);
      git("merge", "-q", "--no-ff", "-m", "Merge pull request #4 from o/p4", "p4");
      const { landed, rows } = score(repo, board, dir, git("rev-parse", "HEAD"));
      expect(landed).toEqual([4]);
      expect(rows.map((r) => r.score)).toEqual(["exact"]);
    } finally { rmSync(dir, { recursive: true, force: true }); git("checkout", "-q", "main"); }
  });

  test("a PR's own CI: red when any check failed, pending while one runs", () => {
    const pr = (rollup: BoardPr["statusCheckRollup"]) => ciOf({ number: 1, headRefOid: "x", statusCheckRollup: rollup });
    expect(pr([{ name: "typecheck", conclusion: "SUCCESS", status: "COMPLETED" }, { name: "test codesplitter", conclusion: "FAILURE", status: "COMPLETED", startedAt: "2026-10-14T10:00:00Z", completedAt: "2026-10-14T10:06:00Z" }])).toEqual({ ci: "fail", failing: ["test codesplitter"], ciSecs: 360 });
    expect(pr([{ name: "typecheck", conclusion: "", status: "IN_PROGRESS" }]).ci).toBe("pending");
    expect(pr([{ name: "typecheck", conclusion: "SKIPPED", status: "COMPLETED" }]).ci).toBe("pass");
    expect(pr([]).ci).toBe("none");
  });

  test("a PR not landed yet is waiting, not scored", () => {
    const { board } = run(repo, main, order(prs, [1]));
    mkdirSync(join(repo, "none"), { recursive: true });
    expect(score(repo, board, join(repo, "none"), main).rows.every((r) => r.score === "waiting")).toBe(true);
  });
});

// scripts/mervin-merge.ts: which PRs go now, which wait, and why.
import { decide } from "../scripts/mervin-merge.ts";
describe("mervin merge round", () => {
  const row = (path: string, tier: "certain" | "card", after: number[] = []) => ({ path, tier, why: "", after });
  const stage = (pr: number, files: ReturnType<typeof row>[], extra = {}) => ({ pr, head: "h", base: "b", files, ...extra });
  const board = (stages: ReturnType<typeof stage>[], clashes: any[] = []) => ({ main: "m", at: "", stages, written: [], skipped: [], clashes });
  test("waves, holds and what waits behind a hold", () => {
    const v = decide(board([
      stage(1, [row("a", "certain")]),
      stage(2, [row("a", "certain", [1])]),
      stage(3, [row("b", "card")]),
      stage(4, [row("b", "certain", [3])]),
      stage(5, [row("c", "certain")], { stackedOn: 9 }),
      stage(6, [row("d", "certain")]),
    ], [{ kind: "migration", key: "1", prs: [6] }]), []);
    const by = Object.fromEntries(v.map((x) => [x.pr, x]));
    expect([by[1]!.go, by[1]!.wave]).toEqual([true, 1]);
    expect([by[2]!.go, by[2]!.wave]).toEqual([true, 2]);
    expect(by[3]!.why).toContain("asks on b");
    expect(by[4]!.why).toContain("behind held #3");
    expect(by[5]!.why).toContain("stacked on #9");
    expect(by[6]!.why).toContain("migration");
  });
  test("a failed CI holds the PR", () => {
    const prs: BoardPr[] = [{ number: 1, headRefOid: "h", statusCheckRollup: [{ name: "apps", conclusion: "FAILURE", status: "COMPLETED" }] }];
    expect(decide(board([stage(1, [row("a", "certain")])]), prs)[0]!.why).toBe("CI failed: apps");
  });
});

import { advise, buildStack, stackable, strayAutoMerges } from "../scripts/mervin-merge.ts";
describe("mervin merge round blockers (#1542)", () => {
  const st = (pr: number, extra = {}) => ({ pr, head: "h", base: "b", files: [{ path: "a", tier: "certain" as const, why: "", after: [] }], ...extra });
  const bd = (stages: any[]) => ({ main: "m", at: "", stages, written: [], skipped: [], clashes: [] }) as any;
  const ok = (name: string) => ({ name, conclusion: "SUCCESS", status: "COMPLETED" });
  test("a check that hasn't reported is pending, not green", () => {
    const prs: BoardPr[] = [{ number: 1, headRefOid: "h", statusCheckRollup: [ok("typecheck")] }];
    expect(decide(bd([st(1)]), prs)[0]!.why).toBe("required check not reported yet: apps");
    prs[0]!.statusCheckRollup = [ok("typecheck"), ok("apps")];
    expect(decide(bd([st(1)]), prs)[0]!.go).toBe(true);
  });
  test("a stacked PR whose base branch is gone is not landable", () => {
    const prs: BoardPr[] = [{ number: 1, headRefOid: "h", headRefName: "b1", baseRefName: "dead" }];
    expect(decide(bd([st(1)]), prs)[0]!.why).toContain("retarget to main");
  });
  test("a PR based on a merged PR's branch is held and advised to retarget (#1545)", () => {
    const prs: BoardPr[] = [{ number: 1478, headRefOid: "h", headRefName: "b2", baseRefName: "office/nibble-5ddf" }];
    const board = bd([st(1478)]), verdicts = decide(board, prs);
    expect(verdicts[0]!.go).toBe(false);
    const a = advise(board, verdicts).advice[0]!;
    expect(a.who).toBe("one agent");
    expect(a.why).toContain("gh pr edit 1478 --base main");
  });
  test("auto-merge left on for a stranded or stacked PR is reported (#1545)", () => {
    const prs: BoardPr[] = [
      { number: 1, headRefOid: "h", headRefName: "b1", baseRefName: "main" },
      { number: 2, headRefOid: "h", headRefName: "b2", baseRefName: "b1", autoMergeRequest: {} },
      { number: 3, headRefOid: "h", headRefName: "b3", baseRefName: "dead", autoMergeRequest: {} },
      { number: 4, headRefOid: "h", headRefName: "b4", baseRefName: "main", autoMergeRequest: {} },
    ];
    const v = decide(bd([st(1), st(2, { stackedOn: 1 }), st(3), st(4)]), prs);
    expect(strayAutoMerges(prs, v)).toEqual([2, 3]);
  });
  test("merge method: a stack takes a merge commit, a plain PR squashes", () => {
    const prs: BoardPr[] = [
      { number: 1, headRefOid: "h", headRefName: "b1", baseRefName: "main" },
      { number: 2, headRefOid: "h", headRefName: "b2", baseRefName: "b1" },
      { number: 3, headRefOid: "h", headRefName: "b3", baseRefName: "main" },
    ];
    const by = Object.fromEntries(decide(bd([st(1), st(2, { stackedOn: 1 }), st(3)]), prs).map((v) => [v.pr, v.method]));
    expect(by).toEqual({ 1: "merge", 2: undefined, 3: "squash" });
  });
  test("a failure that is also red on main says so", () => {
    const prs: BoardPr[] = [{ number: 1, headRefOid: "h", statusCheckRollup: [{ name: "apps", conclusion: "FAILURE", status: "COMPLETED" }] }];
    expect(decide(bd([st(1)]), prs, ["apps"])[0]!.why).toContain("also failing on main");
  });
});

describe("mervin stack", () => {
  test("clean PRs join as merge commits, a clashing one is left out, only certain/agree are picked", () => {
    const repo = mkdtempSync(join(tmpdir(), "mervin-stack-"));
    const g = (...a: string[]) => { const r = Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }; };
    const put = (f: string, t: string, m: string) => { writeFileSync(join(repo, f), t); g("add", "-A"); g("commit", "-qm", m); return g("rev-parse", "HEAD").out.trim(); };
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    const base = put("a.txt", "1\n2\n3\n", "base"); put("b.txt", "x\n", "b");
    const m = g("rev-parse", "HEAD").out.trim();
    g("checkout", "-qb", "q1", m); const h1 = put("a.txt", "one\n2\n3\n", "q1");
    g("checkout", "-qb", "q2", m); const h2 = put("c.txt", "new\n", "q2");
    g("checkout", "-qb", "q3", m); const h3 = put("a.txt", "uno\n2\n3\n", "q3");
    const mk = (n: number, h: string) => ({ number: n, headRefOid: h, title: `pr ${n}` });
    const r = buildStack(g, m, [mk(1, h1), mk(2, h2), mk(3, h3)], new Map([[1, "pr 1"], [2, "pr 2"], [3, "pr 3"]]));
    expect(r.joined).toEqual([1, 2]);
    expect(r.left.map((l) => l.pr)).toEqual([3]);
    expect(g("log", "--merges", "--format=%s", r.tip).out.trim().split("\n")).toEqual(["Merge #2: pr 2", "Merge #1: pr 1"]);
    expect(base).toBeTruthy();
    const row = (tier: any) => ({ path: "p", tier, why: "", after: [] });
    const board = { main: "m", at: "", skipped: [], clashes: [], written: [], stages: [{ pr: 1, head: "", base: "", files: [row("certain")] }, { pr: 2, head: "", base: "", files: [row("mervin")] }] };
    expect(stackable(board as any, [{ pr: 1, go: true, why: "", behind: [] }, { pr: 2, go: true, why: "", behind: [] }])).toEqual([1]);
  });
});

import { applyRenames, settleLockfiles, LOCK_WHY, nextStamp, settle, type Board, type Clash, type Stage } from "../scripts/mervin-board.ts";
describe("mervin settles clashes", () => {
  test("migrations: the later PR takes the next free stamp, and main's stamp moves every PR", () => {
    expect(nextStamp(["20261013040000", "20261013050000"])).toBe("20261013050001");
    const m = (prs: number[], main?: true): Clash => ({ kind: "migration", key: "db/migrations/20261013040000", prs, main, files: Object.fromEntries(prs.map((p) => [p, `db/migrations/20261013040000_p${p}.sql`])) });
    const [a, b] = settle([m([1432, 1455]), m([1503], true)], new Map([["db/migrations/", ["20261013040000"]]]));
    expect(a!.renumber).toEqual([{ pr: 1455, from: "db/migrations/20261013040000_p1455.sql", to: "db/migrations/20261013040001_p1455.sql" }]);
    expect(b!.renumber![0]!.to).toBe("db/migrations/20261013040002_p1503.sql");
    expect(a!.settled).toContain("#1455 to 20261013040001");
  });
  test("exports: same body keeps one, different bodies stay a card", () => {
    const e = (bodies: Record<number, string>): Clash => ({ kind: "export", key: "src/repos.ts repoRow", prs: Object.keys(bodies).map(Number), bodies });
    const [same, diff] = settle([e({ 1: "x", 2: "x" }), e({ 1: "x", 2: "y" })]);
    expect(same!.settled).toContain("kept one copy");
    expect(diff!.settled).toBeUndefined();
  });
  test("a lockfile both PRs changed keeps main's copy, not a card", () => {
    const repo = mkdtempSync(join(tmpdir(), "mervin-lock-"));
    const g = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }).stdout.toString().trim();
    const put = (t: string) => { writeFileSync(join(repo, "bun.lock"), t); g("add", "-A"); g("commit", "-qm", "c"); return g("rev-parse", "HEAD"); };
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
    const base = put('{\n  "a": 1,\n  "b": 2\n}\n');
    g("checkout", "-qb", "q", base); const q = put('{\n  "a": 1,\n  "b": 3\n}\n');
    g("checkout", "-q", "main"); const m = put('{\n  "a": 1,\n  "b": 4\n}\n');
    const { board, tree } = run(repo, m, [{ number: 1, headRefOid: q, headRefName: "q", baseRefName: "main" }]);
    expect(board.stages[0]!.files[0]!.tier).toBe("mervin");
    expect(tree.has("bun.lock")).toBe(false);
  });
});

describe("mervin carries out its settlements", () => {
  test("a renumbered migration moves to its new stamp in the tree and its stage's writes", () => {
    const old = "db/migrations/20261013040000_p2.sql", to = "db/migrations/20261013040001_p2.sql";
    const tree = new Map<string, string | null>([[old, "create table b;"], ["x.ts", "x"]]);
    const writes = [new Map<string, string | null>(), new Map<string, string | null>([[old, "create table b;"]])];
    const stages = [{ pr: 1 }, { pr: 2 }] as Stage[];
    applyRenames([{ kind: "migration", key: "db/migrations/20261013040000", prs: [1, 2], renumber: [{ pr: 2, from: old, to }] }], tree, writes, stages);
    expect(tree.get(to)).toBe("create table b;");
    expect(tree.get(old)).toBeNull();
    expect(writes[1]!.get(to)).toBe("create table b;");
    expect(writes[0]!.size).toBe(0);
  });
  const lockBoard = (): Board => ({ main: "m", at: "", skipped: [], clashes: [], written: [], stages: [{ pr: 7, head: "", base: "", files: [{ path: "bun.lock", tier: "mervin", why: LOCK_WHY, after: [] }] }] });
  test("a lockfile the install updates is kept in the tree", async () => {
    const root = mkdtempSync(join(tmpdir(), "mervin-install-"));
    const board = lockBoard();
    await settleLockfiles(root, board, async (r) => { writeFileSync(join(r, "bun.lock"), "new"); return { ok: true, out: "" }; });
    expect(readFileSync(join(root, "bun.lock"), "utf8")).toBe("new");
    expect(board.stages[0]!.files[0]!.tier).toBe("mervin");
    expect(board.written).toContain("bun.lock");
  });
  test("a failed install raises a card, which holds the PR", async () => {
    const board = lockBoard();
    await settleLockfiles("/nowhere", board, async () => ({ ok: false, out: "error: no matching version\n" }));
    const f = board.stages[0]!.files[0]!;
    expect(f.tier).toBe("card");
    expect(f.why).toContain("no matching version");
  });
});

describe("mervin board: a conflict with main", () => {
  test("is blamed on main, not on the earlier stage that edited the same line", () => {
    const repo = mkdtempSync(join(tmpdir(), "mervin-main-"));
    const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe" }).stdout.toString().trim();
    const commit = (text: string, msg: string) => { writeFileSync(join(repo, "f.ts"), text); git("add", "-A"); git("commit", "-qm", msg); return git("rev-parse", "HEAD"); };
    git("init", "-q", "-b", "main"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
    const base = commit("a\nb\nc\n", "base");
    git("checkout", "-qb", "q1");
    const q1 = commit("a\nq1\nc\n", "q1");
    git("checkout", "-qb", "q2", base);
    const q2 = commit("a\nq2\nc\n", "q2");
    git("checkout", "-q", "main");
    const main = commit("a\nmain\nc\n", "main moves");
    const { board } = run(repo, main, [
      { number: 1, headRefOid: q1, headRefName: "q1", baseRefName: "main" },
      { number: 2, headRefOid: q2, headRefName: "q2", baseRefName: "main" },
    ]);
    const [f1, f2] = board.stages.map((s) => s.files[0]!);
    expect(f1!.main).toBe(true);
    expect(f2!.main).toBe(true);
    expect(f2!.after).toEqual([]); // card on #1's line is not the cause: nothing landed before it
    rmSync(repo, { recursive: true, force: true });
  });
});

describe("mervin advice (#1519)", () => {
  const f = (path: string, tier: "certain" | "card" | "agree" = "certain", after: number[] = []) => ({ path, tier, why: "", after });
  const st = (pr: number, files = [f(`f${pr}.ts`)], extra = {}) => ({ pr, head: "h", base: "b", files, ...extra });
  const bd = (stages: any[], clashes: any[] = []) => ({ main: "m", at: "", stages, written: [], skipped: [], clashes }) as any;
  const red: BoardPr = { number: 1, headRefOid: "h", statusCheckRollup: [{ name: "apps", conclusion: "FAILURE", status: "COMPLETED" }] };
  test("a red PR that blocks others ranks first and gets a swarm; easy ones are offered as a stack", () => {
    const board = bd([st(1, [f("a.ts")]), st(2, [f("a.ts", "certain", [1])]), st(3, [f("a.ts", "certain", [1])]), st(4, [f("a.ts", "certain", [1])]), st(5), st(6)]);
    const h = advise(board, decide(board, [red]));
    expect(h.advice[0]).toMatchObject({ pr: 1, who: "a swarm", blocks: [2, 3, 4] });
    expect(h.warnings.some((w) => w.includes("overlap"))).toBe(true);
    expect(h.warnings.some((w) => w.includes("#1 blocks"))).toBe(true);
    expect(h.stack).toEqual([5, 6]);
    expect(h.advice.find((a) => a.pr === 2)!.who).toBe("none");
  });
  test("a lockfile or migration goes to a human, a clash across two PRs to two agents, a lone red PR to one", () => {
    const board = bd([st(1, [f("bun.lock")]), st(2, [f("x.ts")]), st(3, [f("y.ts")]), st(4, [f("z.ts")]), st(5, [f("w.ts")])],
      [{ kind: "export", key: "x.ts foo", prs: [2, 3] }, { kind: "migration", key: "m/1", prs: [5] }]);
    const prs: BoardPr[] = [1, 4].map((n) => ({ ...red, number: n }));
    const by = Object.fromEntries(advise(board, decide(board, prs)).advice.map((a) => [a.pr, a.who]));
    expect(by).toEqual({ 1: "a human", 2: "two agents", 3: "two agents", 4: "one agent", 5: "a human" });
  });
  test("quiet when nothing overlaps", () => {
    const board = bd([st(1), st(2)]);
    const h = advise(board, decide(board, []));
    expect(h.advice).toEqual([]);
    expect(h.warnings.some((w) => w.includes("overlap"))).toBe(false);
  });
});

describe("mervin board: a generated file (#1540)", () => {
  test("REFERENCE.md's Layout table is rebuilt from the merged tree, and its clean merge is a mervin row", () => {
    const root = mkdtempSync(join(tmpdir(), "mervin-gen-"));
    const app = join(root, "apps/codesplitter");
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(join(app, "src/a.ts"), "// Layout: the a\nexport {};\n");
    writeFileSync(join(app, "src/folder-mirror.ts"), "// Layout: the mirror\nexport {};\n");
    const ref = (rows: string[]) => `# R\n\n## Layout\n\n| File | What |\n|---|---|\n${rows.join("\n")}\n\nafter\n`;
    writeFileSync(join(app, "REFERENCE.md"), ref(["| `src/a.ts` | the a |"]));
    regenerate(root);
    const out = readFileSync(join(app, "REFERENCE.md"), "utf8");
    expect(out).toContain("| `src/folder-mirror.ts` | the mirror |");
    expect(out).toContain("| `migrations/` |");
    expect(out.endsWith("\nafter\n")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("mervin board: what the watch page streams", () => {
  test("a merged file carries its changed lines by who wrote them, with a line of context", () => {
    expect(linesOf("a\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n", "A\nb\nc\nd\ne\n", "A\nb\nc\nd\nE\n")).toEqual([
      { text: "A", side: "pr" }, { text: "b", side: "both" }, { text: "d", side: "both" }, { text: "E", side: "main" },
    ]);
  });

  test("--check runs become add and build lane steps", () => {
    expect(lanesOf([{ dir: ".", cmd: "bun install", ok: true }, { dir: ".", cmd: "bun run typecheck", ok: false }, { dir: "apps/x", cmd: "bun test", ok: true }])).toEqual([
      { lane: "add", name: "bun install", state: "ok" },
      { lane: "build", name: "bun run typecheck", state: "fail" },
      { lane: "build", name: "apps/x: bun test", state: "ok" },
    ]);
  });
});

import { conflictWarnings, disjointBatches, redOn, relandOf, rerunnable, settleMergeable, type Verdict } from "../scripts/mervin-merge.ts";
describe("mervin --go (#1730)", () => {
  const row = (path: string, tier: "certain" | "card", after: number[] = []) => ({ path, tier, why: "", after });
  const stage = (pr: number, files: ReturnType<typeof row>[]) => ({ pr, head: "h", base: "b", files });
  const board = (stages: ReturnType<typeof stage>[]) => ({ main: "m", at: "", stages, written: [], skipped: [], clashes: [] });
  const v = (pr: number, go: boolean, why = "", wave = 1): Verdict => ({ pr, go, why, wave, behind: [] });

  test("mergeable is polled until GitHub stops saying UNKNOWN", async () => {
    const seen: Record<number, string[]> = { 1: ["UNKNOWN", "UNKNOWN", "MERGEABLE"], 2: ["CONFLICTING"] };
    const calls: number[] = [];
    const got = await settleMergeable(async (n) => { calls.push(n); return seen[n]!.shift() ?? "MERGEABLE"; }, [1, 2], 5, 0, async () => {});
    expect(Object.fromEntries(got)).toEqual({ 1: "MERGEABLE", 2: "CONFLICTING" });
    expect(calls).toEqual([1, 2, 1, 1]);
  });

  test("a PR whose failing check ended before main went green gets a rerun, once", () => {
    const pr = (end: string): BoardPr => ({ number: 7, headRefOid: "h", statusCheckRollup: [{ name: "apps", conclusion: "FAILURE", status: "COMPLETED", completedAt: end }] });
    const held = [v(7, false, "CI failed: apps")];
    expect(redOn([{ name: "apps", conclusion: "failure" }, { name: "typecheck", conclusion: "success" }])).toEqual(["apps"]);
    expect(rerunnable([pr("2026-10-14T10:00:00Z")], held, ["apps"], "2026-10-14T11:00:00Z")).toEqual([7]);
    expect(rerunnable([pr("2026-10-14T12:00:00Z")], held, ["apps"], "2026-10-14T11:00:00Z")).toEqual([]);
    expect(rerunnable([pr("2026-10-14T10:00:00Z")], held, [], "2026-10-14T11:00:00Z")).toEqual([]);
  });

  test("warns that merging one PR makes a carded one conflict", () => {
    const b = board([stage(1, [row("a", "certain")]), stage(2, [row("a", "card", [1])]), stage(3, [row("b", "certain", [1])])]);
    expect(conflictWarnings(b, [v(1, true), v(2, false, "Mervin asks on a"), v(3, true, "", 2)])).toEqual(["merging #1 will make #2 conflict on a"]);
  });

  test("finds the PR a re-land puts back", () => {
    expect(relandOf({ title: "Reland: fix the thing (#12)", body: "Reland of #12, which broke main" })).toBe(12);
    expect(relandOf({ title: "x", body: "Reverts QuinnsCode/RustyBuns#40" })).toBe(40);
    expect(relandOf({ title: "Add a thing", body: "closes #3" })).toBeUndefined();
  });

  test("PRs sharing a file go in different batches; the rest go together", () => {
    const b = board([stage(1, [row("a", "certain")]), stage(2, [row("a", "certain")]), stage(3, [row("b", "certain")])]);
    expect(disjointBatches(b, [1, 2, 3])).toEqual([[1, 3], [2]]);
  });

  test("a 30-PR board batches in well under a second", () => {
    const b = board(Array.from({ length: 30 }, (_, i) => stage(i + 1, [row(`f${i % 10}`, "certain"), row(`own${i}`, "certain")])));
    const t = performance.now();
    const batches = disjointBatches(b, b.stages.map((s) => s.pr));
    expect(performance.now() - t).toBeLessThan(1000);
    expect(batches.flat().length).toBe(30);
    expect(batches.length).toBe(3);
  });
});
