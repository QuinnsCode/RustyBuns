import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { timesFromLog } from "./test-times.ts";
import { section } from "./ci-group.ts";

// #5564: a group job runs every app's suite even after one goes red, fails if any did, and its log splits back per app.
test("a group job runs each suite in its folder, fails when one fails, and its log splits back into each app's times", async () => {
  const at = (name: string, body: string) => {
    const dir = mkdtempSync(join(tmpdir(), `ci-group-${name}-`));
    writeFileSync(join(dir, "a.test.ts"), `import { test, expect } from "bun:test";\ntest("x", () => { ${body} });\n`);
    return dir;
  };
  const red = at("red", "expect(1).toBe(2);"), green = at("green", "expect(1).toBe(1);");
  const run = await Bun.$`bun ${import.meta.dir}/ci-group.ts ${red} ${"bun test ./a.test.ts"} ${green} ${"bun test ./a.test.ts"}`.quiet().nothrow();
  const log = run.stdout.toString() + run.stderr.toString();
  expect(run.exitCode).toBe(1);
  expect(log).toContain(`::error title=failed::${red}:`);
  expect(log).not.toContain(`${green}:`);
  // Both ran: one pass and one fail summed over the job, as ci-test-count.ts reads it.
  expect(log).toMatch(/ 1 pass/);
  expect(log).toMatch(/ 1 fail/);

  // GitHub's log keeps a timestamp on every line; each app gets only the lines after its own marker.
  const gh = [
    "2026-11-22T10:00:00.000Z ci-group: apps/borg",
    "2026-11-22T10:00:00.000Z test/a.test.ts:",
    "2026-11-22T10:00:02.000Z (pass) a [2000.00ms]",
    "2026-11-22T10:00:02.000Z ci-group: apps/qcrm",
    "2026-11-22T10:00:02.000Z test/a.test.ts:",
    "2026-11-22T10:00:03.000Z (pass) b [500.00ms]",
  ].join("\n");
  expect(Object.keys(timesFromLog(section(gh, "apps/borg")))).toEqual(["test/a.test.ts"]);
  expect(timesFromLog(section(gh, "apps/borg"))["test/a.test.ts"]).toBeGreaterThanOrEqual(2000);
  expect(timesFromLog(section(gh, "apps/qcrm"))["test/a.test.ts"]).toBeLessThan(2000);
});
