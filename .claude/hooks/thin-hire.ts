// A thin hire gets one nudge (guard.ts runs it on `office-workers hire` and the hire_worker tool). In the office's own runs
// (notes/TASK_SPECS.md), a task under 50 words with no issue merged 60% of the time and needed the owner 2.1 times per
// run; one that wrote down its decisions merged 77% with 0.7. So a short task with no issue is turned away once, with
// what to add. Sending the same task again hires it as it is.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { check, obj, opt, raw, str } from "../../packages/util/src/guard.ts";

export const WORDS = 50;

/** The parts of a Bash call or a hire_worker call that say what is being hired. */
const Call = obj({ command: opt(str(1e6)), prompt: opt(str(1e6)), issue: opt(raw) });

/** The task a hire sends, and whether it names an issue; null when the call isn't a hire. */
export function hireTask(tool: string, input: unknown): { task: string; issue: boolean } | null {
  const c = check(Call, input);
  if (!c) return null;
  if (tool === "mcp__agent-office__hire_worker") return { task: c.prompt ?? "", issue: c.issue !== undefined };
  if (tool !== "Bash") return null;
  const cmd = c.command ?? "";
  if (!/\boffice-workers\s+hire\b/.test(cmd)) return null;
  const doc = cmd.match(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\s*(?:\n|$)/);
  const flag = cmd.match(/--prompt[ =](?:"((?:[^"\\]|\\.)*)"|'([^']*)')/);
  return { task: doc?.[2] ?? flag?.[1] ?? flag?.[2] ?? "", issue: /--issue\b/.test(cmd) };
}

/** What a thin task is missing, or null when it is fine (long enough, or it points at an issue). */
export function thin(task: string, issue: boolean): string | null {
  if (issue || /\bissue #?\d+/i.test(task) || /\/issues\/\d+/.test(task)) return null;
  const words = task.split(/\s+/).filter(Boolean).length;
  if (!words || words >= WORDS) return null;
  return `this task is ${words} words with no issue. In the office's runs a task that short merged 60% of the time and needed the owner about twice per run; one that wrote down its decisions merged 77% and needed them under once (notes/TASK_SPECS.md). Add what it must and must not do, a file to start in, and how to check the work, or point it at an issue (--issue N). Send the same task again to hire it as it is`;
}

/** True the first time a task is seen (so it is turned away), false after: the second try goes through. */
export function firstTry(task: string, dir = path.join(tmpdir(), "rustybuns-thin-hire")): boolean {
  const file = path.join(dir, createHash("sha256").update(task.trim()).digest("hex").slice(0, 16));
  if (existsSync(file)) return false;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, "");
  return true;
}
