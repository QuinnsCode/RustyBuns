import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContextWatch, Meter, ModeWatch, contextLines, noModes, project, propose, standing, render, tally, trimDiff, trimLine, week, type Report } from "../ester/dexter.ts";

const fresh = (): Report => ({ sessions: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, modes: noModes() });
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

test("Dexter names a session once as its context, and then everything it has used, crosses the warn and handoff lines", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rb-dexter-ctx-")), dir = path.join(root, "-Users-x-RustyBuns");
  mkdirSync(dir);
  const worker = path.join(dir, "s-1234abcd.jsonl"), other = path.join(dir, "abcdef123456.jsonl");
  const cwd = "/Users/x/RustyBuns/.agent-office/worktrees/sprocket-b93a";
  let id = 0;
  // a reply carrying `tokens` of context (input + cache read + cache write) and writing 99 more; its own message id unless given
  const turn = (session: string, where: string, tokens: number, mid = `m${id++}`) => j({ type: "assistant", sessionId: session, cwd: where, message: { id: mid, usage: { input_tokens: 5, cache_read_input_tokens: tokens - 5000, cache_creation_input_tokens: 4995, output_tokens: 99 } } }) + "\n";
  const meter = new Meter(), watch = new ContextWatch();
  const poll = () => { const sessions = meter.scan(root); return { sessions, ...watch.check(sessions) }; };
  const mine = (r: ReturnType<typeof poll>) => r.sessions.find((c) => c.session === "s-1234abcd")!;
  const names = (a: { name: string; measure: string; level: string }[]) => a.map((x) => `${x.name} ${x.measure} ${x.level}`).sort();

  writeFileSync(worker, turn("s-1234abcd", cwd, 100_000));
  const first = poll();
  expect(first.over).toEqual([]); // 100k: nothing yet
  expect(mine(first)).toMatchObject({ tokens: 100_000, turn: 100_099, total: 100_099 });

  // context past warn, in two sessions
  appendFileSync(worker, turn("s-1234abcd", cwd, 160_000));
  writeFileSync(other, turn("abcdef123456", "/tmp/elsewhere", 200_000));
  const warn = poll();
  expect(names(warn.fresh)).toEqual(["session abcdef12 in /tmp/elsewhere context warn", "sprocket-b93a context warn"]);
  expect(warn.fresh.find((a) => a.name === "sprocket-b93a")!.message).toContain("Write a handoff and start a fresh session");
  expect(poll().fresh).toEqual([]); // each fires once
  expect(poll().over).toHaveLength(2); // but both stand while over the line

  appendFileSync(worker, turn("s-1234abcd", cwd, 260_000));
  expect(names(poll().fresh)).toEqual(["sprocket-b93a context handoff"]);
  expect(poll().fresh).toEqual([]);

  // a reply is counted once by its message id, and half a line still being written waits for its newline
  const before = mine(poll()).total;
  appendFileSync(worker, turn("s-1234abcd", cwd, 260_000, "m3"));
  const half = turn("s-1234abcd", cwd, 260_000, "late");
  appendFileSync(worker, half.slice(0, 60));
  expect(mine(poll()).total).toBe(before);
  appendFileSync(worker, half.slice(60));
  expect(mine(poll()).total).toBe(before + 260_099);

  // what it has used over its life: 10M warns, 25M says to hand off
  const turns = (n: number) => appendFileSync(worker, Array.from({ length: n }, () => turn("s-1234abcd", cwd, 260_000)).join(""));
  turns(40);
  const spend = poll();
  expect(names(spend.fresh)).toEqual(["sprocket-b93a total warn"]);
  expect(spend.fresh[0]!.message).toMatch(/has used 1\d\.\dM tokens in all \(260k on its latest turn\), past 10\.0M\. Write a handoff/);
  expect(poll().fresh).toEqual([]);
  turns(60);
  expect(names(poll().fresh)).toEqual(["sprocket-b93a total handoff"]);
  expect(poll().fresh).toEqual([]);

  const cli = contextLines(meter.scan(root)).join("\n");
  expect(cli).toMatch(/sprocket-b93a: context 260k, 2\d\.\dM used in all, latest turn 260k/);
  expect(cli).toContain("Hand off:");
});

test("Dexter counts code mode against tool loads and direct MCP calls, and a new program is an event once", () => {
  const call = (id: string, name: string, mid: string) => j({ type: "assistant", sessionId: "s-code", cwd: "/x/.agent-office/worktrees/gizmo-1a2b", message: { id: mid, usage: { input_tokens: 1 }, content: [{ type: "tool_use", id, name }] } }) + "\n";
  const result = (id: string, n: number) => j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "z".repeat(n * 4) }] } }) + "\n";
  const loaded = j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: [{ type: "tool_reference", tool_name: "Monitor" }, { type: "tool_reference", tool_name: "WebFetch" }] }] } }) + "\n";
  const lines = [call("a", "ToolSearch", "m1"), loaded, call("b", "mcp__codesplitter__read_file", "m2"), result("b", 3000),
    call("c", "mcp__codesplitter__read_file", "m3"), result("c", 3000), call("d", "mcp__codesplitter__execute", "m4"), result("d", 40), call("e", "Read", "m5"), result("e", 10)];

  const r = fresh();
  tally(lines.join("").split("\n"), r);
  expect(r.modes).toEqual({ code: { calls: 1, tokens: 40 }, load: { calls: 1, tools: 2 }, direct: { calls: 2, tokens: 6000 } });
  expect(render(r).join("\n")).toContain("Code mode 1 (40 tokens), tool loads 1 (2 schemas into the context), direct MCP calls 2 (6k tokens).");

  const root = mkdtempSync(path.join(tmpdir(), "rb-dexter-mode-")), dir = path.join(root, "-x-RustyBuns"), f = path.join(dir, "s-code.jsonl");
  mkdirSync(dir);
  const meter = new Meter(), watch = new ModeWatch();
  writeFileSync(f, lines.slice(0, 6).join(""));
  expect(watch.check(meter.scan(root))).toEqual([]); // loads and direct calls only: no event
  appendFileSync(f, lines.slice(6).join(""));
  const [e, ...rest] = watch.check(meter.scan(root));
  expect(rest).toEqual([]);
  expect(e!.message).toBe("gizmo-1a2b used code mode: 1 program in this session, against 1 tool load and 2 direct MCP calls.");
  expect(watch.check(meter.scan(root))).toEqual([]); // once
  expect(contextLines(meter.scan(root)).join("\n")).toContain("code mode 1, tool loads 1, direct MCP 2");
});
