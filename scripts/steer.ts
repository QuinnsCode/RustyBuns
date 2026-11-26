// A quick first call on a new task, before a worker is hired for it (#5844, step 1): where it lives, what kind of job
// it is, how risky its like have been, and the past tasks that say so. Advice only: the owner overrules it.
//
//   bun run steer 5844               an issue
//   bun run steer --text "..."       a task's own words ("issue #N" in them pulls that issue's body in, as task-specs does)
//   bun run steer --eval             hold out the last 2 weeks of PRs and score the guesses against what happened
//   bun run steer --sync             refresh the saved history now (a call does it itself when it is 6 hours old)
//
// History lives in one SQLite file, ~/.rustybuns/steer.sqlite: every PR (title, body, state), every issue, the squash
// commits' files on main, and each worker session's task and steer count from Claude Code's transcripts (which last
// about 30 days, so the table keeps what they lose). Similar tasks are BM25 over those words; files come from what the
// nearest tasks changed plus a graph of files that change together (scripts/steer-score.ts). Each guess goes on a line
// of ~/.rustybuns/steer.jsonl, and a later sync writes beside it what the issue's PR did: training rows for step 2.
// No daemon, no model, no cloud call except `gh` and git; nothing written leaves this Mac. Open PRs are kept 15 minutes;
// they are listed beside the risk, not counted in it (main.ts files always have one).
import { Database } from "bun:sqlite";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, int, nul, obj, opt, str, type Of } from "../packages/util/src/guard.ts";
import { taskFiles } from "../packages/util/src/overlap.ts";
import { help } from "./help.ts";
import { OpenPr, overlaps } from "./preflight.ts";
import { appOf, bm25, bm25Index, coChange, guessApp, kind, rankFiles } from "./steer-score.ts";
import { readSession } from "./task-specs.ts";

const HOME = path.join(homedir(), ".rustybuns");
const DB_FILE = path.join(HOME, "steer.sqlite"), LOG = path.join(HOME, "steer.jsonl");
const HOUR = 36e5, DAY = 864e5;

const Pr = obj({ number: int(1, 1e7), title: str(1000, { min: 0 }), body: opt(str(1e6, { min: 0 })), state: str(20), createdAt: str(40), mergedAt: nul(str(40)), headRefName: str(300) });
const Issue = obj({ number: int(1, 1e7), title: str(1000, { min: 0 }), body: opt(str(1e6, { min: 0 })) });

function gh(args: string[]): unknown {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${p.stderr.toString().trim()}`);
  return JSON.parse(p.stdout.toString());
}
const git = (args: string[]) => Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" }).stdout.toString();

/** The issues a PR body or a task points at: "Closes #N", "Part of #N", "issue #N". */
export const linked = (text: string) => [...new Set([...text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part of|for|issue)\s+#(\d+)/gi)].map((m) => Number(m[1])))];

export function open(): Database {
  mkdirSync(HOME, { recursive: true });
  const db = new Database(DB_FILE);
  db.run("PRAGMA journal_mode = WAL");
  db.run(`CREATE TABLE IF NOT EXISTS prs (number INTEGER PRIMARY KEY, title TEXT, body TEXT, state TEXT, created INTEGER, merged INTEGER, branch TEXT, links TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS issues (number INTEGER PRIMARY KEY, title TEXT, body TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS commits (pr INTEGER PRIMARY KEY, at INTEGER, files TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, mtime INTEGER, start INTEGER, end INTEGER, branch TEXT, task TEXT, steers INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  if (!db.query<{ name: string }, []>("PRAGMA table_info(prs)").all().some((c) => c.name === "links")) db.run("ALTER TABLE prs ADD COLUMN links TEXT");
  return db;
}
const getMeta = (db: Database, k: string) => db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(k)?.value;
const setMeta = (db: Database, k: string, v: string) => db.run("INSERT OR REPLACE INTO meta VALUES (?, ?)", [k, v]);

/** Every source into the table: main's squash commits, PRs and issues changed since the last sync, new transcripts. */
function sync(db: Database, say = (s: string) => console.error(s)) {
  const last = Number(getMeta(db, "synced") ?? 0), now = Date.now();
  say(last ? "steer: syncing what changed since the last sync" : "steer: first sync, every PR and issue (a minute or so)");
  git(["fetch", "-q", "origin", "main"]);
  const putCommit = db.prepare("INSERT OR REPLACE INTO commits VALUES (?, ?, ?)");
  db.transaction(() => {
    for (const c of git(["log", "origin/main", "--name-only", "--format=@@%ct %s"]).split("@@").slice(1)) {
      const [head = "", ...files] = c.split("\n");
      const pr = Number(head.match(/\(#(\d+)\)\s*$/)?.[1]);
      if (pr) putCommit.run(pr, Number(head.split(" ")[0]) * 1000, JSON.stringify(files.filter(Boolean)));
    }
  })();
  const since = last ? ["--search", `updated:>=${new Date(last - DAY).toISOString().slice(0, 10)}`] : [];
  const prs = arr(Pr, 20000, { drop: true })(gh(["pr", "list", "--state", "all", "--limit", last ? "2000" : "9000", ...since, "--json", "number,title,body,state,createdAt,mergedAt,headRefName"]));
  const issues = arr(Issue, 20000, { drop: true })(gh(["issue", "list", "--state", "all", "--limit", last ? "2000" : "9000", ...since, "--json", "number,title,body"]));
  const putPr = db.prepare("INSERT OR REPLACE INTO prs VALUES (?, ?, ?, ?, ?, ?, ?, ?)"), putIssue = db.prepare("INSERT OR REPLACE INTO issues VALUES (?, ?, ?)");
  db.transaction(() => {
    for (const p of prs) putPr.run(p.number, p.title, p.body ?? "", p.state, Date.parse(p.createdAt), p.mergedAt ? Date.parse(p.mergedAt) : null, p.headRefName, linked(p.body ?? "").join(","));
    for (const i of issues) putIssue.run(i.number, i.title, i.body ?? "");
    const fix = db.prepare("UPDATE prs SET links = ? WHERE number = ?");
    for (const p of db.query<{ number: number; body: string }, []>("SELECT number, body FROM prs WHERE links IS NULL").all()) fix.run(linked(p.body).join(","), p.number);
  })();
  const root = path.join(homedir(), ".claude/projects"), seen = new Map(db.query<{ id: string; mtime: number }, []>("SELECT id, mtime FROM sessions").all().map((r) => [r.id, r.mtime]));
  const putSession = db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)");
  let read = 0;
  for (const d of existsSync(root) ? readdirSync(root).filter((d) => d.includes("RustyBuns") && d.includes("worktrees")) : []) {
    for (const f of readdirSync(path.join(root, d)).filter((f) => f.endsWith(".jsonl"))) {
      const file = path.join(root, d, f), mtime = Math.floor(statSync(file).mtimeMs);
      if (seen.get(f) === mtime) continue;
      const s = readSession(readFileSync(file, "utf8").split("\n"));
      if (s) { putSession.run(f, mtime, s.start, s.end, s.branch, s.task.slice(0, 20000), s.steers); read++; }
    }
  }
  openPrs(db, true);
  setMeta(db, "synced", String(now));
  const filled = fillOutcomes(db);
  say(`steer: ${prs.length} PRs, ${issues.length} issues, ${read} sessions read${filled ? `, ${filled} logged guesses given their outcome` : ""}`);
}

function openPrs(db: Database, fresh = false): OpenPr[] {
  const at = Number(getMeta(db, "open-at") ?? 0);
  if (fresh || Date.now() - at > 15 * 6e4) {
    try { setMeta(db, "open", JSON.stringify(gh(["pr", "list", "--state", "open", "--limit", "300", "--json", "number,title,headRefName,headRefOid,files"]))); setMeta(db, "open-at", String(Date.now())); } catch { /* offline: keep the last list */ }
  }
  return arr(OpenPr, 1000, { drop: true })(JSON.parse(getMeta(db, "open") ?? "[]"));
}

/** One past task: a PR (merged or closed) or a session that never opened one. `text` is what BM25 reads; its first
 *  `ask` characters are what was asked (the session's task, or the issues the PR names), the query `--eval` replays. */
export interface Doc { pr?: number; title: string; text: string; ask: number; files: string[]; app: string; created: number; merged: boolean; steers?: number }

/** The history as tasks to search: each PR with the issues it names and the session that made it, then the sessions that made none. */
export function load(db: Database): Doc[] {
  const issues = new Map(db.query<{ number: number; title: string; body: string }, []>("SELECT number, title, substr(body, 1, 1200) AS body FROM issues").all().map((i) => [i.number, `${i.title}\n${i.body}`]));
  const files = new Map(db.query<{ pr: number; files: string }, []>("SELECT pr, files FROM commits").all().map((c) => [c.pr, c.files]));
  const sessions = db.query<{ start: number; end: number; branch: string; task: string; steers: number }, []>("SELECT start, end, branch, substr(task, 1, 1500) AS task, steers FROM sessions").all();
  const prs = db.query<{ number: number; title: string; body: string; created: number; merged: number | null; branch: string; links: string | null }, []>(
    "SELECT number, title, substr(body, 1, 600) AS body, created, merged, branch, links FROM prs WHERE state != 'OPEN'").all();
  const byBranch = new Map<string, typeof prs>();
  for (const p of prs) byBranch.set(p.branch, [...byBranch.get(p.branch) ?? [], p]);
  const sessionOf = new Map<number, (typeof sessions)[number]>(), lone: typeof sessions = [];
  for (const s of sessions) {
    const mine = (byBranch.get(s.branch) ?? []).filter((p) => p.created >= s.start - 6e4 && p.created <= s.end + DAY);
    for (const p of mine) if (!sessionOf.has(p.number) || sessionOf.get(p.number)!.start < s.start) sessionOf.set(p.number, s);
    if (!mine.length) lone.push(s);
  }
  const named = (ns: number[]) => ns.map((n) => issues.get(n)).filter((i) => i !== undefined).join("\n");
  const asked = (s: (typeof sessions)[number]) => `${s.task}\n${named(linked(s.task.slice(0, 300)))}`;
  const docs: Doc[] = prs.map((p) => {
    const s = sessionOf.get(p.number), f: string[] = JSON.parse(files.get(p.number) ?? "[]");
    const ask = s ? asked(s) : named((p.links ?? "").split(",").filter(Boolean).map(Number));
    return { pr: p.number, title: p.title, text: `${ask}\n${p.title}\n${p.body}`, ask: ask.trim() ? ask.length : 0, files: f, app: appOf(f), created: p.created, merged: p.merged !== null, steers: s?.steers };
  });
  for (const s of lone) {
    const ask = asked(s);
    docs.push({ title: (s.task.trim().split("\n")[0] ?? "").slice(0, 120), text: ask, ask: ask.length, files: [], app: "", created: s.start, merged: false, steers: s.steers });
  }
  return docs;
}

export function areas(): string[] {
  const dirs = (d: string) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
  return [...dirs("apps").filter((a) => a !== "frameworks"), ...dirs("apps/frameworks"), ...dirs("packages").map((p) => `packages/${p}`)];
}

export interface Call { app: string; files: string[]; kind: string; level: string; merged: number; known: number; steers: number | null; risky: boolean; near: { doc: Doc; score: number }[] }

/** The call on one task's words against a history: nearest tasks, area, files, kind and their record. */
export function steer(text: string, docs: Doc[], graph: ReturnType<typeof coChange>, apps: string[], paths: string[], keep?: (f: string) => boolean, ix = bm25Index(docs.map((d) => d.text)), find = (t: string) => bm25(ix, t, 10)): Call {
  const near = find(text).map((h) => ({ doc: docs[h.doc]!, score: h.score }));
  const app = guessApp(text, near.map((n) => ({ app: n.doc.app, weight: n.score })), apps);
  const files = rankFiles(taskFiles(text, paths), near.map((n) => ({ files: n.doc.files, weight: n.doc.app === app ? n.score * 3 : n.score })), graph, keep);
  const five = near.slice(0, 5), withRun = five.filter((n) => n.doc.steers !== undefined);
  const merged = five.filter((n) => n.doc.merged).length;
  const steers = withRun.length ? withRun.reduce((a, n) => a + n.doc.steers!, 0) / withRun.length : null;
  const k = kind(text);
  return { app, files, ...k, merged, known: five.length, steers, near: five, risky: k.kind.startsWith("too thin") || (five.length >= 3 && merged / five.length < 0.6) || (steers ?? 0) >= 2 };
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

export type Finder = (past: Doc[], ix: ReturnType<typeof bm25Index>) => (text: string) => { doc: number; score: number }[];

export function evaluate(docs: Doc[], days = 14, finder?: Finder, label = "") {
  const cut = Date.now() - days * DAY;
  const past = docs.filter((d) => d.created < cut), held = docs.filter((d) => d.created >= cut && d.pr && d.ask);
  const graph = coChange(past.map((d) => d.files)), ix = bm25Index(past.map((d) => d.text)), apps = areas(), find = finder?.(past, ix);
  let app = 0, appN = 0, file = 0, steered = 0, caught = 0, flagged = 0, flaggedRight = 0, runs = 0;
  for (const h of held) {
    const c = steer(h.text.slice(0, h.ask), past, graph, apps, [], undefined, ix, find);
    if (h.merged && h.files.length) {
      appN++;
      if (c.app === h.app) app++;
      if (c.files.some((f) => h.files.includes(f))) file++;
    }
    if (h.steers === undefined) continue;
    runs++;
    if (h.steers >= 3) { steered++; if (c.risky) caught++; }
    if (c.risky) { flagged++; if (h.steers >= 3) flaggedRight++; }
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
  console.log([`steer --eval${label}: the last ${days} days held out, ${past.length} older tasks to learn from`,
    `  right app in the top 1        ${pct(app, appN)} (${app} of ${appN} merged PRs)`,
    `  a touched file in the top 5   ${pct(file, appN)} (${file} of ${appN})`,
    `  risky vs steered 3+ times     caught ${caught} of ${steered} such runs; ${flaggedRight} of ${flagged} flagged runs were (${runs} runs with a session)`].join("\n"));
}

/** Fill in what happened to each logged guess on an issue: the first PR naming it, merged or not, and whether the guess hit. */
function fillOutcomes(db: Database): number {
  if (!existsSync(LOG)) return 0;
  const prs = db.query<{ number: number; body: string; created: number; merged: number | null }, []>("SELECT number, body, created, merged FROM prs").all();
  const files = new Map(db.query<{ pr: number; files: string }, []>("SELECT pr, files FROM commits").all().map((c) => [c.pr, c.files]));
  const Row = obj({ at: int(0, 1e14), issue: opt(int(1, 1e7)), app: str(200, { min: 0 }), files: arr(str(500), 20), outcome: opt(obj({ pr: int(1, 1e7) })) });
  let n = 0;
  const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => {
    let r: Of<typeof Row>;
    try { r = Row(JSON.parse(l)); } catch { return l; }
    if (r.outcome || !r.issue) return l;
    const p = prs.filter((p) => p.created >= r.at && linked(p.body).includes(r.issue!)).sort((a, b) => a.created - b.created)[0];
    if (!p) return l;
    const f: string[] = JSON.parse(files.get(p.number) ?? "[]");
    n++;
    return JSON.stringify({ ...JSON.parse(l), outcome: { pr: p.number, merged: p.merged !== null, app: appOf(f), fileHit: r.files.some((x) => f.includes(x)) } });
  });
  writeFileSync(LOG, lines.join("\n") + "\n");
  return n;
}

if (import.meta.main) {
  help(import.meta.path);
  const argv = process.argv.slice(2), flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const db = open();
  if (argv.includes("--sync") || Date.now() - Number(getMeta(db, "synced") ?? 0) > 6 * HOUR) sync(db);
  if (argv.includes("--sync")) process.exit(0);
  const docs = load(db);
  if (argv.includes("--eval")) { evaluate(docs, Number(flag("--days") ?? 14)); process.exit(0); }
  const n = Number(argv.find((a) => /^#?\d+$/.test(a))?.replace("#", ""));
  let text = flag("--text") ?? "", title = short(text.trim().split("\n")[0] ?? "", 80);
  if (n) {
    const row = db.query<{ title: string; body: string }, [number]>("SELECT title, body FROM issues WHERE number = ?").get(n) ?? Issue(gh(["issue", "view", String(n), "--json", "number,title,body"]));
    text = `${row.title}\n${row.body ?? ""}`;
    title = `#${n} ${short(row.title, 80)}`;
  } else {
    for (const i of linked(text.slice(0, 300))) { const r = db.query<{ title: string; body: string }, [number]>("SELECT title, body FROM issues WHERE number = ?").get(i); if (r) text += `\n${r.title}\n${r.body}`; }
  }
  if (!text.trim()) { console.error("usage: bun run steer <issue#> | --text \"...\" | --eval | --sync"); process.exit(1); }
  const paths = git(["ls-files"]).split("\n").filter(Boolean), here = new Set(paths);
  const c = steer(text, docs, coChange(db.query<{ files: string }, []>("SELECT files FROM commits ORDER BY at DESC LIMIT 4000").all().map((r) => JSON.parse(r.files))), areas(), paths, (f) => here.has(f));
  const busy = overlaps(c.files, openPrs(db)).clash;
  const risky = c.risky;
  console.log([`steer ${title}`,
    `Where: ${c.app || "?"}  ${c.files.join("  ") || "(no files: nothing like it changed files before)"}`,
    `Kind:  ${c.kind} (${c.level})`,
    `Risk:  ${risky ? "RISKY" : "steady"}: similar tasks merged ${c.merged} of ${c.known}${c.steers === null ? "" : `, ${c.steers.toFixed(1)} steers a run`}` +
      (busy.length ? `; open PRs on these files: ${busy.slice(0, 4).map((b) => `#${b.pr} (${b.files.join(", ")})`).join(", ")}` : ""),
    "Why:", ...c.near.map((x) => `  ${x.doc.pr ? `#${x.doc.pr}` : "no PR"} ${x.doc.pr ? (x.doc.merged ? "merged" : "closed") : ""}${x.doc.steers === undefined ? "" : `, ${x.doc.steers} steers`}  ${short(x.doc.title, 90)}`)].join("\n"));
  appendFileSync(LOG, JSON.stringify({ at: Date.now(), issue: n || undefined, app: c.app, files: c.files, kind: c.kind, level: c.level, risky, near: c.near.map((x) => x.doc.pr ?? null) }) + "\n");
}
