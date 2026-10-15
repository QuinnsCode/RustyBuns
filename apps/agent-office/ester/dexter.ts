// Dexter, the office's token trimmer (called on from the page, ester/index.ts). He reads Claude Code's session
// transcripts for this repo (~/.claude/projects/*RustyBuns*, the last DEXTER_HOURS, default 24), adds up the tokens, and
// names the tools whose results were biggest, since a result stays in the context and is paid for on every turn after.
// He prints short, plain lines, and one tip per offender. He also proposes trims to the standing text every session pays
// for (CLAUDE.md, AGENTS.md, the memory index, skill descriptions): filler words and long phrases cut to short plain ones, printed as a diff
// to approve (`git apply --unidiff-zero`). He never edits a file. No model call, so asking him costs nothing.
// DEXTER_HOURS=168 adds the week: spend per day, what each helper's job costs, and what it saves at growing PR counts.
// Run: bun apps/agent-office/ester/dexter.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type Block = { type?: string; id?: string; name?: string; tool_use_id?: string; input?: { command?: string }; content?: unknown; text?: string };
type Line = { type?: string; timestamp?: string; message?: { id?: string; usage?: Record<string, number>; content?: unknown } };

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
  const names = new Map<string, string>(), seen = new Set<string>(), cats = new Map<string, "mervin" | "ester">();
  const results: { tokens: number; at: number; cat?: "mervin" | "ester" }[] = [];
  let turn = 0, fighting = false, settled = false;
  for (const raw of lines) {
    let l: Line;
    try { l = JSON.parse(raw); } catch { continue; }
    const blocks = Array.isArray(l.message?.content) ? (l.message.content as Block[]) : [];
    if (l.type === "assistant") {
      for (const b of blocks)
        if (b.type === "tool_use" && b.id && b.name) {
          names.set(b.id, kind(b.name));
          const cmd = b.input?.command ?? b.name;
          if (SETTLED.test(cmd)) settled = true;
          const cat0 = cmd, cat = MERVIN.test(cat0) ? "mervin" : ESTER.test(cat0) ? "ester" : undefined;
          if (cat) cats.set(b.id, cat);
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
  out.push("Say less: short words, no preamble, no recap. Keep jargon that steers.");
  return out;
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
  const r: Report = { sessions: files.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0 };
  for (const f of files) tally(readFileSync(f, "utf8").split("\n"), r);
  console.log([...render(r), ...(Number(process.env.DEXTER_HOURS) >= 168 ? week(r, Number(process.env.DEXTER_GROWTH) || 1.5) : []), "", ...propose(standing(process.cwd(), path.join(homedir(), ".claude/projects")))].join("\n"));
}
