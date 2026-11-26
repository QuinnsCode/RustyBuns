// Mervin's live board (#1524): keep codeSplitter's board (GET /api/repos/:o/:r/board) up to date, so nobody reruns
// scripts/mervin-board.ts by hand to find out where a round stands.
//
//   CODESPLITTER_TOKEN=... bun scripts/mervin-live.ts --url https://codesplitter.example --repo owner/name \
//     [--every 30] [--once] [--dry] [--main origin/main] [--workers workers.json] [--record [--fixtures dir]]
//
// Every `--every` seconds (30 by default, so a push shows within a minute) it reads the open PRs (`gh pr list`, read
// only) and the Agent Office workers (`office-workers list --json`, or --workers for a file of the same), and when
// a PR's head or main moved it stages the board again (mervin-board.ts, git reads only) and posts the rows that
// changed. A PR that merged is dropped, and the board it was staged on is scored against what landed (`--score`),
// so the tiers' hit rates build up with no one asking. Each PR's red checks carry Ester's verdict, sorted against
// main's own run of the same check (`gh api .../check-runs`, read only). --once does one pass; --dry prints the rows instead of posting.
// With --record each scored round is kept on the server (CI time per landed PR, needless holds, the wrong files),
// and each wrong file is written here as a fixture for test/conflicts.test.ts (--fixtures, by default
// apps/codesplitter/test/fixtures/wrongs): file text stays on this machine, only paths are posted.
// The token is the crew's (a personal API token); it is read from the environment and never printed.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { order, run, score, TIERS, type Board, type BoardPr, BoardPrs, type Stage } from "./mervin-board.ts";
import { noCi, runsOn, STALL_AFTER, stallOf, view, type Pr, type Runs } from "../../../scripts/pr.ts";
import { writeTree } from "./shadow.ts";
import { needless, roundOf, type BoardRow, type EsterVerdict, type Hits, type Round } from "../src/board.ts";
import { sortRed } from "../src/ester-sort.ts";
import { arr, check, nul, obj, opt, str } from "@rustybuns/util/guard";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const MANIFESTS = /^(package\.json|bun\.lock)$/;
const appOf = (path: string) => path.match(/^apps\/(?:frameworks\/)?([^/]+)\//)?.[1]; // the framework samples sit a level down
const pkgOf = (path: string) => path.match(/^packages\/([^/]+)\//)?.[1];

/** The apps a PR's files reach: its own app folders, every app for a root manifest or lockfile, and the apps that use a package it touches (`uses`: package folder to apps). */
export function reach(files: string[], apps: string[], uses: Record<string, string[]>): { own: string[]; blast: string[] | null } {
  const own = [...new Set(files.map(appOf).filter((a): a is string => !!a))].sort();
  const wide = files.some((f) => MANIFESTS.test(f) || pkgOf(f));
  if (!wide) return { own, blast: null };
  const blast = files.some((f) => MANIFESTS.test(f)) ? apps : [...new Set(files.flatMap((f) => uses[pkgOf(f) ?? ""] ?? []))];
  return { own, blast: [...new Set([...blast, ...own])].sort() };
}

/** One stage as the board's row. `owners` maps a PR number to the worker that owns it. */
export function rowOf(s: Stage, board: Board, owners: Map<number, string>, blast?: BoardRow["blast"], stall?: string, main = new Map<string, MainCheck>()): BoardRow {
  const ester = esterOf(s, main);
  const c = Object.fromEntries(TIERS.map((t) => [t, s.files.filter((f) => f.tier === t).length]));
  return {
    pr: s.pr, head: s.head, ci: s.ci ?? "none", tiers: c, files: s.files.length,
    clashes: board.clashes.filter((x) => x.prs.includes(s.pr)).map((x) => ({ kind: x.kind, key: x.key, with: x.prs.filter((n) => n !== s.pr), ...(x.main && { main: true }) })),
    ...(s.title && { title: s.title }), ...(s.failing?.length && { failing: s.failing }), ...(ester.length && { ester }),
    ...(s.stackedOn && { stackedOn: s.stackedOn }), ...(owners.has(s.pr) && { owner: owners.get(s.pr) }), ...(blast && { blast }), ...(stall && { stall }),
  };
}

/** How the board looks closer at a PR: its head's commit time (git, local), its full view and its head's Actions runs (gh). */
export interface StallDeps { headAt: (sha: string) => number | null; view: (n: number) => Promise<Pr>; runs: (sha: string) => Promise<Runs> }

/** The PRs whose head has gone STALL_AFTER seconds with no typecheck or apps check (#5838): the board's line for each,
 *  and the owners to tell, once per head (`known` keeps each marked "pr:head" and its line across passes, so a head is
 *  looked at closer once). Only a PR with no CI check whose head is old enough is looked at, so a pass costs no gh calls
 *  when every head has its checks. */
export async function stalls(prs: BoardPr[], owners: Map<number, string>, known: Map<string, string>, deps: StallDeps, now = Date.now()) {
  const marks = new Map<number, string>(), tell: { name: string; pr: number; line: string }[] = [];
  for (const p of prs) {
    const at = noCi(p.statusCheckRollup ?? []) ? deps.headAt(p.headRefOid) : null;
    if (at === null || now - at < STALL_AFTER * 1000) continue;
    const key = `${p.number}:${p.headRefOid}`;
    if (known.has(key)) { marks.set(p.number, known.get(key)!); continue; }
    const pr = await deps.view(p.number).catch(() => null);
    const line = pr && pr.headRefOid === p.headRefOid ? stallOf(pr, now, await deps.runs(p.headRefOid)) : null;
    if (!line) continue;
    known.set(key, line); marks.set(p.number, line);
    const name = owners.get(p.number);
    if (name) tell.push({ name, pr: p.number, line });
  }
  return { marks, tell };
}

/** What the worker is told about its PR's stalled head. */
export const stallPrompt = (pr: number, line: string) => `Mervin's board: PR #${pr}'s head has had no typecheck or apps check for ${STALL_AFTER / 60} minutes: ${line}. Fix it on your own branch (bun run pr ${pr} --no-wait says more).`;

/** Main's check runs at one commit as `gh api repos/{owner}/{repo}/commits/<sha>/check-runs` writes them. */
export const MainChecks = obj({ check_runs: arr(obj({ name: str(1000), status: opt(str(100, { min: 0 })), conclusion: opt(nul(str(100, { min: 0 }))) }), 1000, { drop: true }) });
export type MainCheck = "fail" | "running" | "pass";

/** Each check's state on main, by name: red, still running, or green. */
export function mainChecksOf(x: unknown): Map<string, MainCheck> {
  const out = new Map<string, MainCheck>();
  for (const c of check(MainChecks, x)?.check_runs ?? []) {
    out.set(c.name, c.status && c.status !== "completed" ? "running" : ["failure", "timed_out", "cancelled"].includes(c.conclusion ?? "") ? "fail" : "pass");
  }
  return out;
}

/** Ester's verdict on each of a PR's own red checks (#5784): main's when main fails it too, wait while main's run of it is going, else the PR's own. */
export function esterOf(s: Pick<Stage, "pr" | "failing">, main: Map<string, MainCheck>): EsterVerdict[] {
  return (s.failing ?? []).slice(0, 20).map((name) => {
    const v = sortRed(name, { onMain: main.get(name) === "fail", mainRunning: main.get(name) === "running", suspects: [s.pr], red: [s.pr], redWhy: name, pending: [] });
    return { test: v.test, owner: v.owner, why: v.why, ...(v.prs.length && { prs: v.prs }) };
  });
}

/** PR number to worker, from `office-workers list --json` (any array of {name, pr}, the pr a number or a URL). */
export function ownersOf(workers: unknown): Map<number, string> {
  const out = new Map<number, string>();
  const list = Array.isArray(workers) ? workers : (workers as { workers?: unknown } | null)?.workers;
  if (!Array.isArray(list)) return out;
  for (const w of list as { name?: unknown; pr?: unknown }[]) {
    const pr = typeof w.pr === "number" ? w.pr : Number(String(w.pr ?? "").match(/(\d+)\/?$/)?.[1]);
    if (pr && typeof w.name === "string") out.set(pr, w.name);
  }
  return out;
}

/** The tiers' track record from a scored board, added to what's kept. */
export function addHits(into: Hits, rows: ReturnType<typeof score>["rows"]): Hits {
  for (const t of TIERS) {
    const rs = rows.filter((r) => r.tiers.at(-1) === t && ["exact", "close", "wrong"].includes(r.score));
    if (!rs.length) continue;
    const h = (into[t] ??= { exact: 0, of: 0 });
    h.exact += rs.filter((r) => r.score === "exact").length;
    h.of += rs.length;
  }
  return into;
}

/** A wrong file as a test/conflicts.test.ts fixture: main's text the board was staged on, each landed PR's text, what landed. */
export interface Wrong { path: string; tiers: string[]; base: string; sides: { pr: number; text: string }[]; real: string; sandbox: string | null }

/** The fixture for one wrong file, or null when a side added or deleted it (the lines merge has no base to work from). */
export function wrongOf(path: string, tiers: string[], show: (rev: string) => string | null, board: Board, now: string, sandbox: string | null): Wrong | null {
  const base = show(board.main), real = show(now);
  const sides = board.stages.filter((s) => s.files.some((f) => f.path === path)).map((s) => ({ pr: s.pr, text: show(s.head) }));
  if (base === null || real === null || sides.some((s) => s.text === null)) return null;
  return { path, tiers, base, sides: sides.map((s) => ({ pr: s.pr, text: s.text! })), real, sandbox };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const sh = (cmd: string[], cwd?: string) => { const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe", maxBuffer: 64 << 20 }); return r.exitCode === 0 ? r.stdout.toString() : null; };
  const top = sh(["git", "rev-parse", "--show-toplevel"])!.trim();
  const url = arg("url")?.replace(/\/$/, ""), repo = arg("repo"), token = process.env.CODESPLITTER_TOKEN;
  const dry = args.includes("--dry");
  // Off unless the repo says so (#1521): `--record` keeps each scored round on the server, no flag keeps none.
  const record = args.includes("--record");
  const fixtures = arg("fixtures") ?? "apps/codesplitter/test/fixtures/wrongs";
  if (!dry && (!url || !repo || !token)) { console.error("need --url, --repo owner/name and CODESPLITTER_TOKEN (or --dry)"); process.exit(2); }
  const every = Number(arg("every") ?? 30) * 1000;
  const mainRef = arg("main") ?? "origin/main";
  const post = async (body: unknown) => {
    const r = await fetch(`${url}/api/repos/${repo}/board`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`board POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  };

  let seen = "", kept: Board | null = null, keptRows: BoardRow[] = [], keptDir = "", posted = new Map<number, string>();
  const hits: Hits = {};
  const stalled = new Map<string, string>(); // "pr:head" marked for missing checks, its worker told once (#5838)
  const pass = async () => {
    sh(["git", "fetch", "origin", "main", "--quiet"], top);
    const prs = BoardPrs(JSON.parse(sh(["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefOid,headRefName,baseRefName,statusCheckRollup"], top) || "[]"));
    for (const p of prs) if (sh(["git", "cat-file", "-e", `${p.headRefOid}^{commit}`], top) === null) sh(["git", "fetch", "origin", `pull/${p.number}/head`, "--quiet"], top);
    const main = sh(["git", "rev-parse", mainRef], top)!.trim();
    const workers = arg("workers") ? JSON.parse(await Bun.file(arg("workers")!).text()) : JSON.parse(sh(["office-workers", "list", "--json"]) || "[]");
    const owners = ownersOf(workers);
    const headAt = (sha: string) => { const t = Date.parse(sh(["git", "log", "-1", "--format=%cI", sha], top)?.trim() ?? ""); return Number.isNaN(t) ? null : t; };
    const { marks, tell } = await stalls(prs, owners, stalled, { headAt, view, runs: runsOn });
    for (const t of tell) {
      if (dry) console.log(`would tell ${t.name}: ${stallPrompt(t.pr, t.line)}`);
      else if (sh(["office-workers", "tell", t.name, "--prompt", stallPrompt(t.pr, t.line)]) === null) console.error(`could not tell ${t.name} about #${t.pr}`);
    }
    const fp = [...marks.keys()].join(",") + main + prs.map((p) => `${p.number}:${p.headRefOid}:${p.statusCheckRollup?.map((c) => c.conclusion ?? c.status).join(",") ?? ""}`).join(";");
    if (fp === seen) return;
    seen = fp;

    // The PRs that landed since the last board: score it against main now, then stage again.
    let scored = false, round: Round | null = null;
    if (kept && kept.main !== main && kept.stages.some((s) => !prs.some((p) => p.number === s.pr))) {
      const r = score(top, kept, join(keptDir, "tree"), main);
      if (r.landed.length) {
        addHits(hits, r.rows); scored = true;
        const landed = kept.stages.filter((s) => r.landed.includes(s.pr));
        round = roundOf(r.landed, r.rows, {
          ci: landed.filter((s) => s.ciSecs).map((s) => ({ pr: s.pr, secs: s.ciSecs! })),
          needless: needless(r.landed, keptRows, new Map(landed.map((s) => [s.pr, s.files.map((f) => f.path)])), r.rows),
        });
        if (record) for (const w of round.wrongs) {
          const sandbox = join(keptDir, "tree", w.path);
          const fx = wrongOf(w.path, w.tiers, (rev) => sh(["git", "show", `${rev}:${w.path}`], top), kept, main, (() => { try { return readFileSync(sandbox, "utf8"); } catch { return null; } })());
          if (!fx) continue;
          const file = join(top, fixtures, `${main.slice(0, 9)}-${w.path.replace(/[^a-z0-9]+/gi, "-").slice(-80)}.json`);
          mkdirSync(join(file, ".."), { recursive: true });
          writeFileSync(file, JSON.stringify(fx, null, 2) + "\n");
          console.log(`wrong ${w.path}: fixture ${file}`);
        }
      }
    }
    const { board, tree } = run(top, main, order(prs));

    const apps = (sh(["git", "ls-tree", "--name-only", main, "apps/"], top) ?? "").split("\n").filter(Boolean).map((a) => a.replace(/^apps\//, ""));
    const names = new Map<string, string>(); // package folder to its name
    for (const d of (sh(["git", "ls-tree", "--name-only", main, "packages/"], top) ?? "").split("\n").filter(Boolean)) {
      const name = JSON.parse(sh(["git", "show", `${main}:${d}/package.json`], top) || "{}").name;
      if (name) names.set(d.replace(/^packages\//, ""), name);
    }
    const uses: Record<string, string[]> = {};
    for (const a of apps) {
      const pj = JSON.parse(sh(["git", "show", `${main}:apps/${a}/package.json`], top) || "{}");
      const deps = Object.keys({ ...pj.dependencies, ...pj.devDependencies });
      for (const [d, n] of names) if (deps.includes(n)) (uses[d] ??= []).push(a);
    }
    // Ester sorts each red check against main's own run of it (read only; none when no PR is red).
    const mainChecks = board.stages.some((s) => s.failing?.length)
      ? mainChecksOf(JSON.parse(sh(["gh", "api", `repos/{owner}/{repo}/commits/${main}/check-runs?per_page=100`], top) || "{}")) : new Map<string, MainCheck>();
    const reaches = new Map(board.stages.map((s) => [s.pr, reach(s.files.map((f) => f.path), apps, uses)]));
    const rows = board.stages.map((s) => {
      const r = reaches.get(s.pr)!;
      const blast = r.blast ? { apps: r.blast, prs: board.stages.filter((o) => o.pr !== s.pr && reaches.get(o.pr)!.own.some((a) => r.blast!.includes(a))).map((o) => o.pr) } : undefined;
      return rowOf(s, board, owners, blast, marks.get(s.pr), mainChecks);
    });
    const changed = rows.filter((r) => posted.get(r.pr) !== JSON.stringify(r));
    const drop = [...posted.keys()].filter((n) => !rows.some((r) => r.pr === n));
    if (dry) console.log(JSON.stringify({ main, prs: changed, drop, hits, ...(round && record && { round }) }, null, 2));
    else if (changed.length || drop.length || scored) await post({ main, prs: changed, drop, ...(!kept && { replace: true }), ...(scored && { hits }), ...(record && { record: true, ...(round && { round }) }) });
    posted = new Map(rows.map((r) => [r.pr, JSON.stringify(r)]));
    keptRows = rows;
    console.log(`${new Date().toISOString()} board: ${rows.length} PRs, ${changed.length} changed, ${drop.length} dropped${scored ? ", scored the last board" : ""}`);

    // Keep this board's tree for its own scoring once its PRs land.
    if (keptDir) rmSync(keptDir, { recursive: true, force: true });
    keptDir = mkdtempSync(join(tmpdir(), "mervin-live-"));
    writeTree(join(keptDir, "tree"), main);
    for (const [path, t] of tree) { const f = join(keptDir, "tree", path); if (t === null) rmSync(f, { force: true }); else { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, t); } }
    kept = board;
  };

  try {
    do {
      await pass().catch((e) => console.error(`pass failed: ${(e as Error).message}`));
      if (args.includes("--once")) break;
      await Bun.sleep(every);
    } while (true);
  } finally { if (keptDir) rmSync(keptDir, { recursive: true, force: true }); }
}
