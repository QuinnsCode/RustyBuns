import { describe, expect, test } from "bun:test";
import { CONFLICT_ROUNDS, failureKey, handoffTask, noteFor, readNote, sameFailure, tokens, tripped, usageOf, writeNote } from "../src/budget.ts";

describe("agent budgets (#1077)", () => {
  test("claude's JSON answer gives its real usage and its reply (#1088)", () => {
    const answer = JSON.stringify({ type: "result", result: "DONE: x", usage: { input_tokens: 6, cache_creation_input_tokens: 3678, cache_read_input_tokens: 12181, output_tokens: 350, server_tool_use: { web_search_requests: 0 } } });
    expect(usageOf(answer)).toEqual({ reply: "DONE: x", tokens: 16215 });
    expect(usageOf(`${answer}\nwarning: something on stderr`)).toEqual({ reply: "DONE: x", tokens: 16215 });
    expect(usageOf("done, edited a.js")).toBeNull();
    expect(usageOf('{"type":"system"}\n{not json')).toBeNull();
  });

  // Shapes from each CLI's own types and docs: codex-sdk's ThreadEvent, pi's docs/json.md, opencode run's emitter (#1118).
  const lines = (...o: unknown[]) => o.map((x) => JSON.stringify(x)).join("\n");
  test("codex's JSONL: usage from each turn.completed, the reply from its last agent_message", () => {
    const out = lines(
      { type: "thread.started", thread_id: "t" }, { type: "turn.started" },
      { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "thinking" } },
      { type: "item.completed", item: { id: "item_1", type: "agent_message", text: "DONE: const" } },
      { type: "turn.completed", usage: { input_tokens: 12000, cached_input_tokens: 9000, cache_write_input_tokens: 0, output_tokens: 300, reasoning_output_tokens: 120 } },
    );
    expect(usageOf(`${out}\n2026-10-12T21:31:15Z WARN stderr chatter`)).toEqual({ reply: "DONE: const", tokens: 12300 });
    expect(usageOf(lines({ type: "turn.started" }, { type: "turn.failed", error: { message: "401" } }))).toBeNull();
  });

  test("pi's JSONL: every assistant message_end's usage, the last one's text", () => {
    const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { total: 0.01 } });
    const out = lines(
      { type: "session", version: 3, id: "s", cwd: "/x" },
      { type: "message_end", message: { role: "user", content: "do it" } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "c" }], usage: usage(100, 20, 0, 900), stopReason: "toolUse" } },
      { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "ok" }] } },
      { type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "done" }], usage: usage(50, 10, 900, 0), stopReason: "stop" } },
      { type: "agent_end", messages: [] },
    );
    expect(usageOf(out)).toEqual({ reply: "done", tokens: 1980 });
  });

  test("opencode's JSONL: tokens from each step_finish, the reply from its text parts", () => {
    const out = lines(
      { type: "step_start", timestamp: 1, sessionID: "s", part: { type: "step-start" } },
      { type: "text", timestamp: 2, sessionID: "s", part: { type: "text", text: "Changing it.\n" } },
      { type: "step_finish", timestamp: 3, sessionID: "s", part: { type: "step-finish", tokens: { input: 40, output: 30, reasoning: 5, cache: { read: 2000, write: 500 } }, cost: 0 } },
      { type: "text", timestamp: 4, sessionID: "s", part: { type: "text", text: "DONE: const" } },
      { type: "step_finish", timestamp: 5, sessionID: "s", part: { type: "step-finish", tokens: { input: 10, output: 15, reasoning: 0, cache: { read: 2500, write: 0 } }, cost: 0 } },
    );
    expect(usageOf(out)).toEqual({ reply: "Changing it.\nDONE: const", tokens: 5100 });
    expect(usageOf(lines({ type: "error", sessionID: "s", error: { name: "APIError" } }))).toBeNull();
  });

  test("tokens are counted at four characters each", () => {
    expect(tokens(0)).toBe(0);
    expect(tokens(4000)).toBe(1000);
    expect(tokens(5)).toBe(2);
  });

  test("the same failure is the same test or error text, whatever the times, durations and colours", () => {
    const a = "\x1b[31m(fail) sum > adds [3.21ms]\x1b[0m\n2026-10-12T10:00:00.123Z expected 3, got 4";
    const b = "(fail) sum > adds [12ms]\n2026-10-12T11:42:07.900Z   expected 3, got 4";
    expect(failureKey(a)).toBe(failureKey(b));
    expect(sameFailure(a, b)).toBe(true);
    expect(sameFailure(a, "expected 3, got 5")).toBe(false);
    expect(sameFailure("", "")).toBe(false);
  });

  test("a run trips past its budget, on the same failure twice, or before a third conflict round", () => {
    expect(tripped({ spent: 10, budget: 100 })).toBeNull();
    expect(tripped({ spent: 120_000, budget: 100_000 })).toBe("context past 100k tokens");
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1"], conflictRounds: 1 })).toBeNull();
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1", "edits lost on a.ts:L1"], conflictRounds: 2 })).toBe("same failure twice");
    expect(tripped({ spent: 0, budget: 100, failures: ["edits lost on a.ts:L1", "edits lost on a.ts:L2"], conflictRounds: CONFLICT_ROUNDS - 1 })).toBe("a third conflict round");
  });

  test("the note is four blunt lines, empty ones left out, and reads back from an agent's reply", () => {
    expect(writeNote({ done: ["x", "y"], next: ["z (a.ts:12)"], broke: [], dont: ["tried a, failed because b"] }))
      .toBe("DONE: x, y\nNEXT: z (a.ts:12)\nDONT: tried a, failed because b");
    expect(readNote("I did most of it.\n\n**DONE:** renamed foo\n- NEXT: the tests (a.test.ts:4)\nBROKE: test sum, wrong import\nDON'T: rename in the lockfile"))
      .toEqual({ done: ["renamed foo"], next: ["the tests (a.test.ts:4)"], broke: ["test sum, wrong import"], dont: ["rename in the lockfile"] });
  });

  test("a run cut short gets a note from its own lines, else from what's known", () => {
    expect(noteFor({ path: "a.ts", task: "rename foo to bar\nand its tests", why: "a third conflict round", applied: 3, conflicts: [{}, {}] }))
      .toBe("DONE: 3 line edits to a.ts\nNEXT: rename foo to bar (a.ts)\nBROKE: 2 edits lost to others' changes, a third conflict round\nDONT: redo lines others changed; work round them");
    expect(noteFor({ path: "a.ts", task: "t", why: "context past 1k tokens", applied: 0, output: "NEXT: do b (a.ts:9)" }))
      .toBe("DONE: nothing landed\nNEXT: do b (a.ts:9)\nBROKE: context past 1k tokens");
    // Notes its owner sent that it never acted on lead NEXT, in their words, with room past a line's usual length (#1090).
    const long = "x".repeat(400);
    expect(noteFor({ path: "a.ts", task: "t", why: "context past 1k tokens", applied: 0, output: "NEXT: do b (a.ts:9)", notes: ["leave c\n alone", long] }))
      .toBe(`DONE: nothing landed\nNEXT: owner says "leave c alone", "${long}", do b (a.ts:9)\nBROKE: context past 1k tokens`);
    expect(handoffTask("a.ts", "same failure twice", "NEXT: x")).toBe("Fresh eyes on a.ts: the last agent stopped (same failure twice) and left you this note. Pick up from NEXT.\nNEXT: x");
  });
});
