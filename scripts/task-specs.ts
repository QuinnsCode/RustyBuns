// How the task a worker was hired with relates to how its run went, read from the office's own sessions. Each
// worker session's first prompt is its task (plus the issue body when it says "issue #N"); it is sorted into four
// levels (vague, decided, agent-ready, thread) and set beside what happened: did a PR open and merge, how many
// times the owner had to steer it after the hire, how long it ran and what it spent. Findings: notes/TASK_SPECS.md.
//
// Prints one table by level. `--out file.json` also writes one row per session with numbers only: no prompt text,
// no names, no paths, so it can be shared. Transcripts are Claude Code's (~/.claude/projects, kept about 30 days);
// PRs, issue bodies and issue comments come from `gh`, so it needs a signed-in gh.
// Run: bun scripts/task-specs.ts [--out rows.json] [--days 30]
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, int, maybe, nul, obj, opt, raw, str, type Of } from "../packages/util/src/guard.ts";
import { newReport, tally, units } from "../packages/util/src/dexter.ts";
import { help } from "./help.ts";

export const LEVELS = ["vague", "decided", "agent-ready", "thread"] as const;
export type Level = (typeof LEVELS)[number];

/** What a spec's text holds, counted, never kept. */
export function features(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const paths = new Set(text.match(/\b[\w.-]+\/[\w./-]+\.\w{1,5}\b/g) ?? []).size;
  const bullets = (text.match(/^\s*(?:[-*]|\d+\.)\s/gm) ?? []).length;
  const checks = /\b(test|verify|acceptance|done when|passes|expect|assert)\b/i.test(text);
  const decisions = (text.match(/\b(never|must|always|don't|do not|only|instead of|not)\b/gi) ?? []).length;
  const voices = (text.match(/\[From |<pasted_content|^\s*>|^\[comment\]$/gm) ?? []).length; // relayed messages, quoted replies, issue comments
  return { words, paths, bullets, checks, decisions, voices };
}
export type Features = ReturnType<typeof features>;

/** The four levels of the issue-detail test, read off the counts: a thread is many voices; agent-ready names where
 * to work and how to check it; decided says what it must and must not do; the rest is vague. */
export function level(f: Features): Level {
  if (f.voices >= 2) return "thread";
  if (f.paths >= 1 && f.checks && f.words >= 120) return "agent-ready";
  if (f.words >= 50 || f.decisions >= 3) return "decided";
  return "vague";
}

const Block = maybe(obj({ type: str(40), text: opt(str(1e6)) }));
const Line = obj({
  type: opt(str(40)), timestamp: opt(str(40)), gitBranch: opt(str(200)), isMeta: opt(raw), promptSource: opt(str(40)),
  message: opt(obj({ content: opt(raw) })),
});
const textOf = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map(Block).filter((b) => b?.type === "text").map((b) => b?.text ?? "").join("\n") : "");

/** A human-typed prompt that is the owner's own words: not a notice, hook text or a relayed agent message. */
const ownWords = (t: string) => !t.trimStart().startsWith("<") && !t.includes("[From ") && !t.includes("[Subagent hand-back]");

export type Session = { start: number; end: number; branch: string; task: string; steers: number; pings: number; turns: number; units: number };

/** One worker transcript: its task (first typed prompt), the owner's later prompts (a ping is a status check of a
 * few words, a steer is anything longer), turns, spend and wall time. Null when it never got a task. */
export function readSession(lines: string[]): Session | null {
  let s: Session | null = null;
  for (const raw of lines) {
    if (!raw.includes('"promptSource"')) continue;
    let l: Of<typeof Line>;
    try { l = Line(JSON.parse(raw)); } catch { continue; }
    if (l.type !== "user" || l.isMeta || l.promptSource !== "typed") continue;
    const t = textOf(l.message?.content), at = Date.parse(l.timestamp ?? "");
    if (!t.trim() || !Number.isFinite(at)) continue;
    if (!s) { s = { start: at, end: at, branch: l.gitBranch ?? "", task: t, steers: 0, pings: 0, turns: 0, units: 0 }; continue; }
    if (!ownWords(t)) continue;
    if (t.split(/\s+/).filter(Boolean).length <= 6) s.pings++; else s.steers++;
  }
  if (!s) return null;
  const r = newReport();
  tally(lines, r);
  s.turns = r.turns;
  s.units = units(r.usage);
  for (const raw of lines) { const m = raw.match(/"timestamp":"([^"]+)"/); const at = m ? Date.parse(m[1]) : NaN; if (at > s.end) s.end = at; }
  return s;
}

const Pr = obj({ number: int(1, 1e7), headRefName: str(300), state: str(20), createdAt: str(40), mergedAt: nul(str(40)) });
const Issue = obj({ number: int(1, 1e7), body: opt(str(1e6)), comments: arr(obj({ body: opt(str(1e6)), createdAt: str(40) }), 5000, { drop: true }) });
export type Issue = Of<typeof Issue>;
const gh = (args: string[]) => {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args[0]} ${args[1]}: ${p.stderr.toString().trim()}`);
  return JSON.parse(p.stdout.toString());
};

export type Row = Features & { level: Level; issue: boolean; pr: boolean; merged: boolean; steers: number; pings: number; turns: number; minutes: number; units: number };

/** A session's row: its spec counted (with the issue body when the task names one) and its outcome. */
export function row(s: Session, prs: Of<typeof Pr>[], issues: Map<number, Issue>): Row {
  const n = Number(s.task.slice(0, 300).match(/issue #(\d+)/i)?.[1]);
  const issue = issues.get(n);
  // The issue as the worker read it at the start: its body and the comments already there (not the ones its run added).
  const said = issue ? [issue.body ?? "", ...issue.comments.filter((c) => Date.parse(c.createdAt) < s.start).map((c) => `[comment]\n${c.body ?? ""}`)] : [];
  const spec = [s.task, ...said].join("\n");
  const f = features(spec);
  const mine = prs.filter((p) => p.headRefName === s.branch && Date.parse(p.createdAt) >= s.start - 6e4 && Date.parse(p.createdAt) <= s.end + 864e5);
  return { ...f, level: level(f), issue: !!issue, pr: mine.length > 0, merged: mine.some((p) => p.mergedAt), steers: s.steers, pings: s.pings, turns: s.turns, minutes: Math.round((s.end - s.start) / 6e4), units: Math.round(s.units) };
}

const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");

/** One line per level: sessions, PR and merge rates, steering, time and spend (medians). */
export function table(rows: Row[]): string {
  const head = "level        n    PR  merged  no-steer  steers/run  min  units";
  const lines = LEVELS.map((lv) => {
    const g = rows.filter((r) => r.level === lv), m = g.filter((r) => r.merged).length;
    const steers = g.reduce((a, r) => a + r.steers, 0);
    return [lv.padEnd(11), String(g.length).padStart(4), pct(g.filter((r) => r.pr).length, g.length).padStart(5), pct(m, g.length).padStart(7),
      pct(g.filter((r) => r.steers === 0).length, g.length).padStart(9), (g.length ? (steers / g.length).toFixed(1) : "-").padStart(11),
      String(median(g.map((r) => r.minutes))).padStart(4), `${Math.round(median(g.map((r) => r.units)) / 1e3)}k`.padStart(6)].join(" ");
  });
  return [head, ...lines].join("\n");
}

if (import.meta.main) {
  help(import.meta.path);
  const flag = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const days = Number(flag("--days") ?? 30), out = flag("--out");
  const root = path.join(homedir(), ".claude/projects");
  const files = existsSync(root) ? readdirSync(root).filter((d) => d.includes("RustyBuns") && d.includes("worktrees"))
    .flatMap((d) => readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(root, d, f)))
    .filter((f) => Date.now() - statSync(f).mtimeMs < days * 864e5) : [];
  const prs = arr(Pr, 20000, { drop: true })(gh(["pr", "list", "--state", "all", "--limit", "8000", "--json", "number,headRefName,state,createdAt,mergedAt"]));
  const issues = new Map(arr(Issue, 20000, { drop: true })(gh(["issue", "list", "--state", "all", "--limit", "8000", "--json", "number,body,comments"])).map((i) => [i.number, i]));
  const rows = files.map((f) => readSession(readFileSync(f, "utf8").split("\n"))).filter((s): s is Session => !!s).map((s) => row(s, prs, issues));
  console.log(`${rows.length} worker sessions with a task, last ${days} days\n${table(rows)}`);
  if (out) { writeFileSync(out, JSON.stringify(rows)); console.log(`rows: ${out}`); }
}
