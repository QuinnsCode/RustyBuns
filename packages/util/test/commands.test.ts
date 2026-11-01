import { expect, test } from "bun:test";
import { addCommands, askArgs, rankCommands, runCommand } from "../src/commands.ts";

// A browser with WebMCP: document.modelContext keeps what is registered until the signal aborts.
const live = new Map<string, { execute(a: unknown): unknown }>();
Reflect.set(globalThis, "document", {
  modelContext: {
    registerTool(t: { name: string; execute(a: unknown): unknown }, o: { signal: AbortSignal }) {
      live.set(t.name, t);
      o.signal.addEventListener("abort", () => live.delete(t.name));
    },
  },
});
Reflect.set(globalThis, "window", globalThis);
const tick = () => new Promise((r) => setTimeout(r, 0));

test("a page's commands are WebMCP tools and window.__commands until taken away", async () => {
  let score = 0;
  const off = addCommands([
    { name: "g_add", title: "Add points", description: "adds n", inputSchema: { type: "object", properties: { n: { type: "integer" } } }, execute: (a) => { score += Number(Reflect.get(Object(a), "n") ?? 1); } },
    { name: "g_score", title: "Look at the score", description: "the score", annotations: { readOnlyHint: true }, execute: () => ({ score }) },
    { name: "g_secret", title: "Person only", description: "not a tool", agent: false, execute: () => 1 },
  ]);
  await tick();
  expect([...live.keys()]).toEqual(["g_add", "g_score"]);

  // An agent over WebMCP, and a script over window.__commands, call the same function.
  expect(await live.get("g_add")!.execute({ n: 5 })).toEqual({ ok: true });
  const handle = Reflect.get(globalThis, "__commands");
  expect(await handle.run("g_score")).toEqual({ score: 5 });
  expect(handle.list().map((c: { name: string }) => c.name)).toEqual(["g_add", "g_score", "g_secret"]);
  await expect(runCommand("nope")).rejects.toThrow('no command "nope"');

  off();
  expect(live.size).toBe(0);
  expect(handle.list()).toEqual([]);
});

test("the palette finds commands by what a person types", () => {
  const cmds = [
    { name: "tf_jump", title: "Jump into a battle", group: "Battle" },
    { name: "tf_end", title: "End the battle", group: "Battle" },
    { name: "tf_state", title: "Look at the battle", group: "Battle" },
  ];
  const cases: [string, string[]][] = [
    ["", ["tf_jump", "tf_end", "tf_state"]],
    ["battle", ["tf_jump", "tf_end", "tf_state"]], // every one, in order
    ["end", ["tf_end"]], // the start of a title wins
    ["look bat", ["tf_state"]], // every word must match
    ["lkb", ["tf_state"]], // letters in order
    ["state", ["tf_state"]], // the tool's name
    ["zzz", []],
  ];
  for (const [q, want] of cases) expect(rankCommands(cmds, q).map((c) => c.name)).toEqual(want);
});

test("the palette's one line fills the first argument", () => {
  expect(askArgs({ inputSchema: { type: "object", properties: { role: { type: "string" }, bots: { type: "integer" } } } }, "seeker")).toEqual({ role: "seeker" });
  expect(askArgs({ inputSchema: { type: "object", properties: { n: { type: "integer" } } } }, "3")).toEqual({ n: 3 });
});
