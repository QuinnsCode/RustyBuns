// One test red on PR after PR (a blocker), through Mervin: its fix sorts first, the PRs it holds wait instead of
// failing, a PR with a failure of its own still fails, and once the fix lands each held PR gets main merged in.
import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockerLines, blockerMark, blockerOf, jumpLine, withFixes } from "../ester/blockers.ts";
import { line, mervinBoard, openPrs } from "../screens/read.ts";
import { type AfterPr, type Gh, pass } from "../../../scripts/after.ts";

setDefaultTimeout(30_000);

const TEST = "test/room-setup.test.ts › the studio is asked on the first room only";

test("a blocker's fix goes first, the PRs it holds wait, and once it lands they get main merged in", () => {
  // #50 is the blocker's issue: the test is red on #11, #12, #13 and #14 (which is also red on typecheck); #20 fixes it.
  const issue = { number: 50, body: `The same test failed on 4 PRs.\n\n${blockerMark({ test: TEST, prs: [11, 12, 13, 14], checks: ["test fm-daw"] })}` };
  const checks: Record<number, string[]> = { 11: ["test fm-daw 2/3"], 12: ["test fm-daw 1/3"], 13: ["test fm-daw 2/3"], 14: ["test fm-daw 2/3", "typecheck"], 15: [], 20: [] };
  const prs = [11, 12, 13, 14, 15, 20].map((n) => ({ number: n, title: `PR ${n}`, body: n === 20 ? "Fixes #50: the room-setup wait" : "Merge after: nothing" }));
  const blockers = withFixes([blockerOf(issue)!], prs);
  expect(blockers[0]).toMatchObject({ issue: 50, fix: 20 });

  // Mervin's order: the fix first, the rest as they were.
  const order = jumpLine(prs, blockers).map((p) => p.number);
  expect(order).toEqual([20, 11, 12, 13, 14, 15]);

  // His board's lines as mervin-board.ts prints them, read back by the wall screens.
  const open = order;
  const lines = order.flatMap((n, i) => [`stage ${i + 1}: #${n} PR ${n}`, "  1 files, 100% certain   certain 1  agree 0  mervin 0  differ 0  card 0", ...blockerLines(n, checks[n]!, blockers, open)]);
  const board = mervinBoard(lines);
  expect(board.stages[0]!.fixes).toBe(`fixes the red check holding 4 PRs (#50 ${TEST})`);
  expect(board.stages.filter((s) => s.waitingOn).map((s) => [s.pr, s.waitingOn])).toEqual([[11, 20], [12, 20], [13, 20]]);
  expect(lines.find((l) => l.includes("failing on its own"))).toBe(`  failing on its own (typecheck), and also red on ${TEST}, held by #20`);

  // On the line: the three wait on #20, #14 is stuck on its own failure.
  const gh = openPrs(order.map((n) => ({ number: n, title: `PR ${n}`, url: `u/${n}`, isDraft: false, statusCheckRollup: checks[n]!.length ? checks[n]!.map(() => ({ conclusion: "FAILURE" })) : [{ conclusion: "SUCCESS" }] })));
  const idle = { phase: "idle" as const, lines: [], hold: [] };
  const cars = new Map(line(gh, { phase: "green", lines, hold: [] }, idle).map((c) => [c.pr, c]));
  for (const n of [11, 12, 13]) expect(cars.get(n)).toMatchObject({ state: "waiting", on: 20 });
  expect(cars.get(14)!.state).toBe("stuck");

  // #20 lands and closes #50: after.ts merges main into each held PR once, so its checks rerun on the fix.
  const root = mkdtempSync(join(tmpdir(), "blockers-"));
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
    const commit = (file: string) => { writeFileSync(join(dev, file), `${file}\n`); ok(dev, "add", "-A"); ok(dev, "commit", "-qm", file); };
    commit("base.ts");
    ok(dev, "push", "-q", "origin", "HEAD:main");
    for (const n of [11, 12, 13, 14, 15]) {
      ok(dev, "checkout", "-q", "-B", `pr-${n}`, "main");
      commit(`pr-${n}.ts`);
      ok(dev, "push", "-q", "origin", `pr-${n}`);
    }
    ok(root, "clone", "-q", origin, ci);
    const afterPrs: AfterPr[] = [11, 12, 13, 14, 15].map((n) => ({ number: n, headRefName: `pr-${n}`, body: "Merge after: nothing", author: { login: "w" }, isCrossRepository: false, labels: [] }));
    const said = new Map<number, string[]>();
    let closed: { number: number; body: string; closedAt: string }[] = [];
    const fake: Gh = {
      open: () => afterPrs, state: () => "OPEN", setBody: () => {}, runs: () => [],
      comment: (n, text) => { said.set(n, [...(said.get(n) ?? []), text]); },
      head: (n) => ({ headRefOid: ok(origin, "rev-parse", `pr-${n}`), commits: [], comments: (said.get(n) ?? []).map((body) => ({ body })) }),
      closedBlockers: () => closed,
    };
    const git = (...a: string[]) => run(ci, ...a);

    expect(pass(fake, git, { token: true })).toEqual([]); // #50 still open: nothing moves

    ok(dev, "checkout", "-q", "main");
    commit("fix.ts"); // #20 lands
    ok(dev, "push", "-q", "origin", "main");
    closed = [{ ...issue, closedAt: new Date().toISOString() }];

    expect(pass(fake, git, { token: true })).toEqual([11, 12, 13, 14].map((n) => `#${n} merged main in and pushed after blocker #50`));
    for (const n of [11, 12, 13, 14]) expect(ok(origin, "ls-tree", "--name-only", `pr-${n}`).split("\n")).toContain("fix.ts");
    expect(ok(origin, "ls-tree", "--name-only", "pr-15").split("\n")).not.toContain("fix.ts"); // never held
    expect(said.get(11)![0]).toContain(`(${TEST}) is fixed on main`);
    // once each: the next pass (after.yml runs on every push to main) leaves them be
    expect(pass(fake, git, { token: true })).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
