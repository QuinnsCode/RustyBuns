import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { propose, render, tally, trimDiff, trimLine, type Report } from "../ester/dexter.ts";

const fresh = (): Report => ({ sessions: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map() });
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

test("propose reads the files and writes nothing", () => {
  const f = path.join(mkdtempSync(path.join(tmpdir(), "dexter-")), "CLAUDE.md");
  writeFileSync(f, "It is important to note that we utilize bun.\n");
  expect(propose([["CLAUDE.md", f]])[1]).toContain("+We use bun.");
  expect(propose([])[0]).toContain("Nothing to cut");
  expect(readFileSync(f, "utf8")).toContain("utilize");
});
