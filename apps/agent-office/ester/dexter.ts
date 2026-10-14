// Dexter, the office's token trimmer (called on from the page, ester/index.ts). He reads Claude Code's session
// transcripts for this repo (~/.claude/projects/*RustyBuns*, the last DEXTER_HOURS, default 24), adds up the tokens, and
// names the tools whose results were biggest, since a result stays in the context and is paid for on every turn after.
// He prints short, plain lines, and one tip per offender. He also proposes trims to the standing text every session pays
// for (CLAUDE.md, AGENTS.md, the memory index): filler words and long phrases cut to short plain ones, printed as a diff
// to approve (`git apply --unidiff-zero`). He never edits a file. No model call, so asking him costs nothing.
// Run: bun apps/agent-office/ester/dexter.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type Block = { type?: string; id?: string; name?: string; tool_use_id?: string; input?: { command?: string }; content?: unknown; text?: string };
type Line = { type?: string; message?: { id?: string; usage?: Record<string, number>; content?: unknown } };

export interface Report {
  sessions: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Tool name (an MCP tool as `mcp:server`) -> calls and the tokens (chars / 4) its results added to the context. */
  tools: Map<string, { calls: number; tokens: number; worst: number }>;
}

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
  const names = new Map<string, string>(), seen = new Set<string>();
  for (const raw of lines) {
    let l: Line;
    try { l = JSON.parse(raw); } catch { continue; }
    const blocks = Array.isArray(l.message?.content) ? (l.message.content as Block[]) : [];
    if (l.type === "assistant") {
      for (const b of blocks) if (b.type === "tool_use" && b.id && b.name) names.set(b.id, kind(b.name));
      const id = l.message?.id, u = l.message?.usage;
      if (!u || (id && seen.has(id))) continue;
      if (id) seen.add(id);
      r.usage.input += u.input_tokens ?? 0;
      r.usage.output += u.output_tokens ?? 0;
      r.usage.cacheRead += u.cache_read_input_tokens ?? 0;
      r.usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    } else if (l.type === "user") {
      for (const b of blocks) {
        if (b.type !== "tool_result" || !b.tool_use_id) continue;
        const tool = names.get(b.tool_use_id) ?? "other", tokens = Math.round(text(b.content).length / 4);
        const t = r.tools.get(tool) ?? { calls: 0, tokens: 0, worst: 0 };
        t.calls++; t.tokens += tokens; t.worst = Math.max(t.worst, tokens);
        r.tools.set(tool, t);
      }
    }
  }
}

const k = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

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

/** A diff of trims for one file's text (null when nothing to trim). Skips code fences, tables, front matter and headings. */
export function trimDiff(name: string, src: string): { diff: string; saved: number } | null {
  const lines = src.split("\n"), hunks: string[] = [];
  let fence = false, front = lines[0] === "---", saved = 0;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    if (i > 0 && front && l === "---") front = false;
    if (fence || front || /^\s*(\||#|```|---)/.test(l) || !l.trim()) return;
    const t = trimLine(l);
    if (t === l) return;
    saved += Math.round((l.length - t.length) / 4);
    hunks.push(`@@ -${i + 1} +${i + 1} @@\n-${l}\n+${t}`);
  });
  return hunks.length ? { diff: [`--- a/${name}`, `+++ b/${name}`, ...hunks].join("\n"), saved } : null;
}

/** The standing text of this repo: root CLAUDE.md and AGENTS.md, and the memory index of each project dir for it. */
export function standing(repo: string, projects: string): [string, string][] {
  const files: [string, string][] = ["CLAUDE.md", "AGENTS.md"].map((n) => [n, path.join(repo, n)]);
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
  const r: Report = { sessions: files.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map() };
  for (const f of files) tally(readFileSync(f, "utf8").split("\n"), r);
  console.log([...render(r), "", ...propose(standing(process.cwd(), path.join(homedir(), ".claude/projects")))].join("\n"));
}
