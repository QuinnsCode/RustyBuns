import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CARRY_ON, ContextWatch, Meter, ModeWatch, StallWatch, choreOf, contextLines, noModes, project, propose, recent, standing, render, tally, trimDiff, trimLine, week, type Report } from "../ester/dexter.ts";
import { codeByDay } from "../ester/ledger.ts";
import { carryOn, type StallFloor } from "../triage/server.ts";

const fresh = (): Report => ({ sessions: 1, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, episodes: 0, modes: noModes(), chores: new Map() });
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

test("a chore is named from the call, and a poll in a row is a streak with the tool for it", () => {
  expect(choreOf("Bash", "gh pr checks 2900 2>&1 | head")).toBe("ci");
  expect(choreOf("Bash", "sleep 30; gh pr checks 2900")).toBe("ci");
  expect(choreOf("Bash", "gh issue view 2904 --comments")).toBe("issues");
  expect(choreOf("mcp__claude-in-chrome__computer")).toBe("browser");
  expect(choreOf("Bash", "cd /x/y && sed -n 10,40p src/a.ts")).toBe("reading");
  expect(choreOf("Bash", "bun install --frozen-lockfile 2>&1 | tail -2")).toBe("install");
  expect(choreOf("Bash", "git fetch -q origin main && git rebase origin/main")).toBe("sync");
  expect(choreOf("Bash", "bun test test/a.test.ts")).toBe("tests");
  expect(choreOf("Bash", "git status --short")).toBeNull();
  expect(choreOf("Read")).toBeNull();
  const r = fresh();
  const call = (id: string, command: string) => j({ type: "assistant", message: { id, usage: { input_tokens: 1 }, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
  const back = (id: string, n: number) => j({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "x".repeat(n * 4) }] } });
  tally([call("a", "gh pr checks 1"), back("a", 300), call("b", "sleep 20; gh pr checks 1"), back("b", 300), call("c", "gh pr checks 1"), back("c", 300), call("d", "gh issue view 7"), back("d", 500)], r);
  expect(r.chores.get("ci")).toEqual({ calls: 3, tokens: 900, streaks: 1 });
  expect(r.chores.get("issues")).toEqual({ calls: 1, tokens: 500, streaks: 0 });
  const out = render(r).join("\n");
  expect(out).toContain("CI polling (gh pr checks, gh run view, sleep): 3 calls, 900 tokens, 1 streaks. bun run pr <n>");
  expect(out).toContain("bun run issue <n>");
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

test("a turn that hangs, or that a notice ends owing work, is a stall once, and the office tells its worker to carry on (#4306)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rb-dexter-stall-")), dir = path.join(root, "-x-RustyBuns");
  mkdirSync(dir);
  const t0 = Date.now(), at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const cwd = "/x/RustyBuns/.agent-office/worktrees/sprocket-b93a", w = path.join(dir, "s-worker.jsonl"), other = path.join(dir, "s-other.jsonl");
  const reply = (min: number, mid: string, stop: string, text = "", session = "s-worker", where = cwd) =>
    j({ type: "assistant", timestamp: at(min), sessionId: session, cwd: where, message: { id: mid, stop_reason: stop, usage: { input_tokens: 1 }, content: text ? [{ type: "text", text }] : [{ type: "tool_use", id: mid, name: "Bash" }] } }) + "\n";
  const asked = (min: number) => j({ type: "api-request", timestamp: at(min), querySource: "repl_main_thread" }) + "\n";
  const prompt = (min: number, kind: string) => j({ type: "user", timestamp: at(min), origin: { kind }, message: { content: kind === "human" ? "fix it" : "<task-notification>done</task-notification>" } }) + "\n";
  const result = (min: number) => j({ type: "user", timestamp: at(min), message: { content: [{ type: "tool_result", tool_use_id: "a", content: "ok" }] } }) + "\n";
  const meter = new Meter(), watch = new StallWatch();
  const check = (min: number) => watch.check(meter.scan(root, t0 + min * 60_000), t0 + min * 60_000);

  // the 2026-11-12 shape: a person's turn, a tool, then a request that never gets its reply
  writeFileSync(w, prompt(0, "human") + asked(0) + reply(1, "a", "tool_use") + result(2) + asked(2));
  expect(check(11).stalled).toEqual([]); // 9 min: still waiting
  const hung = check(13);
  expect(hung.fresh.map((s) => [s.name, s.kind])).toEqual([["sprocket-b93a", "hung"]]);
  expect(hung.fresh[0]!.message).toBe("sprocket-b93a asked the model 11 min ago and no reply came: the request hung, or the process stopped.");
  expect(check(20).fresh).toEqual([]); // once
  expect(check(20).stalled).toHaveLength(1);

  // the reply comes and the turn ends: no stall. A notice opens the next turn and it stops with work owed
  appendFileSync(w, reply(21, "b", "end_turn", "Fixed and pushed.") + prompt(22, "task-notification") + asked(22) + reply(23, "c", "end_turn", "Noted, the install finished."));
  expect(check(50).stalled).toEqual([]); // 27 min quiet
  const quiet = check(54).fresh;
  expect(quiet.map((s) => s.kind)).toEqual(["quiet"]);

  // the office types into its worker (waking it with the prompt when it stopped); a session no worker runs in is a toast for a person
  const told: string[] = [], toasts: string[] = [];
  let running = false;
  const floor: StallFloor = { id: "f", workers: {
    list: () => [{ id: "w1", name: "Sprocket", worktree: { path: ".agent-office/worktrees/sprocket-b93a" } }],
    prompt: (id, text) => (running ? (told.push(`prompt ${id}: ${text}`), undefined) : "Worker is not running"),
    resume: (id, text) => (told.push(`resume ${id}: ${text}`), undefined),
  } };
  carryOn(quiet[0]!, [floor], (_, m) => toasts.push(m));
  running = true;
  carryOn(hung.fresh[0]!, [floor], (_, m) => toasts.push(m));
  expect(told).toEqual([`resume w1: ${CARRY_ON}`, `prompt w1: ${CARRY_ON}`]);
  expect(toasts[1]).toEndWith("Told Sprocket to carry on.");

  writeFileSync(other, prompt(0, "peer") + reply(1, "d", "end_turn", "ok", "s-other", "/tmp/elsewhere"));
  const lone = check(54).fresh;
  expect(lone.map((s) => s.name)).toEqual(["session s-other in /tmp/elsewhere"]);
  carryOn(lone[0]!, [floor], (f, m) => toasts.push(`${f?.id ?? "every floor"}: ${m}`));
  expect(toasts.at(-1)).toContain("every floor: session s-other in /tmp/elsewhere ended a turn a background notice opened");

  // a notice turn that reports "N of M done", or one a person's message joined, owes nothing
  for (const [why, tail] of [
    ["reported", reply(56, "e", "end_turn", "3 of 3 done, nothing left.")],
    ["a person joined", j({ type: "attachment", timestamp: at(56), attachment: { type: "queued_command", origin: { kind: "human" } } }) + "\n" + reply(57, "f", "end_turn", "Sure.")],
  ] as const) {
    appendFileSync(w, prompt(55, "task-notification") + tail);
    expect([why, check(100).stalled.filter((s) => s.session === "s-worker")]).toEqual([why, []]);
  }
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

test("the ledger counts subagents' spend and only the code lines that land on main", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ledger-"));
  const repo = path.join(root, "-Users-me-RustyBuns");
  mkdirSync(path.join(repo, "s1", "subagents"), { recursive: true });
  writeFileSync(path.join(repo, "s1.jsonl"), "");
  writeFileSync(path.join(repo, "s1", "subagents", "agent-a.jsonl"), "");
  expect(recent(root, 1).map((f) => path.basename(f))).toEqual(["s1.jsonl"]);
  expect(recent(root, 1, Date.now(), true).map((f) => path.basename(f))).toEqual(["s1.jsonl", "agent-a.jsonl"]);

  const at = (d: number) => `@${new Date(2026, 9, d, 12).getTime() / 1000}`;
  const log = [at(12), "", "120\t20\tapps/x/src/game.ts", "900\t0\tbun.lock", "-\t-\tart/a.png", at(12), "5\t1\tsrc/{old.ts => new.ts}", at(13), "3\t9\tapps/x/README.md", "2\t40\tstyle.css"].join("\n");
  expect([...codeByDay(log)]).toEqual([["2026-10-12", { added: 125, removed: 21 }], ["2026-10-13", { added: 2, removed: 40 }]]);

  // Days that start at 10am: 9am on the 13th still belongs to the 12th, 10am starts the 13th.
  const early = [`@${new Date(2026, 9, 13, 9).getTime() / 1000}`, "4\t0\ta.ts", `@${new Date(2026, 9, 13, 10).getTime() / 1000}`, "6\t0\tb.ts"].join("\n");
  expect([...codeByDay(early, 10)]).toEqual([["2026-10-12", { added: 4, removed: 0 }], ["2026-10-13", { added: 6, removed: 0 }]]);
});

test("each morning's run grows the history, and the weekly page carries all of it", async () => {
  const { mergeHistory, weekPage, Row } = await import("../ester/ledger-daily.ts");
  const zero = Row({ date: "2026-01-01", sessions: 0, turns: 0, units: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, fights: 0, episodes: 0, ciReads: 0, testOutput: 0, oversize: 0, mervin: 0, ester: 0, dexter: 0, prs: 0, added: 0, removed: 0, codeAdded: 0, codeRemoved: 0 });
  const day = (date: string, turns: number) => ({ ...zero, date, turns });
  // Yesterday's run saw Oct 6 whole and today only begun; this run's Oct 6 lost transcripts, today grew, Nov 6 is new.
  const old = [day("2026-10-06", 900), day("2026-11-05", 40)];
  const merged = mergeHistory(old, [day("2026-10-06", 12), day("2026-11-05", 2090), day("2026-11-06", 5)]);
  expect(merged.map((r) => [r.date, r.turns])).toEqual([["2026-10-06", 900], ["2026-11-05", 2090], ["2026-11-06", 5]]);

  const page = weekPage(readFileSync(path.join(import.meta.dir, "../ester/ledger-week.html"), "utf8"), { generated: "x</script>", dayStarts: 10, saves: 0.9, settles: 0.49 }, merged);
  const D: unknown = JSON.parse(/const D=(.*);\n/.exec(page)![1]!);
  expect(D).toMatchObject({ dayStarts: 10, rows: [{ date: "2026-10-06", turns: 900 }, { date: "2026-11-05" }, { date: "2026-11-06" }] });
  expect(page.match(/<\/script>/g)).toHaveLength(1);
});

test("the plan's weekly usage is entered by the morning it reset, a second entry replacing the first, and models split the spend", async () => {
  const { setBudget } = await import("../ester/ledger-daily.ts");
  const { familyOf } = await import("../ester/dexter.ts");
  let b = setBudget([], "2026-10-29", 56);
  b = setBudget(b, "2026-10-15", 94, true);
  b = setBudget(b, "2026-10-29", 58);
  expect(b).toEqual([{ ends: "2026-10-15", pct: 94, approx: true }, { ends: "2026-10-29", pct: 58 }]);
  expect(() => setBudget(b, "last week", 50)).toThrow("--budget takes a date");
  expect(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "<synthetic>"].map((m) => familyOf(m))).toEqual(["opus", "sonnet", "fable", "other"]);
});
