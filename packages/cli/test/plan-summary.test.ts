import { test, expect } from "bun:test";
import { formatPlanSummary, readPlanRows } from "../src/plan-summary.ts";

// Alchemy's plain plan log (LoggingCli's formatPlanLines): a coloured `[id]` tag, then the action; bindings as `[id/sid]`.
const tag = (id: string) => `\x1b[38;2;80;160;255m[${id}]\x1b[0m`;
// Each line carries the plain log's `[time] INFO: ` prefix, as Alchemy beta.87 prints it.
const log = (rows: [string, string][]) => ["\x1b[1mPlan:\x1b[0m 1 to update", ...rows.map(([id, a]) => `${tag(id)} ${a}`), `${tag("Worker/BACKUP")} noop`]
  .map((l) => `\x1b[90m[00:01:08.172]\x1b[0m INFO: ${l}`).join("\n");
const types = { BACKUP: "R2.Bucket", Worker: "Worker", Build: "Command.Build" };

test.each([
  ["the fm-daw deploy: kept bucket, updated Worker", [["BACKUP", "noop"], ["Build", "update"], ["Worker", "update"]], ["KEEP     BACKUP (R2.Bucket)", "UPDATE   Worker (Worker)", "safe: nothing is replaced or deleted."], "STOP"],
  ["a protected bucket replaced", [["BACKUP", "replace"], ["Worker", "update"]], ["REPLACE  BACKUP (R2.Bucket)", "STOP: BACKUP is replaced", "BACKUP is protected (protect: true), which only covers destroy."], "safe"],
  ["a database deleted", [["DB", "delete"]], ["DELETE   DB", "STOP: DB is deleted"], "safe"],
] as const)("plan summary: %s", (_, rows, has, hasNot) => {
  const out = formatPlanSummary(readPlanRows(log(rows.map(([a, b]) => [a, b]))), types, new Set(["BACKUP"]), false);
  for (const h of has) expect(out).toContain(h);
  expect(out).not.toContain(hasNot);
  expect(out).not.toContain("Worker/BACKUP");
});

test("plan summary: a log it can't read says nothing, never a false safe", () => {
  expect(formatPlanSummary(readPlanRows("│ [~] Worker (Cloudflare.Worker)\n· BACKUP"))).toBe("");
});

test("plan summary: REPLACE is orange", () => {
  expect(formatPlanSummary([{ id: "BACKUP", action: "replace" }])).toContain("\x1b[1;38;5;208mREPLACE");
});
