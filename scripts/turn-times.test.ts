import { expect, test } from "bun:test";
import { kindOf, prRun, rows, toolRows, turns } from "./turn-times.ts";

const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 12, 0, s)).toISOString();
const line = (o: object) => JSON.stringify(o);
const ask = (s: number, text: string) => line({ type: "user", timestamp: at(s), message: { content: text } });
const result = (s: number, id: string) => line({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result", tool_use_id: id }] } });
const reply = (s: number, id: string, block: object, model = "claude-opus-5-5") =>
  line({ type: "assistant", timestamp: at(s), message: { id, model, content: [block], usage: { output_tokens: 100 } } });
const bash = (id: string, command: string) => ({ type: "tool_use", id, name: "Bash", input: { command } });

test("a session's turns: steps by message id, think vs tool time, each call's kind, effort, and the PR call", () => {
  const text = [
    line({ type: "api-request", querySource: "repl_main_thread", params: { output_config: { effort: "medium" } } }),
    ask(0, "fix the menu"),
    reply(4, "m1", { type: "thinking" }),
    reply(5, "m1", bash("t1", "cd apps/x && bun run builder run . bun test test/a.test.ts")), // one step, two lines
    result(65, "t1"), // a minute on Bob
    reply(70, "m2", bash("t2", "git push && gh pr create --fill")),
    result(72, "t2"),
    reply(73, "m3", { type: "tool_use", id: "t3", name: "AskUserQuestion", input: {} }),
    result(173, "t3"), // the owner took 100s to answer
    reply(176, "m4", { type: "text" }),
    "not json",
    ask(180, "<system-reminder>a note</system-reminder>"), // a harness note is not a new turn
    ask(200, "thanks"),
    reply(203, "s1", bash("t4", "grep -r 'gh pr create' scripts"), "claude-sonnet-5-5"), // a grep is not a PR
  ].join("\n");
  const ts = turns(text);
  expect(ts.length).toBe(2);
  const [first, second] = ts;
  expect([first.end - first.start, first.think, first.effort, first.prAt, second.prAt]).toEqual([176_000, [5000, 5000, 1000, 3000], "medium", Date.parse(at(70)), undefined]);
  expect(first.calls).toEqual([{ kind: "bash: builder (Bob)", ms: 60_000 }, { kind: "bash: gh", ms: 2000 }, { kind: "waiting on you: question", ms: 100_000 }]);
  expect(prRun(ts)).toEqual({ model: "opus-5-5", wallMin: 70 / 60, turns: 1, out: 400 });
  const [opus] = rows(ts, (t) => [...t.steps.keys()][0], 1);
  expect([opus.toolShare, opus.withoutYouMin]).toEqual([1 - 14 / 176, 76 / 60]);
  expect(toolRows(ts).map((r) => r.kind)).toEqual(["waiting on you: question", "bash: builder (Bob)", "bash: gh"]);
});

test("tool kinds", () => {
  const cases: [string, unknown, string][] = [
    ["Bash", { command: "bun run pr 12 --minutes 5" }, "bash: PR checks wait"],
    ["Bash", { command: "cd apps/x && bun test test/a.test.ts" }, "bash: tests here"],
    ["Bash", { command: "bun run builder run . bun test" }, "bash: builder (Bob)"],
    ["Bash", { command: "bun run pr 12", run_in_background: true }, "bash: started in background"],
    ["Bash", { command: "cat README.md" }, "bash: read/search"],
    ["Bash", "not a call", "bash: other"],
    ["mcp__claude-in-chrome__navigate", {}, "mcp: claude-in-chrome"],
    ["Yield", {}, "waiting: background job (Yield)"],
    ["Edit", {}, "Edit"],
  ];
  expect(cases.map(([name, input]) => kindOf(name, input))).toEqual(cases.map(([, , kind]) => kind));
});
