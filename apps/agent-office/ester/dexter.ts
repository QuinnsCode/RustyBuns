// Dexter, the office's token trimmer (called on from the page, ester/index.ts). He reads Claude Code's session
// transcripts for this repo (~/.claude/projects/*RustyBuns*, the last DEXTER_HOURS, default 24), adds up the tokens, and
// names the tools whose results were biggest, since a result stays in the context and is paid for on every turn after.
// He prints short, plain lines, and one tip per offender. He also proposes trims to the standing text every session pays
// for (CLAUDE.md, AGENTS.md, the memory index, skill descriptions): filler words and long phrases cut to short plain ones, printed as a diff
// to approve (`git apply --unidiff-zero`). He never edits a file. No model call, so asking him costs nothing.
// DEXTER_HOURS=168 adds the week: spend per day, what each helper's job costs, and what it saves at growing PR counts.
// He also watches how big each live session's context has grown (what its next turn carries), and says when one should
// write a handoff and start fresh: warn at CONTEXT.warn, and again at CONTEXT.handoff, once each per session.
// And how each session reaches tools (`modeOf`): code mode (one program through an MCP server's execute, only its answer comes
// back), loading tool schemas into the context (ToolSearch), or calling MCP tools one by one. The CLI and the card count each,
// and a session's first code-mode program in a while is an event (`ModeWatch`) the page shows on his card.
// Run: bun apps/agent-office/ester/dexter.ts
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type Block = { type?: string; id?: string; name?: string; tool_name?: string; tool_use_id?: string; input?: { command?: string }; content?: unknown; text?: string };
type Line = { type?: string; timestamp?: string; sessionId?: string; cwd?: string; message?: { id?: string; usage?: Record<string, number>; content?: unknown } };

export interface Report {
  sessions: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Tool name (an MCP tool as `mcp:server`) -> calls and the tokens (chars / 4) its results added to the context. */
  tools: Map<string, { calls: number; tokens: number; worst: number }>;
  /** Replies (turns) seen, and spend per local day, both in `units` (below). */
  turns: number;
  days: Map<string, number>;
  /** Units spent on results that a helper's job produces (Mervin: the board, Ester: test runs), and units over CAP that Dexter would cut. */
  helpers: { mervin: number; ester: number; dexter: number };
  /** Units spent on turns between a merge conflict showing up in a result and the commit that settled it. */
  fights: number;
  /** Calls and result tokens by how the tool was reached (`modeOf`). */
  modes: Modes;
  /** Chore name (`choreOf`) -> calls, result tokens, and streaks (the same chore twice or more in a row: polling, or re-reading). */
  chores: Map<Chore, { calls: number; tokens: number; streaks: number }>;
}

export type Chore = "ci" | "issues" | "browser" | "reading" | "install" | "sync" | "tests";
/** Each chore the sessions do by hand, and the tool that does it in one call. */
export const CHORES: Record<Chore, { label: string; tool: string }> = {
  ci: { label: "CI polling (gh pr checks, gh run view, sleep)", tool: "bun run pr <n> waits for the checks and prints a line per outcome, with a failed step's log tail." },
  issues: { label: "issue reads (gh issue view)", tool: "bun run issue <n> [n ...] is the brief: header, body cut at a paragraph, the last three comments." },
  browser: { label: "browser driving (tabs, navigate, scripts, screenshots)", tool: "bun run probe <app> [path] [--js expr] asks the game for its state as text; --shot when eyes are needed." },
  reading: { label: "reading code (sed -n, cat, grep, head)", tool: "grep -n -m 20 for the lines, then one sed -n range; through codeSplitter, one execute program that returns only the lines you filter." },
  install: { label: "bun install in a fresh worktree", tool: "bun install --frozen-lockfile >/dev/null 2>&1 once, on its own line: the output is never worth reading." },
  sync: { label: "fetch, rebase and merge", tool: "the rebuild-pr skill, or Mervin: one pass, conflicts settled by the engine first." },
  tests: { label: "tests and typechecks", tool: "bun test test/x.test.ts 2>&1 | tail -5; the builder (bun run builder) runs them off this machine." },
};
const CI = /\bgh pr checks\b|\bgh run (view|list|watch)\b|\bsleep \d+;? *gh\b|\bgh pr view\b.*(statusCheck|mergeable|checks)/;
/** Which chore a tool call is part of, from its name and (for Bash) its command; null for the rest. */
export function choreOf(name: string, cmd = ""): Chore | null {
  if (name.startsWith("mcp__claude-in-chrome__")) return "browser";
  if (name !== "Bash") return null;
  if (CI.test(cmd)) return "ci";
  if (/\bgh issue view\b/.test(cmd)) return "issues";
  if (/\bbun install\b/.test(cmd)) return "install";
  if (/\bgit (fetch|rebase|merge|pull)\b/.test(cmd)) return "sync";
  if (/\bbun test\b|\btsc --noEmit\b|\bbun run typecheck\b/.test(cmd)) return "tests";
  if (/^(cd \S+ *[;&]+ *)?(sed -n|cat |grep |head |tail |wc )/.test(cmd)) return "reading";
  return null;
}

export type Mode = "code" | "load" | "direct";
type Use = { calls: number; tokens: number };
/** A load's result names the tools it loaded (`tool_reference`); their schemas' size isn't in the transcript, so loads count tools, not tokens. */
export type Modes = { code: Use; load: { calls: number; tools: number }; direct: Use };
export const noModes = (): Modes => ({ code: { calls: 0, tokens: 0 }, load: { calls: 0, tools: 0 }, direct: { calls: 0, tokens: 0 } });
/** Code mode's four tools (apps/codesplitter/src/codemode.ts), on any MCP server that has them. */
const CODE_TOOLS = /^(execute|search_tools|describe_tools|call_tool)$/;
/** How a tool call reached its tool: `code` through a code-mode server, `load` putting tool schemas in the context, `direct` an MCP tool called by name. Built-in tools (Read, Bash) are none. */
export function modeOf(name: string): Mode | null {
  if (name === "ToolSearch") return "load";
  if (!name.startsWith("mcp__")) return null;
  return CODE_TOOLS.test(name.split("__")[2] ?? "") ? "code" : "direct";
}

/** Spend in input-token equivalents, at the API price ratios: output 5x, cache write 1.25x, cache read 0.1x. Model-independent. */
export const units = (u: Report["usage"]) => u.input + u.output * 5 + u.cacheWrite * 1.25 + u.cacheRead * 0.1;
/** A tool result over this many tokens is what Dexter would cut (an assumption: tune it). */
export const CAP = 2000;
const CONFLICT = /CONFLICT \(|^<{7} /m, SETTLED = /\bgit (commit|merge --continue|rebase --continue|push)\b/;
const MERVIN = /\bgh pr (list|view|checks|diff)\b|mervin-board|office-workers|get_board/, ESTER = /\bbun (test|run typecheck)\b|\btsc\b/;

const TIPS: Record<string, string> = {
  Read: "Read with offset+limit, or grep first. Whole files stay in context.",
  Bash: "Pipe to tail/head/grep. Print counts, not logs.",
  Grep: "Use -l or a head_limit. Paths first, lines later.",
  Agent: "Ask the subagent for 5 lines. Not a report.",
  WebFetch: "Give it a prompt that asks for one fact.",
  mcp: "Big MCP result: try the CLI with a narrow flag, or ask the tool for fewer fields.",
};
const tip = (tool: string) => TIPS[tool.startsWith("mcp:") ? "mcp" : tool] ?? "Ask for less. Short answer, no echo.";

const text = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: Block) => b.text ?? "").join("") : "");
const kind = (name: string) => (name.startsWith("mcp__") ? `mcp:${name.split("__")[1]}` : name);

/** Adds one transcript's lines to the report. A reply is logged once per message id; a result is counted by the call it answers. */
export function tally(lines: Iterable<string>, r: Report) {
  const names = new Map<string, string>(), modes = new Map<string, Mode>(), seen = new Set<string>(), cats = new Map<string, "mervin" | "ester">(), chores = new Map<string, Chore>();
  const results: { tokens: number; at: number; cat?: "mervin" | "ester" }[] = [];
  let turn = 0, fighting = false, settled = false, last: Chore | null = null, streak = 0;
  for (const raw of lines) {
    let l: Line;
    try { l = JSON.parse(raw); } catch { continue; }
    const blocks = Array.isArray(l.message?.content) ? (l.message.content as Block[]) : [];
    if (l.type === "assistant") {
      for (const b of blocks)
        if (b.type === "tool_use" && b.id && b.name) {
          names.set(b.id, kind(b.name));
          const m = modeOf(b.name);
          if (m) { modes.set(b.id, m); r.modes[m].calls++; }
          const cmd = b.input?.command ?? b.name;
          if (SETTLED.test(cmd)) settled = true;
          const cat0 = cmd, cat = MERVIN.test(cat0) ? "mervin" : ESTER.test(cat0) ? "ester" : undefined;
          if (cat) cats.set(b.id, cat);
          const chore = choreOf(b.name, b.input?.command ?? "");
          if (chore) { chores.set(b.id, chore); const c = r.chores.get(chore) ?? { calls: 0, tokens: 0, streaks: 0 }; c.calls++; r.chores.set(chore, c); }
          if (chore && chore === last) { if (++streak === 2) r.chores.get(chore)!.streaks++; } else { last = chore; streak = 1; }
        }
      const id = l.message?.id, u = l.message?.usage;
      if (!u || (id && seen.has(id))) continue;
      if (id) seen.add(id);
      r.usage.input += u.input_tokens ?? 0;
      r.usage.output += u.output_tokens ?? 0;
      r.usage.cacheRead += u.cache_read_input_tokens ?? 0;
      r.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      turn++; r.turns++;
      const spent = units({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
      const day = new Date(l.timestamp ?? 0).toLocaleDateString("en-CA");
      r.days.set(day, (r.days.get(day) ?? 0) + spent);
      if (fighting) r.fights += spent;
      if (settled) fighting = settled = false;
    } else if (l.type === "user") {
      for (const b of blocks) {
        if (b.type !== "tool_result" || !b.tool_use_id) continue;
        if (CONFLICT.test(text(b.content))) fighting = true;
        const tool = names.get(b.tool_use_id) ?? "other", tokens = Math.round(text(b.content).length / 4);
        const t = r.tools.get(tool) ?? { calls: 0, tokens: 0, worst: 0 };
        t.calls++; t.tokens += tokens; t.worst = Math.max(t.worst, tokens);
        r.tools.set(tool, t);
        const chore = chores.get(b.tool_use_id);
        if (chore) r.chores.get(chore)!.tokens += tokens;
        const m = modes.get(b.tool_use_id);
        if (m === "load") r.modes.load.tools += Array.isArray(b.content) ? (b.content as Block[]).filter((x) => x.type === "tool_reference").length : 0;
        else if (m) r.modes[m].tokens += tokens;
        results.push({ tokens, at: turn, cat: cats.get(b.tool_use_id) });
      }
    }
  }
  // A result is written to the cache once, then read on every later turn: that is what it costs.
  for (const x of results) {
    const cost = (n: number) => n * (1.25 + 0.1 * (turn - x.at));
    if (x.cat) r.helpers[x.cat] += cost(x.tokens);
    r.helpers.dexter += cost(Math.max(0, x.tokens - CAP));
  }
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

const jobs = (r: Report) => r.helpers.mervin + r.helpers.ester + r.helpers.dexter + r.fights;
/** Units a week's helpers take off: 90% of the reads, test output and excess, and Mervin's share of the conflict fights. */
const cut = (r: Report) => (r.helpers.mervin + r.helpers.ester + r.helpers.dexter) * SAVES + r.fights * SETTLES;

/** n PRs a week for `weeks` weeks, growing `growth`x each week. Helper jobs repeat per PR, so their cost grows with n^exp. */
export function project(r: Report, growth: number, weeks: number, exp = 1) {
  const spend = [...r.days.values()].reduce((a, b) => a + b, 0), job = jobs(r);
  return Array.from({ length: weeks + 1 }, (_, w) => {
    const g = growth ** w, base = spend - job + job * g ** exp;
    return { week: w, without: base, saved: cut(r) * g ** exp, with: base - cut(r) * g ** exp };
  });
}
/** Share of a helper's job cost that the helper removes (an assumption: a narrow answer is about a tenth of a raw one). */
export const SAVES = 0.9;
/** Share of conflicted files Mervin settles or nearly settles: git/git, 2026-10-13 (docs/mervin.md: 43% exact + 6% close). */
export const SETTLES = 0.49;

export function week(r: Report, growth = 1.5, weeks = 6): string[] {
  const m = (n: number) => k(Math.round(n)), total = [...r.days.values()].reduce((a, b) => a + b, 0);
  const out = [`Week: ${m(total)} units (input tokens at API ratios) over ${r.turns} turns. Cache reads are ${Math.round(((r.usage.cacheRead * 0.1) / (units(r.usage) || 1)) * 100)}% of it.`];
  for (const [d, u] of [...r.days].sort()) out.push(`  ${d} ${m(u)}`);
  const h = r.helpers, saved = cut(r);
  out.push("What each job costs when an agent does it by hand (units), and the share kept if a helper does it:",
    `  Mervin (board, PR and CI reads): ${m(h.mervin)}`, `  Ester (test and typecheck output): ${m(h.ester)}`, `  Dexter (results over ${CAP} tokens, the excess): ${m(h.dexter)}`,
    `  Merge fights (turns from a conflict to its commit): ${m(r.fights)}, of which Mervin settles ${Math.round(SETTLES * 100)}%: ${m(r.fights * SETTLES)}`,
    `Stretch: about ${m(saved)} units back, ${Math.round((saved / (total || 1)) * 100)}% of the week, so the same cap lasts ${(total / (total - saved || 1)).toFixed(2)}x as long (assuming ${SAVES * 100}% of reads and test output are saved).`,
    `If PRs grow ${growth}x a week (units; this week = the cap):`);
  for (const p of project(r, growth, weeks)) out.push(`  week ${p.week}: ${(p.without / (total || 1)).toFixed(2)}x the cap without, ${(p.with / (total || 1)).toFixed(2)}x with`);
  return out;
}

export function render(r: Report): string[] {
  const out = [`${r.sessions} sessions. in ${k(r.usage.input)}, out ${k(r.usage.output)}, cache read ${k(r.usage.cacheRead)}, cache write ${k(r.usage.cacheWrite)}.`];
  const top = [...r.tools].sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 5);
  if (!top.length) return [...out, "No tool results. Nothing to trim."];
  out.push("Biggest results kept in context:");
  for (const [tool, t] of top) out.push(`  ${tool}: ${k(t.tokens)} over ${t.calls} calls, worst ${k(t.worst)}. ${tip(tool)}`);
  out.push(...modeLines(r.modes), ...choreLines(r.chores));
  out.push("Say less: short words, no preamble, no recap. Keep jargon that steers.");
  return out;
}

/** The chores done by hand, biggest first, each with its calls, result tokens, streaks and the tool for it. */
export function choreLines(chores: Report["chores"]): string[] {
  const rows = [...chores].filter(([, c]) => c.calls).sort((a, b) => b[1].tokens - a[1].tokens);
  if (!rows.length) return [];
  return ["Chores done by hand (calls, result tokens, streaks of the same chore back to back), and the tool for each:",
    ...rows.map(([name, c]) => `  ${CHORES[name].label}: ${c.calls} calls, ${k(c.tokens)} tokens, ${c.streaks} streaks. ${CHORES[name].tool}`)];
}

/** How tools were reached: code-mode programs against tool schemas loaded and MCP tools called one by one, with what their results added. */
export function modeLines(m: Modes): string[] {
  if (!(m.code.calls + m.load.calls + m.direct.calls)) return [];
  const one = (x: Use) => `${x.calls} (${k(x.tokens)} tokens)`;
  const out = [`Code mode ${one(m.code)}, tool loads ${m.load.calls} (${m.load.tools} schemas into the context), direct MCP calls ${one(m.direct)}.`];
  if (m.direct.calls > m.code.calls) out.push("  More MCP calls go one by one than through code mode: where a server has execute, one program that returns only the answer is cheaper.");
  return out;
}

/** Where Dexter warns and where he says to hand off. `warn` and `handoff` are the context a session carries into its next turn (tokens);
 * `total.warn` and `total.handoff` are all it has used over its life, since every turn re-reads the whole context. */
export const CONTEXT = { warn: 150_000, handoff: 250_000, total: { warn: 10_000_000, handoff: 25_000_000 } } as const;
const ACTIVE_HOURS = 1;

/** One live session: the context it carries now, what it has used in all, and what its latest turn took (tokens). */
export interface Context { session: string; cwd: string; tokens: number; total: number; turn: number; modes: Record<Mode, number> }

/** Reads sessions' transcripts without re-reading them: each scan takes only the lines added since the last one. */
export class Meter {
  private files = new Map<string, { pos: number; seen: Set<string>; total: number; modes: Record<Mode, number>; now: Omit<Context, "total" | "modes"> | null }>();

  /** Every session touched in the last hour. A reply counts once by message id, in the total and as the latest turn. */
  scan(root: string, now = Date.now()): Context[] {
    return recent(root, ACTIVE_HOURS, now).flatMap((f) => {
      let st = this.files.get(f);
      const size = statSync(f).size;
      if (!st || size < st.pos) this.files.set(f, (st = { pos: 0, seen: new Set(), total: 0, modes: { code: 0, load: 0, direct: 0 }, now: null })); // a new file, or one that was rewritten
      if (size > st.pos) {
        const buf = Buffer.alloc(size - st.pos), fd = openSync(f, "r");
        try { readSync(fd, buf, 0, buf.length, st.pos); } finally { closeSync(fd); }
        const end = buf.lastIndexOf(10) + 1; // only whole lines: the last one may still be being written
        st.pos += end;
        for (const raw of buf.subarray(0, end).toString("utf8").split("\n")) {
          let l: Line;
          try { l = JSON.parse(raw); } catch { continue; }
          const u = l.type === "assistant" ? l.message?.usage : undefined, id = l.message?.id;
          if (l.type === "assistant" && Array.isArray(l.message?.content))
            for (const b of l.message.content as Block[]) { const m = b.type === "tool_use" && b.name ? modeOf(b.name) : null; if (m) st.modes[m]++; }
          if (!u || (id && st.seen.has(id))) continue;
          if (id) st.seen.add(id);
          const turn = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
          st.total += turn;
          st.now = { session: l.sessionId ?? path.basename(f, ".jsonl"), cwd: l.cwd ?? "", turn, tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) };
        }
      }
      return st.now ? [{ ...st.now, total: st.total, modes: { ...st.modes } }] : [];
    });
  }
}

export type ContextLevel = "warn" | "handoff";
export interface ContextAlert extends Context { name: string; measure: "context" | "total"; level: ContextLevel; message: string }

/** An office worker's name when the session runs in its worktree (.agent-office/worktrees/<name>), else the session and where it runs. */
export const nameOf = (c: Context) => {
  const worker = /\.agent-office\/worktrees\/([^/]+)/.exec(c.cwd)?.[1];
  return worker ?? `session ${c.session.slice(0, 8)} in ${c.cwd || "an unknown directory"}`;
};

const levelOf = (n: number, line: { warn: number; handoff: number }): ContextLevel | null => (n >= line.handoff ? "handoff" : n >= line.warn ? "warn" : null);

/** Remembers which line each session has crossed on each measure, so each alert fires once. A session whose context falls back under the warn line (a fresh one, a compaction) can fire again. */
export class ContextWatch {
  private told = new Map<string, ContextLevel>();
  /** `over`: every alert standing now. `fresh`: the ones that crossed a line since the last check. */
  check(sessions: Context[], name: (c: Context) => string = nameOf): { over: ContextAlert[]; fresh: ContextAlert[] } {
    const over: ContextAlert[] = [], fresh: ContextAlert[] = [];
    for (const c of sessions) {
      const who = name(c);
      for (const [measure, n, line] of [["context", c.tokens, CONTEXT], ["total", c.total, CONTEXT.total]] as const) {
        const key = `${c.session}:${measure}`, level = levelOf(n, line);
        if (!level) { this.told.delete(key); continue; }
        const lead = measure === "context"
          ? `${who} is carrying ${k(c.tokens)} tokens of context, past ${k(line[level])}.`
          : `${who} has used ${k(c.total)} tokens in all (${k(c.turn)} on its latest turn), past ${k(line[level])}.`;
        const alert = { ...c, name: who, measure, level, message: `${lead} Write a handoff and start a fresh session.` };
        over.push(alert);
        const before = this.told.get(key);
        if (before !== level && before !== "handoff") { fresh.push(alert); this.told.set(key, level); }
      }
    }
    return { over, fresh };
  }
}

export interface ModeEvent { session: string; name: string; code: number; load: number; direct: number; message: string }

/** Remembers each session's code-mode count, so a new program is an event once. A session seen for the first time with programs already run is one too. */
export class ModeWatch {
  private told = new Map<string, number>();
  check(sessions: Context[], name: (c: Context) => string = nameOf): ModeEvent[] {
    return sessions.flatMap((c) => {
      const { code, load, direct } = c.modes, before = this.told.get(c.session) ?? 0;
      this.told.set(c.session, code);
      if (code <= before) return [];
      const who = name(c);
      return [{ session: c.session, name: who, code, load, direct, message: `${who} used code mode: ${code} program${code === 1 ? "" : "s"} in this session, against ${load} tool load${load === 1 ? "" : "s"} and ${direct} direct MCP call${direct === 1 ? "" : "s"}.` }];
    });
  }
}

/** What each live session is carrying and has used (biggest total first), for the card and the CLI. */
export const sessionLines = (sessions: Context[], name: (c: Context) => string = nameOf): string[] =>
  [...sessions].sort((a, b) => b.total - a.total).map((c) => `${name(c)}: context ${k(c.tokens)}, ${k(c.total)} used in all, latest turn ${k(c.turn)}${c.modes.code + c.modes.load + c.modes.direct ? `; code mode ${c.modes.code}, tool loads ${c.modes.load}, direct MCP ${c.modes.direct}` : ""}`);

/** The CLI's lines: every session active in the last hour with its numbers, then the ones to hand off. */
export function contextLines(sessions: Context[], name: (c: Context) => string = nameOf): string[] {
  if (!sessions.length) return ["No session was active in the last hour."];
  const { over } = new ContextWatch().check(sessions, name);
  return ["Live sessions (context carried, used in all, latest turn):", ...sessionLines(sessions, name).map((l) => `  ${l}`),
    ...(over.length ? ["Hand off:", ...over.map((a) => `  ${a.message}`)] : [`None is past ${k(CONTEXT.warn)} of context or ${k(CONTEXT.total.warn)} used in all.`])];
}

/** Phrase -> short word. Only filler and wordy phrases; jargon that steers is left alone. */
const CAVEMAN: [RegExp, string][] = [
  [/\bin order to\b/gi, "to"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\bin the event that\b/gi, "if"],
  [/\bat this point in time\b/gi, "now"],
  [/\bit is important to (?:note|remember) that\s+/gi, ""],
  [/\bis able to\b/gi, "can"],
  [/\ba number of\b/gi, "some"],
  [/\bprior to\b/gi, "before"],
  [/\butili[sz]e\b/gi, "use"],
  [/\b(?:please|basically|essentially|actually|really|simply)\s+(?=\S)/gi, ""],
  [/\b(?:please|basically|essentially|actually|really|simply)\s+$/gi, ""],
  [/(\S)  +/g, "$1 "],
];
const KEEP_AS_IS = /(`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/;

/** One prose line, trimmed. Code spans, links and URLs are left whole; a capital at the start stays a capital. */
export function trimLine(line: string): string {
  const out = line.split(KEEP_AS_IS).map((part, i) => (i % 2 ? part : CAVEMAN.reduce((p, [re, to]) => p.replace(re, to), part))).join("").replace(/[ \t]+$/, "");
  return /^\s*[A-Z]/.test(line) ? out.replace(/^(\s*)([a-z])/, (_, sp, c) => sp + c.toUpperCase()) : out;
}

/** A diff of trims for one file's text (null when nothing to trim). Skips code fences, tables, headings and front matter (but a skill's `description:`, which every session pays for). */
export function trimDiff(name: string, src: string): { diff: string; saved: number } | null {
  const lines = src.split("\n"), hunks: string[] = [];
  let fence = false, front = lines[0] === "---", saved = 0;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    if (i > 0 && front && l === "---") front = false;
    if (fence || (front && !/^description:/.test(l)) || /^\s*(\||#|```|---)/.test(l) || !l.trim()) return;
    const t = trimLine(l);
    if (t === l) return;
    saved += Math.round((l.length - t.length) / 4);
    hunks.push(`@@ -${i + 1} +${i + 1} @@\n-${l}\n+${t}`);
  });
  return hunks.length ? { diff: [`--- a/${name}`, `+++ b/${name}`, ...hunks].join("\n"), saved } : null;
}

/** The standing text of this repo: root CLAUDE.md and AGENTS.md, each skill's SKILL.md (its description is loaded every session), and the memory index of each project dir for it. */
export function standing(repo: string, projects: string): [string, string][] {
  const files: [string, string][] = ["CLAUDE.md", "AGENTS.md"].map((n) => [n, path.join(repo, n)]);
  const skills = path.join(repo, ".claude/skills");
  if (existsSync(skills)) for (const d of readdirSync(skills)) files.push([`.claude/skills/${d}/SKILL.md`, path.join(skills, d, "SKILL.md")]);
  if (existsSync(projects))
    for (const d of readdirSync(projects).filter((d) => d.includes("RustyBuns"))) files.push([path.join(projects, d, "memory/MEMORY.md").replace(homedir(), "~"), path.join(projects, d, "memory/MEMORY.md")]);
  return files.filter(([, f]) => existsSync(f));
}

/** Dexter's proposal: the diff of every trim, then what it saves. Nothing is written. */
export function propose(files: [string, string][]): string[] {
  const diffs = files.flatMap(([name, f]) => trimDiff(name, readFileSync(f, "utf8")) ?? []);
  if (!diffs.length) return ["Standing text is already short. Nothing to cut."];
  const saved = diffs.reduce((n, d) => n + d.saved, 0);
  return [`Trims for the text every session pays for (about ${k(saved)} tokens a session). Not applied. To take them, save as a file and run git apply --unidiff-zero.`, ...diffs.map((d) => d.diff)];
}

/** The transcripts of this repo (and its worktrees) touched in the last `hours`. */
export function recent(root: string, hours: number, now = Date.now()): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((d) => d.includes("RustyBuns"))
    .flatMap((d) => readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(root, d, f)))
    .filter((f) => now - statSync(f).mtimeMs < hours * 36e5);
}

if (import.meta.main) {
  const files = recent(path.join(homedir(), ".claude/projects"), Number(process.env.DEXTER_HOURS) || 24);
  const r: Report = { sessions: files.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, modes: noModes(), chores: new Map() };
  for (const f of files) tally(readFileSync(f, "utf8").split("\n"), r);
  console.log([...render(r), ...contextLines(new Meter().scan(path.join(homedir(), ".claude/projects"))), ...(Number(process.env.DEXTER_HOURS) >= 168 ? week(r, Number(process.env.DEXTER_GROWTH) || 1.5) : []), "", ...propose(standing(process.cwd(), path.join(homedir(), ".claude/projects")))].join("\n"));
}
