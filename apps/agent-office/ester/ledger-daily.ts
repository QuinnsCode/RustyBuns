// The ledger every morning: at 10am, days cut 10am to 10am, so yesterday is whole. Writes the files to ~/.rustybuns/ledger,
// then has a headless Claude put them on the three pages: the weekly ledger, the 30-day dashboard, and the plan-week report
// (this plan week so far, reset Thursday morning, beside the weeks before it). Artifacts need Claude's own tools, there is no API.
// Transcripts last 30 days, so every run folds its days into history.json, which only grows: the weekly page reads all of it.
// Run: bun apps/agent-office/ester/ledger-daily.ts             (now: ledger, then publish)
//      bun apps/agent-office/ester/ledger-daily.ts --no-publish (files only)
//      bun apps/agent-office/ester/ledger-daily.ts --install    (a launchd job at 10:07 every day; --uninstall takes it off)
//      bun apps/agent-office/ester/ledger-daily.ts --budget 2026-11-05 76 [--fable 40] [--approx]
//          (the plan's weekly usage, as /usage showed it, for the plan week that resets that morning, and the Fable limit's
//          beside it; nothing on disk records them. The running week takes a reading too: it shows that, not an estimate)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, bool, num, obj, opt, str, type Of } from "@rustybuns/util/guard";
import { help } from "../../../scripts/help.ts";
import { headless, install, uninstall } from "../../../scripts/launchd.ts";
import { readSaved as readLocalSaved } from "../../../scripts/conflicts-saved.ts";

const DAY_STARTS = 10;
const WEEK = "https://claude.ai/artifact/FBNXoT3SnfvJvL8kyZPDo3"; // RustyBuns weekly ledger: last 8 days, or any recorded week, with overlays
const MONTH = "https://claude.ai/artifact/Y7fSLkHoTgLMV1i3oLNERn"; // tokens per line of code, last 30 days
const REPORT = "https://claude.ai/artifact/W383GZuNbN4X6W36QF2arT"; // this plan week so far, by day and model, beside the weeks before it
const LABEL = "com.rustybuns.ledger";
const out = path.join(homedir(), ".rustybuns", "ledger");
const repo = path.resolve(import.meta.dir, "../../..");

const n = num(0, 1e13);
const z = num(0, 1e13, 0); // a field older history has no value for
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** One day of ledger.ts's output. */
export const Row = obj({
  date: str(10, { re: DATE }), sessions: n, turns: n, units: n, input: n, output: n, cacheRead: n, cacheWrite: n,
  fights: n, episodes: n, ciReads: n, testOutput: n, oversize: n, mervin: n, ester: n, dexter: n,
  prs: n, added: n, removed: n, codeAdded: n, codeRemoved: n,
  opus: z, sonnet: z, haiku: z, fable: z, other: z, // units by model family
});
export type Row = Of<typeof Row>;
const Ledger = obj({ generated: str(40), dayStarts: num(0, 23), saves: n, settles: n, rows: arr(Row, 400), size: arr(obj({ date: str(10), code: num(-1e9, 1e9) }), 5000) });
const History = arr(Row, 20000, { drop: true });
/** The plan's weekly usage the owner read off /usage: the week that resets on the morning of `ends`, and the Fable limit's. */
export const Budget = arr(obj({ ends: str(10, { re: DATE }), pct: num(0, 200), fable: opt(num(0, 200)), approx: opt(bool()) }), 2000, { drop: true });
export type Budget = Of<typeof Budget>;

/** The budget list with one week's entry set (a second entry for the same morning replaces the first), oldest first. */
export function setBudget(list: Budget, ends: string, pct: number, approx = false, fable?: number): Budget {
  const e = Budget([{ ends, pct, ...(fable === undefined ? {} : { fable }), ...(approx ? { approx } : {}) }]);
  if (!e.length) throw new Error("--budget takes a date (YYYY-MM-DD) and a percent, 0 to 200 (--fable too)");
  return [...list.filter((b) => b.ends !== ends), ...e].sort((a, b) => a.ends.localeCompare(b.ends));
}

/** Fold a run's days into the history. A day keeps whichever count saw more turns: today grows, and the oldest day of a
 *  run thins as Claude Code deletes its transcripts, so an earlier run's fuller count stands. */
export function mergeHistory(old: Row[], fresh: Row[]): Row[] {
  const by = new Map(old.map((r) => [r.date, r]));
  for (const r of fresh) { const o = by.get(r.date); if (!o || r.turns >= o.turns) by.set(r.date, r); }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const PAGE = ["date", "sessions", "turns", "units", "output", "mervin", "ester", "dexter", "prs", "added", "removed", "codeAdded", "codeRemoved", "opus", "sonnet", "haiku", "fable", "other"] as const;
/** The weekly page with every recorded day in it (only the fields it draws); it picks the weeks itself. */
export function weekPage(template: string, ledger: { generated: string; dayStarts: number; saves: number; settles: number }, history: Row[], budget: Budget = []): string {
  const rows = history.map((r) => Object.fromEntries(PAGE.map((k) => [k, k === "date" ? r.date : Math.round(r[k])])));
  return fill(template, { generated: ledger.generated, dayStarts: ledger.dayStarts, saves: ledger.saves, settles: ledger.settles, rows, budget });
}

// A page template with `data` in its LEDGER slot, every `<` escaped so no string can close the script.
function fill(template: string, data: unknown): string {
  const at = template.indexOf("/*LEDGER*/");
  const end = template.indexOf(";\n", at);
  if (at < 0 || end < 0) throw new Error("a ledger page lost its LEDGER slot");
  return template.slice(0, at) + JSON.stringify(data).replace(/</g, "\\u003c") + template.slice(end);
}

const shift = (date: string, days: number) => { const t = new Date(`${date}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
/** The plan week resets Thursday morning: the Thursday on or before `date` (a 10am-to-10am day). */
export const weekStart = (date: string) => shift(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 3) % 7));

/** Every plan week in the history, added up, oldest first. `pct` is what /usage said (budget.json), `fablePct` the Fable
 *  limit's; the week still running is estimated from the last read week's units per 1% until it gets a reading. */
export function planWeeks(history: Row[], budget: Budget) {
  const by = new Map<string, Row[]>();
  for (const r of history) { const s = weekStart(r.date); by.set(s, [...(by.get(s) ?? []), r]); }
  const sum = (rows: Row[], k: "units" | "prs" | "codeAdded" | "codeRemoved" | "opus" | "sonnet" | "fable") => Math.round(rows.reduce((a, r) => a + r[k], 0));
  let perPct = 0;
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([start, rows], i, all) => {
    const ends = shift(start, 7), read = budget.find((b) => b.ends === ends), units = sum(rows, "units");
    const running = i === all.length - 1;
    const pct = read ? read.pct : running && perPct ? Math.round(units / perPct) : null;
    if (read?.pct) perPct = units / read.pct;
    return { start, ends, days: rows.length, units, prs: sum(rows, "prs"), code: sum(rows, "codeAdded"), cut: sum(rows, "codeRemoved"), opus: sum(rows, "opus"), sonnet: sum(rows, "sonnet"), fable: sum(rows, "fable"),
      pct, fablePct: read?.fable ?? null, approx: read?.approx ?? false, estimated: running && !read && pct !== null, running };
  });
}

/** The repo's issues as `gh issue list --json createdAt,closedAt` gives them (closedAt null while open). */
export const Issues = arr(obj({ createdAt: str(40), closedAt: opt(str(40)) }), 50000, { drop: true });
export type Issues = Of<typeof Issues>;

/** The ledger day a moment belongs to: days start at DAY_STARTS, local time. */
const dayOf = (iso: string) => {
  const t = new Date(new Date(iso).getTime() - DAY_STARTS * 3600e3);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

/** Issues opened and closed on each of `dates`, and how many stood open at the end of it: scope against work done. */
export function issueDays(issues: Issues, dates: string[]) {
  const opened = new Map<string, number>(), closed = new Map<string, number>();
  for (const i of issues) {
    const o = dayOf(i.createdAt); opened.set(o, (opened.get(o) ?? 0) + 1);
    if (i.closedAt) { const c = dayOf(i.closedAt); closed.set(c, (closed.get(c) ?? 0) + 1); }
  }
  return dates.map((date) => ({
    date, opened: opened.get(date) ?? 0, closed: closed.get(date) ?? 0,
    open: issues.filter((i) => dayOf(i.createdAt) <= date && (!i.closedAt || dayOf(i.closedAt) > date)).length,
  }));
}

/** codeSplitter's count of conflicts Mervin saved (GET /api/stats/saved): per hour and kind. */
export const RemoteSaved = obj({ saved: arr(obj({ hour: num(0, 1e14), kind: str(40), n: num(0, 1e9) }), 5000, { drop: true }) });
export const SAVED_KINDS = ["do-save", "branch-merge", "preflight", "hold"] as const;

/** Conflicts saved per ledger day and kind, from codeSplitter's hourly rows and this Mac's log (scripts/conflicts-saved.ts). */
export function savedDays(remote: { hour: number; kind: string; n: number }[], local: { at: number; kind: string; n: number }[], dates: string[]): ({ date: string } & Record<(typeof SAVED_KINDS)[number], number>)[] {
  const by = new Map<string, number>();
  for (const r of [...remote.map((r) => ({ at: r.hour, kind: r.kind, n: r.n })), ...local]) {
    const k = `${dayOf(new Date(r.at).toISOString())} ${r.kind}`;
    by.set(k, (by.get(k) ?? 0) + r.n);
  }
  const n = (date: string, kind: string) => by.get(`${date} ${kind}`) ?? 0;
  return dates.map((date) => ({ date, "do-save": n(date, "do-save"), "branch-merge": n(date, "branch-merge"), preflight: n(date, "preflight"), hold: n(date, "hold") }));
}

/** What one conflict fought by hand costs, in units: the history's conflict spend over its conflicts. */
export const conflictCost = (history: Row[]) => {
  const episodes = history.reduce((a, r) => a + r.episodes, 0);
  return episodes ? Math.round(history.reduce((a, r) => a + r.fights, 0) / episodes) : 0;
};

/** The plan-week report: this plan week's days (at least the last 8, so a Thursday isn't a page of one bar), every week,
 *  issues opened against closed over the last 30 days, and the conflicts Mervin saved, priced as fought by hand. */
export function reportPage(template: string, generated: string, history: Row[], budget: Budget, issues: Issues = [], saved: ReturnType<typeof savedDays> = []): string {
  const start = history.length ? weekStart(history.at(-1)!.date) : "";
  const days = history.filter((r, i) => r.date >= start || i >= history.length - 8);
  return fill(template, { generated, start, days, weeks: planWeeks(history, budget), issues: issueDays(issues, history.slice(-30).map((r) => r.date)), saved, conflictCost: conflictCost(history.slice(-30)) });
}

const read = <T>(name: string, g: (v: unknown) => T, none: T): T => { const f = path.join(out, name); return existsSync(f) ? g(JSON.parse(readFileSync(f, "utf8"))) : none; };
const readHistory = () => read("history.json", History, []);
const readBudget = () => read("budget.json", Budget, []);
const readIssues = () => read("issues.json", Issues, []);
const readRemoteSaved = () => read("saved.json", RemoteSaved, { saved: [] }).saved;
const CODESPLITTER = process.env.CODESPLITTER_URL ?? "https://codesplitter.notryanquinn.workers.dev";

/** week.html and report.html from what is on disk: the last run's header, the history and the budget entries. */
function page(ledger: Of<typeof Ledger>, history: Row[]) {
  const budget = readBudget(), template = (name: string) => readFileSync(path.join(import.meta.dir, name), "utf8");
  writeFileSync(path.join(out, "week.html"), weekPage(template("ledger-week.html"), ledger, history, budget));
  writeFileSync(path.join(out, "report.html"), reportPage(template("ledger-report.html"), ledger.generated, history, budget, readIssues(),
    savedDays(readRemoteSaved(), readLocalSaved(), history.slice(-30).map((r) => r.date))));
}

async function build() {
  mkdirSync(out, { recursive: true });
  Bun.spawnSync(["git", "fetch", "-q", "origin", "main"], { cwd: repo });
  const run = Bun.spawnSync(["bun", "apps/agent-office/ester/ledger.ts", "32", "--day-starts", String(DAY_STARTS)], { cwd: repo, stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`ledger.ts exited ${run.exitCode}`);
  const text = run.stdout.toString();
  const ledger = Ledger(JSON.parse(text));
  writeFileSync(path.join(out, "ledger.json"), text);
  writeFileSync(path.join(out, "daily.json"), JSON.stringify(ledger.rows));
  writeFileSync(path.join(out, "size.json"), JSON.stringify(ledger.size));
  const gh = Bun.spawnSync(["gh", "issue", "list", "--state", "all", "--limit", "50000", "--json", "createdAt,closedAt"], { cwd: repo, stderr: "inherit" });
  if (gh.exitCode === 0) writeFileSync(path.join(out, "issues.json"), gh.stdout.toString()); // offline, the last run's issues stand
  // codeSplitter's conflicts saved (DO saves, branch merges); before its deploy the route is a 404 and the last copy stands.
  const saved = await fetch(`${CODESPLITTER}/api/stats/saved?days=32`, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  if (saved) writeFileSync(path.join(out, "saved.json"), JSON.stringify(RemoteSaved(JSON.parse(saved))));
  const history = mergeHistory(readHistory(), ledger.rows);
  writeFileSync(path.join(out, "history.json"), JSON.stringify(history));
  page(ledger, history);
  const last = ledger.rows.at(-2);
  console.log(`${ledger.generated} ledger written to ${out}; yesterday (${last?.date ?? "none"}, ${DAY_STARTS}am to ${DAY_STARTS}am) is the second-to-last row`);
}

const prompt = () => `Refresh three of my Artifacts from files on disk. Do only this, then reply in one line.
1. Weekly ledger ${WEEK}: Artifact read it, then Artifact publish with url ${WEEK} and file_path ${path.join(out, "week.html")}.
2. Dashboard ${MONTH}: Artifact read it. Upload ${path.join(out, "daily.json")} and then ${path.join(out, "size.json")}, each with Artifact publish, url ${MONTH}, asset: true (one file per call).
   ArtifactData get datasets/daily and datasets/size, then one ArtifactData batch of two updates pinned to the versions you read:
   source: {kind: "file", url: <that upload's url as returned>, name: <daily.json or size.json>}, updated: {at: <now, UTC ISO>, by: "ledger-daily.ts on the office Mac"}, edit: {via: "claude", at: <now>}.
   Then ArtifactData get collection data/users/me doc check; if it says checking, read it again (5 reads at most).
3. Plan-week report ${REPORT}: Artifact read it, then Artifact publish with url ${REPORT} and file_path ${path.join(out, "report.html")}.
Change nothing else on any page. Reply: "ledger published" plus the check status, or what failed.`;

const publish = () => headless(prompt(), "Artifact ArtifactData ToolSearch", repo, out);

const job = { label: LABEL, script: import.meta.path, cwd: repo, when: [{ Hour: DAY_STARTS, Minute: 7 }], log: path.join(out, "daily.log") };

if (import.meta.main) {
  help(import.meta.path);
  const a = process.argv.slice(2);
  if (a.includes("--install")) console.log(install(job) ? `installed: ${LABEL} runs ${repo} at ${DAY_STARTS}:07 daily, log ${job.log}` : "launchctl bootstrap failed");
  else if (a.includes("--uninstall")) { uninstall(LABEL); console.log("uninstalled"); }
  else if (a.includes("--budget")) {
    const i = a.indexOf("--budget");
    const fi = a.indexOf("--fable");
    const list = setBudget(readBudget(), a[i + 1] ?? "", Number(a[i + 2]), a.includes("--approx"), fi < 0 ? undefined : Number(a[fi + 1]));
    writeFileSync(path.join(out, "budget.json"), JSON.stringify(list));
    page(Ledger(JSON.parse(readFileSync(path.join(out, "ledger.json"), "utf8"))), readHistory());
    console.log(`budget: ${list.map((b) => `${b.ends} ${b.pct}%${b.approx ? "~" : ""}${b.fable === undefined ? "" : ` (Fable ${b.fable}%)`}`).join(", ")}`);
    if (!a.includes("--no-publish")) publish();
  } else { await build(); if (!a.includes("--no-publish")) publish(); }
}
