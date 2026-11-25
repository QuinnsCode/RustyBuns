import { expect, test } from "bun:test";
import { prRun, rows, turns } from "./turn-times.ts";

const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 12, 0, s)).toISOString();
const line = (o: object) => JSON.stringify(o);
const ask = (s: number, text: string) => line({ type: "user", timestamp: at(s), message: { content: text } });
const result = (s: number) => line({ type: "user", timestamp: at(s), message: { content: [{ type: "tool_result" }] } });
const reply = (s: number, id: string, block: object, model = "claude-opus-5-5") =>
  line({ type: "assistant", timestamp: at(s), message: { id, model, content: [block], usage: { output_tokens: 100 } } });
const bash = (command: string) => ({ type: "tool_use", name: "Bash", input: { command } });

test("a session's turns: steps by message id, think vs tool time, effort, and the PR call", () => {
  const text = [
    line({ type: "api-request", querySource: "repl_main_thread", params: { output_config: { effort: "medium" } } }),
    ask(0, "fix the menu"),
    reply(4, "m1", { type: "thinking" }),
    reply(5, "m1", bash("grep -r 'gh pr create' scripts")), // one step, two lines; a grep is not a PR
    result(65), // a minute in tools
    reply(70, "m2", bash("git push && gh pr create --fill")),
    result(72),
    reply(75, "m3", { type: "text" }),
    "not json",
    ask(100, "<system-reminder>a note</system-reminder>"), // a harness note is not a new turn
    ask(200, "thanks"),
    reply(203, "s1", { type: "text" }, "claude-sonnet-5-5"),
  ].join("\n");
  const ts = turns(text);
  expect(ts.length).toBe(2);
  const [first] = ts;
  expect([first.end - first.start, first.think, first.effort, first.prAt]).toEqual([75_000, [5000, 5000, 3000], "medium", Date.parse(at(70))]);
  expect(prRun(ts)).toEqual({ model: "opus-5-5", wallMin: 70 / 60, turns: 1, out: 300 });
  const [opus] = rows(ts, (t) => [...t.steps.keys()][0], 1);
  expect(opus.toolShare).toBeCloseTo(1 - 13 / 75);
});
