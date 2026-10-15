import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { project, propose, standing, render, tally, trimDiff, trimLine, week, type Report } from "../ester/dexter.ts";

const fresh = (): Report => ({ sessions: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0 });
const j = (o: unknown) => JSON.stringify(o);

test("tokens add up once per message, and each result is charged to the tool that made it", () => {
  const r = fresh();
  const reply = (blocks: unknown[]) => j({ type: "assistant", message: { id: "m1", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }, content: blocks } });
  tally(
    [
      reply([{ type: "tool_use", id: "a", name: "Read" }]),
      reply([{ type: "tool_use", id: "b", name: "mcp__codesplitter__read_file" }]), // same message id: usage counted once
      j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "x".repeat(4000) }] } }),
      j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "y".repeat(400) }] }] } }),
      "not json",
    ],
    r,
  );
  expect(r.usage).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 0 });
  expect(r.tools.get("Read")).toEqual({ calls: 1, tokens: 1000, worst: 1000 });
  expect(r.tools.get("mcp:codesplitter")!.tokens).toBe(100);
  const out = render(r).join("\n");
  expect(out).toContain("Read: 1k over 1 calls");
  expect(out).toContain("offset+limit");
});

test("nothing to trim is said plainly", () => {
  expect(render(fresh())[1]).toBe("No tool results. Nothing to trim.");
});

test("a line is cut to short plain words, but code, links and capitals are kept", () => {
  expect(trimLine("Please make sure you really run `in order to` first, in order to win.")).toBe("Make sure you run `in order to` first, to win.");
  expect(trimLine("See [prior to](http://a.b/utilize) and utilize it.")).toBe("See [prior to](http://a.b/utilize) and use it.");
  expect(trimLine("Short line.")).toBe("Short line.");
});

test("the diff skips fences, tables and headings, and counts line numbers from 1", () => {
  const src = ["# Please head", "basically fine text", "```", "basically code", "```", "| basically | x |"].join("\n");
  expect(trimDiff("A.md", src)!.diff).toBe("--- a/A.md\n+++ b/A.md\n@@ -2 +2 @@\n-basically fine text\n+fine text");
  expect(trimDiff("B.md", "Already short.")).toBeNull();
});

test("a skill's description is trimmed, the rest of its front matter is not", () => {
  const src = ["---", "name: basically-x", "description: Use it in order to merge.", "---", "# T"].join("\n");
  expect(trimDiff("S.md", src)!.diff).toBe("--- a/S.md\n+++ b/S.md\n@@ -3 +3 @@\n-description: Use it in order to merge.\n+description: Use it to merge.");
});

test("standing text includes skill files", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "dexter-"));
  mkdirSync(path.join(repo, ".claude/skills/x"), { recursive: true });
  writeFileSync(path.join(repo, ".claude/skills/x/SKILL.md"), "---\ndescription: d\n---\n");
  expect(standing(repo, path.join(repo, "none")).map(([n]) => n)).toEqual([".claude/skills/x/SKILL.md"]);
});

test("propose reads the files and writes nothing", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "dexter-")), "CLAUDE.md");
  writeFileSync(f, "It is important to note that we utilize bun.\n");
  expect(propose([["CLAUDE.md", f]])[1]).toContain("+We use bun.");
  expect(propose([])[0]).toContain("Nothing to cut");
  expect(readFileSync(f, "utf8")).toContain("utilize");
});

test("a result is charged for every later turn, to the helper whose job made it, and the week projects", () => {
  const r = fresh();
  const reply = (id: string, blocks: unknown[]) => j({ type: "assistant", timestamp: "2026-10-12T12:00:00Z", message: { id, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1000 }, content: blocks } });
  tally(
    [
      reply("m1", [{ type: "tool_use", id: "a", name: "Bash", input: { command: "gh pr list --json number" } }]),
      j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "x".repeat(40000) }] } }),
      reply("m2", []),
      reply("m3", []),
    ],
    r,
  );
  expect(r.turns).toBe(3);
  expect(r.helpers.mervin).toBe(10000 * (1.25 + 0.2)); // 10k tokens, two turns after it
  expect(r.helpers.dexter).toBe(8000 * (1.25 + 0.2)); // the 8k over the 2k cap
  expect(r.helpers.ester).toBe(0);
  const p = project(r, 2, 2);
  expect(p[2]!.saved).toBeCloseTo(p[0]!.saved * 4, 5);
  expect(week(r).join("\n")).toContain("Mervin (board, PR and CI reads)");
});

test("turns between a conflict and the commit that settles it are a fight", () => {
  const r = fresh();
  const reply = (id: string, command?: string) => j({ type: "assistant", message: { id, usage: { output_tokens: 10 }, content: command ? [{ type: "tool_use", id: `t${id}`, name: "Bash", input: { command } }] : [] } });
  tally(
    [
      reply("m1", "git merge origin/main"),
      j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tm1", content: "CONFLICT (content): Merge conflict in a.ts" }] } }),
      reply("m2"),
      reply("m3", "git commit -am merge"),
      reply("m4"),
    ],
    r,
  );
  expect(r.fights).toBe(100); // m2 and m3: 50 units each; m4 is after the commit
});
