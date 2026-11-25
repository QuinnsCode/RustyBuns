import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countOf, hung, limits, limitOf, notice, reported, slow, testFiles } from "./ci-test-count.ts";

const parallelOut = "bun test v1.4.3 8x PARALLEL\n\ntest/a.test.ts:\n(pass) a1\n\n\x1b[1mtest/d.test.ts:\x1b[0m\n(pass) d1\n";

test("sums bun's closing summaries", () => {
  const t = countOf(" 3 pass\n 1 fail\n 2 skip\n 1 todo\n 4 pass\n")!;
  expect(t).toEqual({ pass: 7, fail: 1, skip: 3 });
  expect(notice(t)).toBe("::notice title=tests::7 pass, 1 fail, 3 skip");
  expect(countOf("no summary")).toBeUndefined();
});

test("reads the file headers bun printed, ANSI and all", () => {
  const r = reported(parallelOut + "src/not-a-test.ts:\nerror: x\n");
  expect([...r.seen]).toEqual(["test/a.test.ts", "test/d.test.ts"]);
  expect(r.last).toBe("test/d.test.ts");
});

test("one file at a time, the last header is the hung file", () => {
  expect(hung("bun test v1.4.3\n\ntest/b.test.ts:\n", ["test/a.test.ts", "test/b.test.ts"], 10, false))
    .toBe("::error title=hung::Still running after 10 min, killed. last to report: test/b.test.ts");
});

test("with --parallel, the files that never reported are suspects too", () => {
  const files = ["test/a.test.ts", "test/b.test.ts", "test/d.test.ts"];
  expect(hung(parallelOut, files, 10, true))
    .toBe("::error title=hung::Still running after 10 min, killed. last to report: test/d.test.ts; never reported: test/b.test.ts");
  expect(hung("", files, 5, false)).toContain("never reported: test/a.test.ts, test/b.test.ts, test/d.test.ts");
  const many = Array.from({ length: 10 }, (_, i) => `t/${i}.test.ts`);
  expect(hung("", many, 5, true)).toEndWith("t/7.test.ts (+2 more)");
});

test("finds the files a bun test command would run", () => {
  const dir = mkdtempSync(join(tmpdir(), "ci-test-count-"));
  for (const f of ["test/a.test.ts", "test/sub/b_spec.tsx", "test/helper.ts", "tests/c.test.js", "node_modules/x/d.test.ts", ".cache/e.test.ts", "src/f.test.ts"]) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "");
  }
  expect(testFiles("bun test --parallel test", dir)).toEqual(["test/a.test.ts", "test/sub/b_spec.tsx"]);
  expect(testFiles("bun test", dir)).toEqual(["src/f.test.ts", "test/a.test.ts", "test/sub/b_spec.tsx", "tests/c.test.js"]);
  expect(testFiles("bun test c.test", dir)).toEqual(["tests/c.test.js"]);
  expect(testFiles("bun test ./src/f.test.ts", dir)).toEqual(["src/f.test.ts"]);
});

test("reads each test's limit from its file", () => {
  const src = [
    "setDefaultTimeout(240_000);",
    'test.skipIf(!hasChrome)("own limit", async () => { await f("a, b)"); }, 30_000);',
    'it("options first", { timeout: 9000 }, () => { spawnSync([], { timeout: 1 }); });',
    "test(`row ${n} loads`, () => {}, 2000);",
    'test("inner timeout only", () => { run({ timeout: 7 }); });',
  ].join("\n");
  const l = limits(src, 5000);
  const rows: [string, number][] = [["own limit", 30_000], ["grp > options first", 9000], ["row 3 loads", 2000], ["inner timeout only", 240_000], ["unnamed", 240_000]];
  expect(rows.map(([t]): [string, number] => [t, limitOf(l, t)])).toEqual(rows);
  expect(limitOf(limits("test('x', () => {});", 30_000), "x")).toBe(30_000);
});

test("a test near its limit warns, and fails only in a file the PR changed", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-slow-"));
  mkdirSync(join(root, "apps/a/test"), { recursive: true });
  mkdirSync(join(root, "apps/b/test"), { recursive: true });
  writeFileSync(join(root, "apps/a/test/room.test.ts"), "setDefaultTimeout(240_000);\ntest('fast', () => {}, 1000);\n");
  writeFileSync(join(root, "apps/b/test/x.test.ts"), "");
  const out = (ms: number) => `apps/a/test/room.test.ts:\n(pass) room > walks in [${ms}.00ms]\n(pass) fast [600.00ms]\n`;
  const changed = new Set(["apps/a/test/room.test.ts"]);
  // ms, changed?, verdicts (fail or warn, per line)
  const rows: [number, boolean, ("fail" | "warn")[]][] = [
    [100_000, true, ["warn"]],          // 42% of 240 s: only the 600 of 1000 ms one
    [130_000, false, ["warn", "warn"]], // 54%
    [239_000, false, ["warn", "warn"]], // 99%, but the PR didn't touch it
    [239_000, true, ["fail", "warn"]],
  ];
  for (const [ms, touched, want] of rows) {
    const v = slow(`bun test v1.4.3\n\n${out(ms)}`, "bun test test", touched ? changed : new Set(), root, root);
    expect(v.map((x) => (x.fail ? "fail" : "warn"))).toEqual(want);
  }
  const [fail] = slow(out(239_000), "bun test", changed, root, root);
  expect(fail!.line).toBe("::error file=apps/a/test/room.test.ts,title=slow test::room > walks in took 239 s of its 240 s limit (100%). Make it faster or split it: raising the timeout isn't a fix, the next slower runner times it out.");
  // A lane runs in its app's folder; a group job marks each app's folder; --timeout is the default with no setDefaultTimeout.
  expect(slow("test/x.test.ts:\n(pass) y [4000.00ms]\n", "bun test --timeout 5000 test", new Set(), join(root, "apps/b"), root)[0]!.line)
    .toStartWith("::warning file=apps/b/test/x.test.ts,title=slow test::y took 4.0 s of its 5.0 s limit (80%).");
  expect(slow("ci-group: apps/b\ntest/x.test.ts:\n(fail) y [5001.00ms]\n", "bun scripts/ci-group.ts apps/b 'bun test test'", new Set(["apps/b/test/x.test.ts"]), root, root)[0]!.fail).toBe(true);
  // On GitHub Actions bun wraps each file in ::group::, and its closing list repeats a failure with no header.
  const actions = "::group::test/room.test.ts:\n(fail) room > walks in [239000.00ms]\n::endgroup::\n\n1 tests failed:\n(fail) room > walks in [239000.00ms]\n";
  expect(slow(actions, "bun test", changed, join(root, "apps/a"), root).map((v) => v.line.split("::")[1]))
    .toEqual(["error file=apps/a/test/room.test.ts,title=slow test"]);
});

test("a run past its budget is killed, process tree and all, and exits 124", async () => {
  const started = Date.now();
  const p = Bun.spawn(["bun", join(import.meta.dir, "ci-test-count.ts"), "--budget", "0.02", "sleep 30 & sleep 30"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(124);
  expect(out).toContain("::error title=hung::Still running after 0.02 min, killed.");
  // The background sleep held the pipe open too: had it lived, reading stdout would have waited 30s.
  expect(Date.now() - started).toBeLessThan(10_000);
});
