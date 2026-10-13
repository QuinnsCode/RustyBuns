import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countOf, hung, notice, reported, testFiles } from "./ci-test-count.ts";

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

test("a run past its budget is killed, process tree and all, and exits 124", async () => {
  const started = Date.now();
  const p = Bun.spawn(["bun", join(import.meta.dir, "ci-test-count.ts"), "--budget", "0.02", "sleep 30 & sleep 30"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GITHUB_STEP_SUMMARY: "" } });
  const out = await new Response(p.stdout).text();
  expect(await p.exited).toBe(124);
  expect(out).toContain("::error title=hung::Still running after 0.02 min, killed.");
  // The background sleep held the pipe open too: had it lived, reading stdout would have waited 30s.
  expect(Date.now() - started).toBeLessThan(10_000);
});
