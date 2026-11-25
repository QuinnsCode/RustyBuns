// How long turns take on each model, from this repo's Claude Code transcripts (Claude Code keeps 30 days).
// A turn runs from a prompt someone typed to the last reply before the next one; its model is the one that wrote most of
// its replies. A step is one reply: "think" is the model's own time on it (from the line before it, a prompt or a tool
// result, to its last line), and the rest of a turn is tools (tests, builder waits, installs).
// Tables: per model (turns, median and p90 turn, median think per step, steps per turn, the share of a turn spent in
// tools); per model and week (is a model getting slower?); per model and effort, where the transcript recorded it
// (Claude Code 2.1.33x writes `api-request` lines); worker sessions to `gh pr create` (first prompt to that call, its
// turns, and output tokens as a rough size of the job); subagents (`<session>/subagents/*.jsonl`) by their own model; and,
// per model, where tool time went: each call from the call to its result, Bash by what its command waits on (`kindOf`).
// "w/o you" is the median turn without the time it sat on you (a question, or a quick tool held over a minute on a
// permission prompt).
// Run: bun scripts/turn-times.ts [days=30] [--json]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { recent } from "../apps/agent-office/ester/dexter.ts";
import { arr, check, maybe, num, obj, opt, raw, str } from "../packages/util/src/guard.ts";
import { day } from "../apps/agent-office/ester/ledger.ts";
import { help } from "./help.ts";

const Block = obj({ type: str(60), id: opt(str(200)), tool_use_id: opt(str(200)), name: opt(str(200)), input: opt(raw) });
const Line = obj({
  type: str(60),
  timestamp: opt(str(60)),
  isMeta: maybe(raw),
  querySource: opt(str(100)),
  params: maybe(obj({ output_config: maybe(obj({ effort: opt(str(20)) })) })),
  message: maybe(obj({ id: opt(str(200)), model: opt(str(100)), content: opt(raw), usage: maybe(obj({ output_tokens: opt(num(0, 1e9)) })) })),
});
const Blocks = arr(Block, 10_000, { drop: true });
const PrCall = obj({ command: str(100_000) });
/** A Bash call that opens a PR (not one that greps for the words). */
const OPENS_PR = /(^|[;&|(\n]\s*)gh pr create\b/m;

/** One tool call: what kind it was (`kindOf`) and how long from the call to its result (ms). */
export interface Call { kind: string; ms: number }

/** One turn: when it started and ended, its steps per model, each step's think time (ms), its tool calls, output tokens, and effort. */
export interface Turn { start: number; end: number; steps: Map<string, number>; think: number[]; calls: Call[]; out: number; effort?: string; prAt?: number }

/** Bash commands by what they wait on, first match wins: the line's first command after a `cd`, so `cd x && bun test` is a test. */
const BASH: [string, RegExp][] = [
  ["bash: builder (Bob)", /\bbun run builder\b|remote-ci\.ts/],
  ["bash: PR checks wait", /\bbun run pr\b|scripts\/pr\.ts|gh pr checks|gh run (watch|view)/],
  ["bash: preflight", /preflight\.ts/],
  ["bash: tests here", /\bbun test\b|test-bites/],
  ["bash: install", /\bbun (install|add|i)\b|\bbunx? --bun\b|npm (i|install|ci)\b/],
  ["bash: typecheck/lint/docs", /typecheck|\btsc\b|\blint\b|boundary-audit|bun run (docs|site)\b|\bknip\b/],
  ["bash: build", /vite build|bun run build|build:native|\bcargo\b|xcodebuild|\bblender\b|wrangler deploy|rustybuns (deploy|plan)/],
  ["bash: probe/browser", /bun run probe|scripts\/probe\.ts|playwright|chrome/i],
  ["bash: dev server", /bun (run )?(dev|start|serve)\b|vite\b|wrangler dev/],
  ["bash: sleep/wait loop", /\bsleep \d|\buntil\b|\bwait\b/],
  ["bash: office-workers", /office-workers/],
  ["bash: gh", /\bgh /],
  ["bash: git network", /\bgit (fetch|push|pull|clone)\b/],
  ["bash: git", /\bgit /],
  ["bash: outline/issue/brief", /bun run (outline|issue|brief|climbs|bridge|rings)\b/],
  ["bash: read/search", /^\s*(cat|grep|rg|ls|find|head|tail|sed -n|wc|jq)\b/],
];
const Command = obj({ command: str(100_000), run_in_background: opt(raw) });

/** What a tool call was, for the breakdown: Bash by its command, MCP by server, the rest by tool name. */
export function kindOf(name: string, input: unknown): string {
  if (name === "Bash") {
    const c = check(Command, input);
    if (!c) return "bash: other";
    if (c.run_in_background === true) return "bash: started in background";
    return BASH.find(([, re]) => re.test(c.command))?.[0] ?? "bash: other";
  }
  if (name === "AskUserQuestion") return "waiting on you: question";
  if (name === "Yield") return "waiting: background job (Yield)";
  if (name === "Agent" || name === "Task") return "subagent";
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name);
  return mcp ? `mcp: ${mcp[1].replace(/^claude_ai_/, "")}` : name;
}

/** Tools that answer in about a second: one that took over a minute sat on a permission prompt. */
const QUICK = /^(Read|Edit|Write|Grep|Glob|NotebookEdit|bash: (git|read\/search|outline\/issue\/brief|started in background))$/;

/** A prompt someone typed: a user line with text, not a tool result or a harness note. */
const prompt = (content: unknown): boolean => {
  if (typeof content === "string") return !content.startsWith("<") || content.startsWith("<command-name>");
  const blocks = check(Blocks, content) ?? [];
  return blocks.length > 0 && blocks.every((b) => b.type === "text" || b.type === "image");
};

/** A transcript's turns, in order. A reply is one step however many lines its blocks take (they share a message id). */
export function turns(text: string): Turn[] {
  const out: Turn[] = [];
  const replies = new Map<string, { from: number; to: number; turn: Turn }>();
  let cur: Turn | undefined;
  let last = 0; // the latest prompt or tool result
  let effort: string | undefined;
  const pending = new Map<string, { at: number; kind: string; turn: Turn }>(); // tool calls waiting for their result
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    const e = check(Line, parsed);
    if (!e) continue;
    if (e.type === "api-request" && (e.querySource ?? "repl_main_thread").startsWith("repl_main_thread")) {
      effort = e.params?.output_config?.effort ?? effort;
      if (cur) cur.effort = effort;
      continue;
    }
    if (!e.timestamp || !e.message) continue;
    const at = Date.parse(e.timestamp);
    if (!Number.isFinite(at)) continue;
    if (e.type === "user") {
      last = at;
      for (const b of check(Blocks, e.message.content) ?? []) {
        const call = b.type === "tool_result" && b.tool_use_id ? pending.get(b.tool_use_id) : undefined;
        if (!call) continue;
        pending.delete(b.tool_use_id ?? "");
        const ms = Math.max(0, at - call.at);
        call.turn.calls.push({ kind: QUICK.test(call.kind) && ms > 60_000 ? "waiting on you: permission prompt" : call.kind, ms });
      }
      if (!e.isMeta && prompt(e.message.content)) out.push((cur = { start: at, end: at, steps: new Map(), think: [], calls: [], out: 0, effort }));
      continue;
    }
    if (e.type !== "assistant" || !cur) continue;
    cur.end = Math.max(cur.end, at);
    for (const b of check(Blocks, e.message.content) ?? []) {
      const cmd = b.name === "Bash" ? check(PrCall, b.input)?.command : undefined;
      if (cmd && OPENS_PR.test(cmd)) cur.prAt ??= at;
      if (b.type === "tool_use" && b.id && b.name) pending.set(b.id, { at, kind: kindOf(b.name, b.input), turn: cur });
    }
    const { id, model } = e.message;
    if (!id || !model || model === "<synthetic>") continue;
    const r = replies.get(id);
    if (r) { r.to = Math.max(r.to, at); continue; }
    replies.set(id, { from: last || cur.start, to: at, turn: cur });
    cur.steps.set(model, (cur.steps.get(model) ?? 0) + 1);
    cur.out += e.message.usage?.output_tokens ?? 0;
  }
  for (const r of replies.values()) r.turn.think.push(Math.max(0, r.to - r.from));
  return out.filter((t) => t.steps.size > 0);
}

/** The model that wrote most of a turn's (or a session's) replies, without the `claude-` prefix or a date suffix. */
export const mainModel = (steps: Map<string, number>): string =>
  ([...steps].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "").replace(/-\d{8}$/, "").replace(/^claude-/, "");

const q = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface Row { key: string; turns: number; medianMin: number; p90Min: number; withoutYouMin: number; thinkSec: number; stepsPerTurn: number; toolShare: number }

/** The part of a turn spent waiting on the owner (a question, a permission prompt), not on the model or a tool. */
const yours = (t: Turn) => sum(t.calls.filter((c) => c.kind.startsWith("waiting on you")).map((c) => c.ms));

/** One row per key: how many turns, how long they took, the model's time per step, and how much went to tools. */
export function rows(all: Turn[], keyOf: (t: Turn) => string | undefined, min = 5): Row[] {
  const by = Map.groupBy(all.filter((t) => keyOf(t)), (t) => keyOf(t) ?? "");
  return [...by].filter(([, ts]) => ts.length >= min).map(([key, ts]) => {
    const ms = ts.map((t) => t.end - t.start);
    const think = ts.flatMap((t) => t.think);
    return {
      key, turns: ts.length, medianMin: q(ms, 0.5) / 6e4, p90Min: q(ms, 0.9) / 6e4, thinkSec: q(think, 0.5) / 1000,
      withoutYouMin: q(ts.map((t) => Math.max(0, t.end - t.start - yours(t))), 0.5) / 6e4,
      stepsPerTurn: think.length / ts.length, toolShare: Math.max(0, 1 - sum(think) / Math.max(1, sum(ms))),
    };
  }).sort((a, b) => b.turns - a.turns);
}

export interface ToolRow { kind: string; calls: number; hours: number; share: number; medianSec: number; p90Sec: number }

/** Where turns' tool time went, biggest first. Calls sent together overlap, so the hours add up to a bit more than the wall clock. */
export function toolRows(ts: Turn[]): ToolRow[] {
  const calls = ts.flatMap((t) => t.calls);
  const total = Math.max(1, sum(calls.map((c) => c.ms)));
  return [...Map.groupBy(calls, (c) => c.kind)].map(([kind, cs]) => {
    const ms = cs.map((c) => c.ms);
    return { kind, calls: cs.length, hours: sum(ms) / 36e5, share: sum(ms) / total, medianSec: q(ms, 0.5) / 1000, p90Sec: q(ms, 0.9) / 1000 };
  }).sort((a, b) => b.hours - a.hours);
}

export interface PrRun { model: string; wallMin: number; turns: number; out: number }

/** A session that opened a PR: its main model, its first prompt to `gh pr create`, the turns and output tokens up to it. */
export function prRun(ts: Turn[]): PrRun | undefined {
  const i = ts.findIndex((t) => t.prAt);
  if (i < 0) return undefined;
  const upTo = ts.slice(0, i + 1);
  const steps = new Map<string, number>();
  for (const t of upTo) for (const [m, n] of t.steps) steps.set(m, (steps.get(m) ?? 0) + n);
  return { model: mainModel(steps), wallMin: ((upTo[i].prAt ?? upTo[i].end) - upTo[0].start) / 6e4, turns: upTo.length, out: sum(upTo.map((t) => t.out)) };
}

/** The Monday a moment's week starts on, local time. */
const week = (ms: number) => { const d = new Date(ms); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return day(d.getTime()); };
const f1 = (n: number, w = 6) => n.toFixed(1).padStart(w);
const table = (title: string, rs: Row[]) => [
  `\n${title}`, `  ${"".padEnd(26)} turns  median    p90  w/o you  think/step  steps/turn  tools`,
  ...rs.map((r) => `  ${r.key.padEnd(26)}${String(r.turns).padStart(6)} ${f1(r.medianMin)}m ${f1(r.p90Min)}m ${f1(r.withoutYouMin, 7)}m ${f1(r.thinkSec, 9)}s ${f1(r.stepsPerTurn, 10)}  ${(r.toolShare * 100).toFixed(0).padStart(4)}%`),
].join("\n");

if (import.meta.main) {
  help(import.meta.path);
  const days = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || 30;
  const files = recent(path.join(homedir(), ".claude/projects"), days * 24, Date.now(), true);
  const top: Turn[] = [], sub: Turn[] = [], prs: PrRun[] = [];
  for (const f of files) {
    const ts = turns(readFileSync(f, "utf8"));
    if (f.includes("/subagents/")) { sub.push(...ts); continue; }
    top.push(...ts);
    const pr = f.includes("-agent-office-worktrees-") ? prRun(ts) : undefined;
    if (pr) prs.push(pr);
  }
  const model = (t: Turn) => mainModel(t.steps);
  const toPr = [...Map.groupBy(prs, (p) => p.model)].filter(([, ps]) => ps.length >= 3).map(([m, ps]) => ({
    model: m, prs: ps.length, medianMin: q(ps.map((p) => p.wallMin), 0.5), p90Min: q(ps.map((p) => p.wallMin), 0.9),
    medianTurns: q(ps.map((p) => p.turns), 0.5), medianOutK: q(ps.map((p) => p.out), 0.5) / 1000,
  })).sort((a, b) => b.prs - a.prs);
  const report = {
    days, transcripts: files.length,
    byModel: rows(top, model),
    byWeek: rows(top, (t) => `${model(t)} ${week(t.start)}`, 20).sort((a, b) => a.key.localeCompare(b.key)),
    byEffort: rows(top, (t) => (t.effort ? `${model(t)} ${t.effort}` : undefined)),
    toPr,
    subagents: rows(sub, model, 3),
    tools: Object.fromEntries([...Map.groupBy(top, model)].filter(([, ts]) => ts.length >= 100).map(([m, ts]) => [m, toolRows(ts)])),
  };
  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }
  console.log(`${days} days, ${files.length} transcripts`);
  console.log(table("By model", report.byModel));
  console.log(table("By model and week (weeks start Monday; 20+ turns)", report.byWeek));
  console.log(table("By model and effort (only where the transcript recorded it)", report.byEffort));
  console.log(`\nWorker sessions, first prompt to \`gh pr create\`\n  ${"".padEnd(26)}   PRs  median    p90  turns  output tokens`);
  for (const r of toPr) console.log(`  ${r.model.padEnd(26)}${String(r.prs).padStart(6)} ${f1(r.medianMin)}m ${f1(r.p90Min)}m ${String(r.medianTurns).padStart(6)} ${f1(r.medianOutK, 10)}k`);
  console.log(table("Subagents (one turn each)", report.subagents));
  for (const [m, rs] of Object.entries(report.tools)) {
    console.log(`\nTool time in ${m} turns (call to result; top 16)\n  ${"".padEnd(34)} calls   hours  share  median     p90`);
    for (const r of rs.slice(0, 16)) console.log(`  ${r.kind.padEnd(34)}${String(r.calls).padStart(6)} ${f1(r.hours, 7)} ${(r.share * 100).toFixed(0).padStart(5)}% ${f1(r.medianSec, 6)}s ${f1(r.p90Sec, 6)}s`);
  }
}
