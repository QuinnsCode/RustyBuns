import { expect, test } from "bun:test";
import { render, tally, type Report } from "../ester/dexter.ts";

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
