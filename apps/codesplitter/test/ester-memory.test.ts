import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromJunit, hot, idOf, recall, recallLines, remember, resolve, unresolved, withJunit } from "../scripts/ester-memory.ts";

const tc = (name: string, file: string, classname = "", body = "") =>
  body ? `<testcase name="${name}" classname="${classname}" time="0.01" file="${file}">${body}</testcase>` : `<testcase name="${name}" classname="${classname}" time="0.01" file="${file}" />`;
const xml = (cases: string[]) => `<?xml version="1.0"?><testsuites>${cases.join("")}</testsuites>`;

// scripts/ester-memory.ts: each test has an id, and what happened to it is kept across runs.
describe("ester's memory", () => {
  const dir = "apps/a";
  // a journey (hot) and two units; the unit `mirror > pushes` fails on day one, then passes
  const red = xml([tc("pushes", "test/mirror.test.ts", "mirror", `<failure message="expect(received).toBe(expected)&#10;">boom</failure>`), tc("splits", "test/util.test.ts", "util"), tc("round trip", "test/journey.test.ts", "journey"), tc("later", "test/util.test.ts", "util", "<skipped />")]);
  const green = xml([tc("pushes", "test/mirror.test.ts", "mirror"), tc("splits", "test/util.test.ts", "util"), tc("round trip", "test/journey.test.ts", "journey")]);
  const hotOf = (f: string) => hot(f.includes("journey") ? `import { local } from "./app-kit.ts";` : `import { splits } from "../src/util.ts";`);

  test("a JUnit report becomes tests with console names and stable ids, nested describes in order", () => {
    const seen = fromJunit(xml([tc("deep", "test/b.test.ts", "in &gt; o"), tc("top", "test/b.test.ts")]), dir);
    expect(seen.map((s) => [s.name, s.status])).toEqual([["o > in > deep", "pass"], ["top", "pass"]]);
    expect(seen[0]!.id).toBe(idOf(dir, "o > in > deep"));
    expect(fromJunit(red, dir).map((s) => s.status)).toEqual(["fail", "pass", "pass", "skip"]);
    expect(withJunit({ dir, cmd: "bun test --parallel test" }, "/o")).toEqual({ dir, cmd: "bun test --parallel test", junit: "/o/apps-a.xml" });
    expect(withJunit({ dir: ".", cmd: "bun run typecheck" }, "/o").junit).toBeUndefined();
  });

  test("a failure is an open incident until a PR resolves it, and quiet units are named as cut candidates", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ester-memory-"));
    try {
      const file = join(tmp, "sub/memory.jsonl");
      expect(recallLines(recall(file))[0]).toContain("remembers nothing yet");
      remember(file, fromJunit(red, dir), "board 1", hotOf, "2026-10-20T10:00:00Z");
      appendFileSync(file, "{torn\n");
      remember(file, fromJunit(green, dir), "board 2", hotOf, "2026-10-21T10:00:00Z");

      const m1 = recall(file);
      const pushes = m1.tests.find((t) => t.name === "mirror > pushes")!;
      expect(m1.runs).toBe(2);
      expect(pushes).toMatchObject({ runs: 2, fails: 1, last: "pass", hot: false });
      expect(unresolved(pushes)).toBe(true);
      const open = recallLines(m1, 2).join("\n");
      expect(open).toContain("4 tests across 2 runs; 1 failed at least once: 0 fixed by a PR, 0 stale, 0 flaky, 1 unresolved");
      expect(open).toContain(`${pushes.id}  apps/a: mirror > pushes   failed 2026-10-20, passed again 2026-10-21`);
      // the never-failed list skips the journey and the test that failed, and waits for `min` runs
      expect(open).toContain("never failed in 2+ runs and not a journey through the app: 1 test,");
      expect(open).toContain("apps/a/test/util.test.ts");
      expect(open).not.toContain("journey.test.ts");
      expect(recallLines(m1, 3).join("\n")).not.toContain("never failed");

      // resolved by its console name, the way Ester's own verdicts know it; the PR is the incident report
      expect(resolve(file, "apps/a: mirror > pushes", "fix", 1234, undefined, "2026-10-22T10:00:00Z")).toBe(pushes.id);
      expect(resolve(file, "apps/a: nobody", "fix", 1)).toBeNull();
      const m2 = recallLines(recall(file), 2).join("\n");
      expect(m2).toContain("1 fixed by a PR, 0 stale, 0 flaky, 0 unresolved");
      expect(m2).toContain("apps/a/test/mirror.test.ts");
      expect(m2).toContain("fixed 1 (#1234)");
      expect(m2).not.toContain("unresolved:");

      // a later failure of the same test reopens it (still failing: no pass since); a stale verdict by id closes it
      remember(file, fromJunit(red, dir), "board 3", hotOf, "2026-10-23T10:00:00Z");
      const m3 = recallLines(recall(file), 2).join("\n");
      expect(m3).toContain(`${pushes.id}  apps/a: mirror > pushes   failed 2026-10-23, still failing`);
      expect(m3).not.toContain("stale-prone");
      resolve(file, pushes.id, "stale", 1300, "the push path changed", "2026-10-24T10:00:00Z");
      const m4 = recallLines(recall(file), 2).join("\n");
      expect(m4).toContain("1 fixed by a PR, 1 stale, 0 flaky, 0 unresolved");
      expect(m4).toContain("2 fails in 1 test   fixed 1 (#1234)  stale 1 (#1300)  flaky 0  unresolved 0");
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});
