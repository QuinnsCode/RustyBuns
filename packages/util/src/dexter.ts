// Dexter's reading of one agent session, shared by the office (apps/agent-office/ester/dexter.ts reads Claude Code's
// transcripts on disk) and codeSplitter (src/dexter.ts reads the stream-json a hosted agent run prints, which has the
// same assistant/user lines). `tally` adds a session to a Report: token usage, turns, and per tool its calls, result
// tokens and worst single result, plus chores, how tools were reached and merge fights. `trimDiff` proposes cuts to
// standing text (CLAUDE.md, AGENTS.md) as a diff a person approves. Pure: no files, no clock, imports nothing.

export type Block = { type?: string; id?: string; name?: string; tool_name?: string; tool_use_id?: string; input?: { command?: string }; content?: unknown; text?: string };
export type Line = { type?: string; timestamp?: string; sessionId?: string; cwd?: string; message?: { id?: string; model?: string; usage?: Record<string, number>; content?: unknown } };

/** The model families a ledger splits spend by. */
export const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;
export type Family = (typeof FAMILIES)[number] | "other";
/** "claude-opus-5-5" -> "opus"; a synthetic or unknown model is "other". */
export const familyOf = (model = ""): Family => FAMILIES.find((f) => model.includes(f)) ?? "other";

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
  /** How many separate fights that was (a conflict showing up in a result, up to the commit that settled it). */
  episodes: number;
  /** Calls and result tokens by how the tool was reached (`modeOf`). */
  modes: Modes;
  /** Chore name (`choreOf`) -> calls, result tokens, and streaks (the same chore twice or more in a row: polling, or re-reading). */
  chores: Map<Chore, { calls: number; tokens: number; streaks: number }>;
  /** Units by model family (`familyOf`), when the caller wants them (the ledger does). */
  models?: Map<Family, number>;
}

export type Chore = "ci" | "issues" | "browser" | "reading" | "install" | "sync" | "tests";
/** Each chore the sessions do by hand, and the tool that does it in one call. */
export const CHORES: Record<Chore, { label: string; tool: string }> = {
  ci: { label: "CI polling (gh pr checks, gh run view, sleep)", tool: "bun run pr <n> waits for the checks and prints a line per outcome, with a failed step's log tail." },
  issues: { label: "issue reads (gh issue view)", tool: "bun run issue <n> [n ...] is the brief: header, body cut at a paragraph, the last three comments." },
  browser: { label: "browser driving (tabs, navigate, scripts, screenshots)", tool: "bun run probe <app> [path] [--js expr] asks the game for its state as text; --shot when eyes are needed." },
  reading: { label: "reading code (sed -n, cat, grep, head)", tool: "bun run outline --api <package or file> prints a shared library's exports as one-line signatures; bun run outline <file> lists every symbol with its line range, then bun run outline <file> <name> prints just that one (or grep -n -m 20); through codeSplitter, one execute program that returns only the lines you filter." },
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

export const TIPS: Record<string, string> = {
  Read: "Read with offset+limit, or grep first. Whole files stay in context.",
  Bash: "Pipe to tail/head/grep. Print counts, not logs.",
  Grep: "Use -l or a head_limit. Paths first, lines later.",
  Agent: "Ask the subagent for 5 lines. Not a report.",
  WebFetch: "Give it a prompt that asks for one fact.",
  mcp: "Big MCP result: try the CLI with a narrow flag, or ask the tool for fewer fields.",
};
export const tip = (tool: string) => TIPS[tool.startsWith("mcp:") ? "mcp" : tool] ?? "Ask for less. Short answer, no echo.";

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
      if (r.models) { const f = familyOf(l.message?.model); r.models.set(f, (r.models.get(f) ?? 0) + spent); }
      if (fighting) r.fights += spent;
      if (settled) fighting = settled = false;
    } else if (l.type === "user") {
      for (const b of blocks) {
        if (b.type !== "tool_result" || !b.tool_use_id) continue;
        if (CONFLICT.test(text(b.content))) { if (!fighting) r.episodes++; fighting = true; }
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

/** Phrase -> short word. Only filler and wordy phrases; jargon that steers is left alone. */
export const CAVEMAN: [RegExp, string][] = [
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

/** An empty report to tally into. */
export const newReport = (models = false): Report => ({ sessions: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, episodes: 0, modes: noModes(), chores: new Map(), ...(models ? { models: new Map() } : {}) });
