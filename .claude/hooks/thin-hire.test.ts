import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstTry, hireTask, thin } from "./thin-hire.ts";

const long = "Fix the reorder button. ".repeat(15);

test.each([
  ["a short heredoc hire", "Bash", { command: "office-workers hire <<'EOF'\nfix the mirror\nEOF" }, true],
  ["a short --prompt hire", "Bash", { command: 'office-workers hire --prompt "fix the mirror"' }, true],
  ["a short hire with --issue", "Bash", { command: "office-workers hire --issue 12 <<'EOF'\nfix it\nEOF" }, false],
  ["a short task that names its issue", "Bash", { command: "office-workers hire <<'EOF'\nWork on GitHub issue #12\nEOF" }, false],
  ["a long heredoc hire", "Bash", { command: `office-workers hire <<'EOF'\n${long}\nEOF` }, false],
  ["the hire_worker tool, short", "mcp__agent-office__hire_worker", { prompt: "fix the mirror" }, true],
  ["the hire_worker tool with an issue", "mcp__agent-office__hire_worker", { prompt: "fix it", issue: 4 }, false],
  ["another command", "Bash", { command: "office-workers list" }, false],
] as const)("%s", (_, tool, input, nudged) => {
  const h = hireTask(tool, input);
  expect(!!(h && thin(h.task, h.issue))).toBe(nudged);
});

test("a thin task is turned away the first time and goes through when sent again", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "thin-hire-"));
  expect(firstTry("fix the mirror", dir)).toBe(true);
  expect(firstTry("fix the mirror", dir)).toBe(false);
  expect(firstTry("fix the button", dir)).toBe(true);
});
