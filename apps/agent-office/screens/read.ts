// What the wall screens (screens/index.ts) draw, read out of what the helpers print and GitHub answers. Pure, so it is
// tested without a page: Mervin's board (`stage 2: #12 title`, `  9 files, 88% certain   certain 8  card 1`, a row per
// file that wasn't certain, `clash ...`), Ester's stack (`pass  apps/x: bun test  3.1s`, `stage 2 #15: ok`, her hold
// line), and the line of open PRs gitpath walks left to right. Where the three screens sit is here too: fixed slots, so
// turning one off leaves the others where they were.

import type { EsterPhase, EsterState } from "../ester/run.ts";

export type Screen = "gitpath" | "mervin" | "ester";
export const SCREENS: Screen[] = ["gitpath", "mervin", "ester"];

const TIER = ["certain", "agree", "mervin", "differ", "card"] as const;
export type Tier = (typeof TIER)[number];
export interface Stage { pr: number; title: string; files: number; certain: number; tiers: Record<Tier, number> }
/** A file more than one side changed, like one of codeSplitter's file objects: who wrote to it and how it settled. */
export interface Contested { path: string; tier: Tier; prs: number[]; main: boolean }
export interface Clash { kind: string; key: string; prs: number[]; settled: boolean }
export interface Board { stages: Stage[]; files: Contested[]; clashes: Clash[] }

const prsIn = (s: string) => [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));

/** Mervin's merge order: each stage's PR with how sure the merge is, the files that took merging, and the clashes. */
export function mervinBoard(lines: string[]): Board {
  const stages: Stage[] = [], files = new Map<string, Contested>(), clashes: Clash[] = [];
  for (const l of lines) {
    const s = l.match(/^stage \d+: #(\d+)(?: \(on #\d+\))?\s*(.*)$/);
    if (s) { stages.push({ pr: Number(s[1]), title: s[2]!, files: 0, certain: 100, tiers: { certain: 0, agree: 0, mervin: 0, differ: 0, card: 0 } }); continue; }
    const last = stages.at(-1);
    const f = l.match(/^ {2}(\d+) files, (\d+)% certain\s+(.*)$/);
    if (f && last) {
      Object.assign(last, { files: Number(f[1]), certain: Number(f[2]) });
      for (const [, t, n] of f[3]!.matchAll(/(\w+) (\d+)/g)) if (TIER.some((x) => x === t)) last.tiers[t as Tier] = Number(n);
      continue;
    }
    const row = l.match(/^ {2}(agree|mervin|differ|card)\s+(\S+)\s.*?(?:\(after ([^)]*)\))?$/);
    if (row && last) {
      const after = row[3] ?? "", was = files.get(row[2]!);
      const prs = [...new Set([...(was?.prs ?? []), ...prsIn(after), last.pr])];
      // the file's worst word wins: a card anywhere on it is a card
      const tier = was && TIER.indexOf(was.tier) > TIER.indexOf(row[1] as Tier) ? was.tier : (row[1] as Tier);
      files.set(row[2]!, { path: row[2]!, tier, prs, main: !!was?.main || after.includes("main") });
      continue;
    }
    const c = l.match(/^clash (\w+): (\S+)\s+(.*?)\s{2}(settled: .*|CARD)$/);
    if (c) clashes.push({ kind: c[1]!, key: c[2]!, prs: prsIn(c[3]!), settled: c[4] !== "CARD" });
  }
  return { stages, files: [...files.values()], clashes };
}

/**
 * The conflicts Mervin took off the agents (`prevented` of them before any branch was written): every file git would have stopped on (Mervin settled it, or carded it) and
 * every clash between PRs that merges clean as text but breaks later. `avoided` are the ones no agent had to touch.
 */
export function avoided(b: Board, prevented = 0): { avoided: number; total: number } {
  const n = (t: Tier) => b.stages.reduce((k, s) => k + s.tiers[t], 0);
  return { avoided: prevented + n("mervin") + b.clashes.filter((c) => c.settled).length, total: prevented + n("mervin") + n("card") + b.clashes.length };
}

/** `GET /__rb/codesplitter/hold`'s `prevented`: tasks Mervin held (the dispatch hint's Wait) because open branches already
 * changed their files, so the two never met at merge time. Counted as conflicts avoided. 0 when the answer isn't a count. */
export function preventedOf(body: unknown): number {
  return isObject(body) && typeof body.prevented === "number" && body.prevented > 0 ? Math.floor(body.prevented) : 0;
}

/** One row of Mervin's running tally per PR and per clash: a later run of the same PR replaces its row, so reruns don't count twice. */
export interface TallyRow { key: string; at: number; avoided: number; total: number }
export function tallyRows(b: Board, at: number): TallyRow[] {
  return [
    ...b.stages.map((s) => ({ key: `pr:${s.pr}`, at, avoided: s.tiers.mervin, total: s.tiers.mervin + s.tiers.card })),
    ...b.clashes.map((c) => ({ key: `clash:${c.kind}:${c.key}`, at, avoided: c.settled ? 1 : 0, total: 1 })),
  ];
}
export interface Tally { prs: number; avoided: number; total: number; since: number }
/** The tally file's rows summed, the latest row of each key winning. Lines that don't read as a row are skipped. */
export function tallySum(text: string): Tally | null {
  const last = new Map<string, TallyRow>();
  for (const l of text.split("\n")) {
    try {
      const r: unknown = JSON.parse(l);
      if (isObject(r) && typeof r.key === "string") last.set(r.key, { key: r.key, at: num(r.at), avoided: num(r.avoided), total: num(r.total) });
    } catch {}
  }
  if (!last.size) return null;
  const rows = [...last.values()];
  return {
    prs: rows.filter((r) => r.key.startsWith("pr:")).length,
    avoided: rows.reduce((k, r) => k + r.avoided, 0), total: rows.reduce((k, r) => k + r.total, 0),
    since: Math.min(...rows.map((r) => r.at)),
  };
}

export interface TestRun { ok: boolean; dir: string; cmd: string }

/** Ester's test runs, one per `pass`/`FAIL` line, the last word on each dir and command winning. */
export function esterRuns(lines: string[]): TestRun[] {
  const runs = new Map<string, TestRun>();
  for (const l of lines) {
    const m = l.match(/^(pass|FAIL) {2}([^:]+): (.+?)(?: {2}[\d.]+s)?$/);
    if (m) runs.set(`${m[2]}\n${m[3]}`, { ok: m[1] === "pass", dir: m[2]!, cmd: m[3]! });
  }
  return [...runs.values()];
}

export type Mode = "one" | "each";
export type Block = "wait" | "ok" | "broke";
/**
 * Ester's test stack: the PRs she tests in Mervin's order, as one run of the whole merged tree (`--check`) or a run per
 * PR stacked on the ones before it (`--check-stages`, which stops at the first PR that breaks it). Each PR's block:
 * waiting, ok, or broke (the one to hand to a fixer).
 */
export function esterStack(s: EsterState): { mode: Mode; blocks: { pr: number; state: Block }[]; broke: number[] } {
  const order = mervinBoard(s.lines).stages.map((x) => x.pr);
  const each = new Map<number, Block>();
  for (const l of s.lines) {
    const m = l.match(/^stage \d+ #(\d+): (ok|the board breaks)/);
    if (m) each.set(Number(m[1]), m[2] === "ok" ? "ok" : "broke");
  }
  const mode: Mode = each.size ? "each" : "one";
  const done = s.phase === "green" || s.phase === "red";
  const state = (pr: number): Block =>
    mode === "each" ? (each.get(pr) ?? "wait") : !done ? "wait" : s.hold.includes(pr) ? "broke" : "ok";
  const blocks = order.map((pr) => ({ pr, state: state(pr) }));
  return { mode, blocks, broke: blocks.filter((b) => b.state === "broke").map((b) => b.pr) };
}

/** The task for the cheap worker Ester hands a broken PR to: what failed, and to keep the fix to that. */
export function fixPrompt(pr: number, lines: string[]): string {
  const said = lines.filter((l) => /^FAIL |^stage \d+ #\d+: the board breaks|^ {2}(blocks|own) /.test(l) && (!/#\d/.test(l) || l.includes(`#${pr}`)));
  return [
    `Ester's board check says PR #${pr} breaks the merged tree. What she saw:`, "", ...said.slice(0, 20), "",
    `Check out its branch (gh pr checkout ${pr}), run just the failing test to see it, fix it with the smallest change, ` +
    `and push to that same branch. Don't widen the PR. If the failure isn't the PR's after all, say so on the PR and stop.`,
  ].join("\n");
}

// ---- the line: every open PR left to right, open › CI › Mervin › Ester › main -----------------------------------

export const STATIONS = ["open", "CI", "Mervin", "Ester", "main"] as const;
export interface OpenPr { number: number; title: string; url: string; draft: boolean; ci: "pass" | "fail" | "pending" | "none" }
export interface MergedPr { number: number; title: string; mergedAt: number }
/** A PR on the line: the station it has reached, and whether it is moving, sitting ready, or stuck there. */
export interface Car { pr: number; title: string; url: string; at: number; state: "moving" | "ready" | "stuck" }

const FAILED = ["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR", "ACTION_REQUIRED"];
/** `gh pr list --json number,title,url,isDraft,statusCheckRollup` as the line's open PRs. */
export function openPrs(body: unknown): OpenPr[] {
  if (!Array.isArray(body)) return [];
  return body.filter(isObject).flatMap((p) => {
    if (typeof p.number !== "number") return [];
    const checks = Array.isArray(p.statusCheckRollup) ? p.statusCheckRollup.filter(isObject) : [];
    const word = (c: Record<string, unknown>) => String(c.conclusion ?? c.state ?? "");
    const ci = checks.some((c) => FAILED.includes(word(c))) ? "fail" : !checks.length ? "none"
      : checks.some((c) => (c.status !== undefined && c.status !== "COMPLETED") || word(c) === "PENDING") ? "pending" : "pass";
    return [{ number: p.number, title: typeof p.title === "string" ? p.title : "", url: typeof p.url === "string" ? p.url : "", draft: p.isDraft === true, ci }];
  });
}
/** `gh pr list --state merged --json number,title,mergedAt`, newest first. */
export function mergedPrs(body: unknown): MergedPr[] {
  if (!Array.isArray(body)) return [];
  return body.filter(isObject).flatMap((p) => {
    const at = typeof p.mergedAt === "string" ? Date.parse(p.mergedAt) : NaN;
    return typeof p.number === "number" && Number.isFinite(at) ? [{ number: p.number, title: typeof p.title === "string" ? p.title : "", mergedAt: at }] : [];
  }).sort((a, b) => b.mergedAt - a.mergedAt);
}

/** Where each open PR is on the line: CI by its checks, then Mervin's board, then Ester's stack. The furthest station it
 * has passed wins, and a red there stops it: a failing check, a card Mervin wants answered, a block Ester saw break. */
export function line(open: OpenPr[], mervin: EsterState, ester: EsterState): Car[] {
  const board = mervinBoard(mervin.lines.length ? mervin.lines : ester.lines);
  const carded = new Set(board.stages.filter((s) => s.tiers.card).map((s) => s.pr)); // the stage whose change a card left out
  const stack = new Map(esterStack(ester).blocks.map((b) => [b.pr, b.state]));
  const ordered = new Set(board.stages.map((s) => s.pr));
  return open.map((p): Car => {
    const car = (at: number, state: Car["state"]) => ({ pr: p.number, title: p.title, url: p.url, at, state });
    if (p.draft) return car(0, "ready");
    if (p.ci === "fail") return car(1, "stuck");
    if (p.ci !== "pass") return car(0, "moving");
    if (!ordered.has(p.number)) return car(1, "ready");
    if (carded.has(p.number)) return car(2, "stuck");
    const t = stack.get(p.number);
    return t === "broke" ? car(3, "stuck") : t === "ok" ? car(3, "ready") : t === "wait" && ester.phase === "running" ? car(2, "moving") : car(2, "ready");
  });
}

// ---- small readers --------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const PHASES: EsterPhase[] = ["idle", "running", "green", "red", "error"];
const isPhase = (p: unknown): p is EsterPhase => PHASES.some((x) => x === p);
/** One helper's run from `GET /__rb/helpers` (ester/run.ts), or idle when it doesn't look like one. */
export function helperState(v: unknown): EsterState {
  if (!isObject(v) || !isPhase(v.phase)) return { phase: "idle", lines: [], hold: [] };
  const n = (x: unknown) => (typeof x === "number" ? x : undefined);
  return {
    phase: v.phase,
    lines: Array.isArray(v.lines) ? v.lines.filter((l): l is string => typeof l === "string") : [],
    hold: Array.isArray(v.hold) ? v.hold.filter((h): h is number => typeof h === "number") : [],
    startedAt: n(v.startedAt), endedAt: n(v.endedAt),
    ...(typeof v.error === "string" && { error: v.error }),
  };
}
/** Mervin's running tally from `GET /__rb/helpers`, or null while none is kept. */
export function tallyOf(v: unknown): Tally | null {
  return isObject(v) && typeof v.total === "number" ? { prs: num(v.prs), avoided: num(v.avoided), total: num(v.total), since: num(v.since) } : null;
}

/** The three slots across `left`..`right` on the wall (board-local x), each `gap` apart: centre and width of each. */
export function slots(left: number, right: number, gap: number): { x: number; width: number }[] {
  const width = (right - left - gap * (SCREENS.length - 1)) / SCREENS.length;
  return SCREENS.map((_, i) => ({ x: left + width / 2 + i * (width + gap), width }));
}

/** m:ss since `from`, up to `to` (now while it runs). */
export const clock = (from?: number, to?: number) => {
  if (!from) return "";
  const t = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
