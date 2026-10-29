import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failures, shadow, testRuns, useRepo, writeMerge } from "../scripts/shadow.ts";

// scripts/shadow.ts (#1014): codeSplitter's merge beside git's, one file's three versions at a time.
describe("shadow mode", () => {
  test("the same clean merge both ways agrees", () => {
    const s = shadow("a.ts", "a\nb\nc\nd\ne\n", "A\nb\nc\nd\ne\n", "a\nb\nc\nd\nE\n");
    expect(s.verdict).toBe("agree");
    expect(s.git.text).toBe("A\nb\nc\nd\nE\n");
  });

  test("lines changed next to each other: git conflicts, a merge by line id doesn't, and what landed is checked", () => {
    const s = shadow("a.ts", "a\nb\nc\n", "A\nb\nc\n", "a\nB\nc\n", "", "A\nB\nc\n");
    expect(s.verdict).toBe("git-only");
    expect(s.ours.text).toBe("A\nB\nc\n");
    expect(s.landed).toEqual({ git: false, ours: true, off: 0, reordered: false });
  });

  test("a resolution that only put the lines in another order says so", () => {
    const s = shadow("n.md", "a\n", "a\nmain\n", "a\nbranch\n", "", "a\nbranch\nmain\n");
    expect(s.verdict).toBe("git-only");
    expect(s.landed).toMatchObject({ ours: false, reordered: true });
  });

  test("the same line added in two places: git lands it twice, ours asks (#244's .gitignore)", () => {
    const s = shadow(".gitignore", ".env\n.env.*\n!.env.example\n.dev.vars\n", ".env\n.env.*\n!.env.schema\n!.env.example\n.dev.vars\n", ".env\n.env.*\n!.env.example\n!.env.schema\n.dev.vars\n");
    expect(s.verdict).toBe("ours-only");
    expect(s.git.text).toBe(".env\n.env.*\n!.env.schema\n!.env.example\n!.env.schema\n.dev.vars\n");
    expect(s.ours.conflicts).toMatchObject([{ doubled: true, main: "!.env.schema", branch: "!.env.schema" }]);
  });

  test("a merge git calls clean that declares a name twice trips the lint guard", () => {
    const base = "export const a = 1;\n\n\n\nexport const b = 2;\n";
    const s = shadow("x.ts", base, `const x = 1;\n${base}`, `${base}const x = 2;\n`);
    expect(s.git.clean).toBe(true);
    expect(s.verdict).toBe("guard");
    expect(s.ours.conflicts.map((c) => c.line)).toEqual(["lint:redeclared:x"]);
  });

  test("a lockfile both changed is a conflict by design, not a gap", () => {
    const s = shadow("bun.lock", "a\nb\nc\nd\n", "A\nb\nc\nd\n", "a\nb\nc\nD\n");
    expect(s.git.clean).toBe(true);
    expect(s.verdict).toBe("lock");
  });

  test("a line rewritten beside one main added that sets the same thing is a card, not both kept (#2737)", () => {
    const base = "const k = kessa(c);\nk.orbit = \"marines\";\nfor (const x of k.sectors) x.wooka = 0;\n";
    const main = base.replace("\"marines\";\n", "\"marines\";\nk.fleets = { marines: 3 };\n");
    const s = shadow("rules.test.ts", base, main, base.replace("k.orbit = \"marines\"", "k.fleets = { marines: 0 }"));
    expect(s.verdict).toBe("both");
    expect(s.ours.conflicts).toMatchObject([{ main: "k.orbit = \"marines\";\nk.fleets = { marines: 3 };", branch: "k.fleets = { marines: 0 };" }]);
    // Setting something else beside it still lands both.
    expect(shadow("rules.test.ts", base, main, base.replace("k.orbit = \"marines\"", "k.sky = 0")).ours.text).toBe(main.replace("k.orbit = \"marines\"", "k.sky = 0"));
  });

  test("both conflict", () => {
    expect(shadow("a.ts", "foo(1)\n", "foo(2)\n", "foo(3)\n").verdict).toBe("both");
  });
});

// --check (#1043): build and test each merge git conflicted on and ours didn't.
describe("shadow --check", () => {
  test("runs each touched app's tests as that tree's ci-apps.ts did, and packages' for packages/", () => {
    const ciApps = `export const APPS = {
  "codesplitters":     { test: "bun test --parallel test", boot: true },
  "example":           { boot: true, drop: false },
  "two-fronts":        { test: "bun test test", drop: false },
};`;
    expect(testRuns(ciApps, ["apps/codesplitters/src/a.ts", "apps/codesplitters/test/a.test.ts", "apps/example/x.ts", "packages/cli/y.ts", "README.md"])).toEqual([
      { dir: "apps/codesplitters", cmd: "bun test --parallel test" },
      { dir: ".", cmd: "bun test packages" },
    ]);
    expect(testRuns(ciApps, ["apps/two-fronts/a.ts"])).toEqual([{ dir: "apps/two-fronts", cmd: "bun test test" }]);
    expect(testRuns("", ["apps/two-fronts/a.ts"])).toEqual([]);
  });

  test("names the tests a run failed, so only the ones that pass as landed count", () => {
    const run = { dir: "apps/codesplitters", cmd: "bun test test" };
    const out = "(pass) ok [1.00ms]\n(fail) the container's /test > a bad remote fails cleanly [14.37ms]\n(fail) slow one [5001.11ms]\n  ^ this test timed out\n(fail) the container's /test > a bad remote fails cleanly [14.37ms]\n";
    expect(failures(run, out)).toEqual(["apps/codesplitters: the container's /test > a bad remote fails cleanly", "apps/codesplitters: slow one"]);
    expect(failures(run, "error: Cannot find module")).toEqual(["apps/codesplitters: bun test test"]);
  });

  test("writes git's merge with ours over its conflicts and what landed over the rest", () => {
    const repo = mkdtempSync(join(tmpdir(), "shadow-repo-"));
    const out = join(repo, "..", `${repo.split("/").pop()}-out`);
    const sh = (cmd: string) => {
      const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
      if (r.exitCode) throw new Error(r.stderr.toString());
      return r.stdout.toString().trim();
    };
    const commit = (files: Record<string, string>) => {
      for (const [p, t] of Object.entries(files)) writeFileSync(join(repo, p), t);
      sh("git add -A && git commit -qm c");
      return sh("git rev-parse HEAD");
    };
    try {
      sh("git init -q");
      const base = commit({ "a.ts": "a\nb\nc\n", "b.ts": "x\n", "c.ts": "1\n2\n3\n4\n5\n" });
      const main = commit({ "a.ts": "A\nb\nc\n", "b.ts": "main\n", "c.ts": "one\n2\n3\n4\n5\n" });
      sh(`git checkout -q ${base}`);
      const branch = commit({ "a.ts": "a\nB\nc\n", "b.ts": "branch\n", "c.ts": "1\n2\n3\n4\nfive\n" });
      const landed = commit({ "a.ts": "A\nB\nc\n", "b.ts": "both\n", "c.ts": "landed's own\n" });
      useRepo(repo);
      writeMerge(out, main, branch, landed, new Map([["a.ts", "A\nB\nc\n"]]));
      expect(readFileSync(join(out, "a.ts"), "utf8")).toBe("A\nB\nc\n");   // ours over git's conflict
      expect(readFileSync(join(out, "b.ts"), "utf8")).toBe("both\n");        // a conflict ours didn't take: what landed
      expect(readFileSync(join(out, "c.ts"), "utf8")).toBe("one\n2\n3\n4\nfive\n"); // git's clean merge, not what landed
      expect(existsSync(join(out, ".git"))).toBe(false);
    } finally {
      useRepo();
      rmSync(repo, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});
