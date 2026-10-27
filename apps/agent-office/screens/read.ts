// What the wall screens (screens/index.ts) draw, read out of what the helpers print and codeSplitter answers. Pure, so
// it is tested without a page: Mervin's board (`stage 2: #12 title` then `  9 files, 88% certain ...`, `clash ...`),
// Ester's check (`pass  apps/x: bun test  3.1s`, `FAIL ...`), and gitpath's commits. Where the three screens sit is
// here too: fixed slots, so turning one off leaves the others where they were.

import type { EsterPhase, EsterState } from "../ester/run.ts";

export type Screen = "gitpath" | "mervin" | "ester";
export const SCREENS: Screen[] = ["gitpath", "mervin", "ester"];

export interface Stage { pr: number; title: string; files: number; certain: number }
export interface Board { stages: Stage[]; clashes: number; cards: number }

/** Mervin's merge order: each stage's PR with how sure the merge is, and how many clashes still want a card. */
export function mervinBoard(lines: string[]): Board {
  const stages: Stage[] = [];
  let clashes = 0, cards = 0;
  for (const l of lines) {
    const s = l.match(/^stage \d+: #(\d+)(?: \(on #\d+\))?\s*(.*)$/);
    if (s) { stages.push({ pr: Number(s[1]), title: s[2]!, files: 0, certain: 100 }); continue; }
    const f = l.match(/^ {2}(\d+) files, (\d+)% certain/);
    const last = stages.at(-1);
    if (f && last) Object.assign(last, { files: Number(f[1]), certain: Number(f[2]) });
    if (l.startsWith("clash ")) { clashes++; if (l.trimEnd().endsWith("CARD")) cards++; }
  }
  return { stages, clashes, cards };
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

export interface PathCommit { hash: string; subject: string; added: number; removed: number; joins: boolean }
export interface FilePath { path: string; commits: PathCommit[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One file's history from `GET /api/repos/:o/:r/gitpath?path=`, oldest first; a commit with two parents in it is a join. */
export function filePath(body: unknown): FilePath | null {
  if (!isObject(body) || typeof body.path !== "string" || !Array.isArray(body.commits)) return null;
  const commits = body.commits.filter(isObject).map((c) => ({
    hash: typeof c.hash === "string" ? c.hash : "",
    subject: typeof c.subject === "string" ? c.subject : "",
    added: num(c.added), removed: num(c.removed),
    joins: Array.isArray(c.parents) && c.parents.length > 1,
  }));
  return { path: body.path, commits: commits.reverse() };
}

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

/** The busiest files from `GET /api/repos/:o/:r/gitpath`, busiest first. */
export function busiest(body: unknown): string[] {
  if (!isObject(body) || !Array.isArray(body.files)) return [];
  return body.files.filter(isObject).flatMap((f) => (typeof f.path === "string" ? [f.path] : []));
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
