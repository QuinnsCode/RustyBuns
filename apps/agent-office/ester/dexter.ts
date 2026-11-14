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
// And whether a session's turn stalled (`StallWatch`, #4306): a request with no reply for 10 min, or a turn a notice opened
// that ended owing work, quiet 30 min. The office tells a stalled worker to carry on (triage/server.ts `watchStalls`).
// Run: bun apps/agent-office/ester/dexter.ts
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// What he reads out of a session (tally, the Report, chores, modes, units) and the trims are shared with codeSplitter's Dexter.
import { CAP, CHORES, choreOf, familyOf, FAMILIES, modeOf, noModes, tally, tip, trimDiff, trimLine, units, type Block, type Chore, type Family, type Line, type Mode, type Modes, type Report } from "@rustybuns/util/dexter";
export { CAP, CHORES, choreOf, familyOf, FAMILIES, modeOf, noModes, tally, trimDiff, trimLine, units };
export type { Chore, Family, Mode, Modes, Report };

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
  const one = (x: Modes["code"]) => `${x.calls} (${k(x.tokens)} tokens)`;
  const out = [`Code mode ${one(m.code)}, tool loads ${m.load.calls} (${m.load.tools} schemas into the context), direct MCP calls ${one(m.direct)}.`];
  if (m.direct.calls > m.code.calls) out.push("  More MCP calls go one by one than through code mode: where a server has execute, one program that returns only the answer is cheaper.");
  return out;
}

/** Where Dexter warns and where he says to hand off. `warn` and `handoff` are the context a session carries into its next turn (tokens);
 * `total.warn` and `total.handoff` are all it has used over its life, since every turn re-reads the whole context. */
export const CONTEXT = { warn: 150_000, handoff: 250_000, total: { warn: 10_000_000, handoff: 25_000_000 } } as const;
const ACTIVE_HOURS = 1;

/** Where a session's turn stands, from its transcript (#4306): `at` its latest timestamped line, `asked` a request to the model
 * still waiting for its reply, `ended` the last reply closed the turn, `by` who opened the turn (a person, or a notice or
 * another system event), `reported` the closing reply says "N of M", `pr` the session has linked a pull request. Times in ms. */
export interface Pace { at: number; asked?: number; ended: boolean; by: "human" | "system"; reported: boolean; pr: boolean }

/** One live session: the context it carries now, what it has used in all, what its latest turn took (tokens), and where its turn stands. */
export interface Context { session: string; cwd: string; tokens: number; total: number; turn: number; modes: Record<Mode, number>; pace: Pace }

/** A transcript line, with the fields the pace reads. */
type Entry = Line & { querySource?: string; isSidechain?: boolean; isMeta?: boolean; origin?: { kind?: string }; attachment?: { type?: string; origin?: { kind?: string } }; message?: Line["message"] & { stop_reason?: string } };
const REPORTED = /\b\d+ of \d+\b/;

/** Moves a session's pace on by one transcript line. */
function step(p: Pace, l: Entry, reply: { id?: string; text: string }) {
  const ts = typeof l.timestamp === "string" ? Date.parse(l.timestamp) : NaN;
  if (Number.isFinite(ts)) p.at = Math.max(p.at, ts);
  if (l.isSidechain === true) return;
  if (l.type === "api-request" && l.querySource === "repl_main_thread" && Number.isFinite(ts)) p.asked = ts;
  else if (l.type === "pr-link") p.pr = true;
  else if (l.type === "assistant") {
    p.asked = undefined;
    const id = l.message?.id, blocks = Array.isArray(l.message?.content) ? (l.message.content as Block[]) : [];
    if (id !== reply.id) [reply.id, reply.text] = [id, ""]; // a reply is written a block a line
    reply.text += blocks.map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : "")).join("");
    p.ended = l.message?.stop_reason === "end_turn";
    p.reported = p.ended && REPORTED.test(reply.text);
  } else if (l.type === "user" && l.isMeta !== true) {
    const content = l.message?.content;
    if (Array.isArray(content) && content.every((b: Block) => b?.type === "tool_result")) return;
    const kind = l.origin?.kind;
    [p.by, p.ended] = [typeof kind === "string" && kind !== "human" ? "system" : "human", false];
  } else if (l.type === "attachment" && l.attachment?.type === "queued_command" && l.attachment.origin?.kind === "human") p.by = "human"; // a person's message joined the turn: it is theirs now
}

/** Reads sessions' transcripts without re-reading them: each scan takes only the lines added since the last one. */
export class Meter {
  private files = new Map<string, { pos: number; seen: Set<string>; total: number; modes: Record<Mode, number>; pace: Pace; reply: { id?: string; text: string }; now: Omit<Context, "total" | "modes" | "pace"> | null }>();

  /** Every session touched in the last hour. A reply counts once by message id, in the total and as the latest turn. */
  scan(root: string, now = Date.now()): Context[] {
    return recent(root, ACTIVE_HOURS, now).flatMap((f) => {
      let st = this.files.get(f);
      const size = statSync(f).size;
      if (!st || size < st.pos) this.files.set(f, (st = { pos: 0, seen: new Set(), total: 0, modes: { code: 0, load: 0, direct: 0 }, pace: { at: 0, ended: false, by: "human", reported: false, pr: false }, reply: { text: "" }, now: null })); // a new file, or one that was rewritten
      if (size > st.pos) {
        const buf = Buffer.alloc(size - st.pos), fd = openSync(f, "r");
        try { readSync(fd, buf, 0, buf.length, st.pos); } finally { closeSync(fd); }
        const end = buf.lastIndexOf(10) + 1; // only whole lines: the last one may still be being written
        st.pos += end;
        for (const raw of buf.subarray(0, end).toString("utf8").split("\n")) {
          let l: Entry;
          try { l = JSON.parse(raw); } catch { continue; }
          if (typeof l !== "object" || l === null) continue;
          step(st.pace, l, st.reply);
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
      return st.now ? [{ ...st.now, total: st.total, modes: { ...st.modes }, pace: { ...st.pace } }] : [];
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

/** How long a turn may sit before the office calls it stalled (ms): `hung` a request with no reply, `quiet` a notice-opened turn that ended owing work. */
export const STALL = { hung: 10 * 60_000, quiet: 30 * 60_000 } as const;
export type StallKind = keyof typeof STALL;
export interface Stall extends Context { name: string; kind: StallKind; minutes: number; message: string }

/** Whether a session's turn has stalled: a request out with no reply and nothing written for STALL.hung (the request hung, or the process
 * died or was suspended: no Stop hook fires), or a turn a notice opened that ended without "N of M" or a PR, quiet for STALL.quiet. */
export function stallOf(c: Context, now = Date.now()): StallKind | null {
  const { pace: p } = c, idle = now - p.at;
  if (p.asked !== undefined && idle >= STALL.hung) return "hung";
  if (p.ended && p.by === "system" && !p.reported && !p.pr && idle >= STALL.quiet) return "quiet";
  return null;
}

/** What the office types into a stalled worker. */
export const CARRY_ON = "The office noticed your turn stalled: no reply came, or a background notice ended it with work still owed. Carry on with the task you owe. " +
  "If the work really is finished, end with \"N of M done\" and the links for anything left.";

/** Remembers each stall it has named, so each fires once; a session that writes again and stalls again fires again. */
export class StallWatch {
  private told = new Map<string, string>();
  /** `stalled`: every session stalled now. `fresh`: the ones that stalled since the last check. */
  check(sessions: Context[], now = Date.now(), name: (c: Context) => string = nameOf): { stalled: Stall[]; fresh: Stall[] } {
    const stalled: Stall[] = [], fresh: Stall[] = [];
    for (const c of sessions) {
      const kind = stallOf(c, now);
      if (!kind) { this.told.delete(c.session); continue; }
      const who = name(c), minutes = Math.floor((now - c.pace.at) / 60_000);
      const message = kind === "hung"
        ? `${who} asked the model ${minutes} min ago and no reply came: the request hung, or the process stopped.`
        : `${who} ended a turn a background notice opened, with work owed, ${minutes} min ago.`;
      const s = { ...c, name: who, kind, minutes, message };
      stalled.push(s);
      const key = `${kind}:${c.pace.at}`;
      if (this.told.get(c.session) !== key) { fresh.push(s); this.told.set(c.session, key); }
    }
    return { stalled, fresh };
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
  const { over } = new ContextWatch().check(sessions, name), { stalled } = new StallWatch().check(sessions, Date.now(), name);
  return [...(stalled.length ? ["Stalled:", ...stalled.map((s) => `  ${s.message}`)] : []), "Live sessions (context carried, used in all, latest turn):", ...sessionLines(sessions, name).map((l) => `  ${l}`),
    ...(over.length ? ["Hand off:", ...over.map((a) => `  ${a.message}`)] : [`None is past ${k(CONTEXT.warn)} of context or ${k(CONTEXT.total.warn)} used in all.`])];
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
/** This repo's transcripts touched in the last `hours`; with `subagents`, also each session's `<id>/subagents/*.jsonl` (their spend is real, but they aren't sessions with a context of their own). */
export function recent(root: string, hours: number, now = Date.now(), subagents = false): string[] {
  if (!existsSync(root)) return [];
  const jsonl = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f)) : []);
  return readdirSync(root)
    .filter((d) => d.includes("RustyBuns"))
    .flatMap((d) => { const top = jsonl(path.join(root, d)); return subagents ? [...top, ...top.flatMap((f) => jsonl(path.join(f.slice(0, -6), "subagents")))] : top; })
    .filter((f) => now - statSync(f).mtimeMs < hours * 36e5);
}

if (import.meta.main) {
  const files = recent(path.join(homedir(), ".claude/projects"), Number(process.env.DEXTER_HOURS) || 24);
  const r: Report = { sessions: files.length, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tools: new Map(), turns: 0, days: new Map(), helpers: { mervin: 0, ester: 0, dexter: 0 }, fights: 0, episodes: 0, modes: noModes(), chores: new Map() };
  for (const f of files) tally(readFileSync(f, "utf8").split("\n"), r);
  console.log([...render(r), ...contextLines(new Meter().scan(path.join(homedir(), ".claude/projects"))), ...(Number(process.env.DEXTER_HOURS) >= 168 ? week(r, Number(process.env.DEXTER_GROWTH) || 1.5) : []), "", ...propose(standing(process.cwd(), path.join(homedir(), ".claude/projects")))].join("\n"));
}
