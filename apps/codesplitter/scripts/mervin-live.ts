// Mervin's live board (#1524): keep codeSplitter's board (GET /api/repos/:o/:r/board) up to date, so nobody reruns
// scripts/mervin-board.ts by hand to find out where a round stands.
//
//   CODESPLITTER_TOKEN=... bun scripts/mervin-live.ts --url https://codesplitter.example --repo owner/name \
//     [--every 30] [--once] [--dry] [--main origin/main] [--workers workers.json]
//
// Every `--every` seconds (30 by default, so a push shows within a minute) it reads the open PRs (`gh pr list`, read
// only) and the Agent Office workers (`office-workers list --json`, or --workers for a file of the same), and when
// a PR's head or main moved it stages the board again (mervin-board.ts, git reads only) and posts the rows that
// changed. A PR that merged is dropped, and the board it was staged on is scored against what landed (`--score`),
// so the tiers' hit rates build up with no one asking. --once does one pass; --dry prints the rows instead of posting.
// The token is the crew's (a personal API token); it is read from the environment and never printed.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { order, run, score, TIERS, type Board, type BoardPr, type Stage } from "./mervin-board.ts";
import { writeTree } from "./shadow.ts";
import { roundOf, type BoardRow, type Hits, type Round } from "../src/board.ts";

const MANIFESTS = /^(package\.json|bun\.lock)$/;
const appOf = (path: string) => path.match(/^apps\/([^/]+)\//)?.[1];
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
export function rowOf(s: Stage, board: Board, owners: Map<number, string>, blast?: BoardRow["blast"]): BoardRow {
  const c = Object.fromEntries(TIERS.map((t) => [t, s.files.filter((f) => f.tier === t).length]));
  return {
    pr: s.pr, head: s.head, ci: s.ci ?? "none", tiers: c, files: s.files.length,
    clashes: board.clashes.filter((x) => x.prs.includes(s.pr)).map((x) => ({ kind: x.kind, key: x.key, with: x.prs.filter((n) => n !== s.pr), ...(x.main && { main: true }) })),
    ...(s.title && { title: s.title }), ...(s.failing?.length && { failing: s.failing }),
    ...(s.stackedOn && { stackedOn: s.stackedOn }), ...(owners.has(s.pr) && { owner: owners.get(s.pr) }), ...(blast && { blast }),
  };
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

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const sh = (cmd: string[], cwd?: string) => { const r = Bun.spawnSync(cmd, { cwd, stderr: "pipe", maxBuffer: 64 << 20 }); return r.exitCode === 0 ? r.stdout.toString() : null; };
  const top = sh(["git", "rev-parse", "--show-toplevel"])!.trim();
  const url = arg("url")?.replace(/\/$/, ""), repo = arg("repo"), token = process.env.CODESPLITTER_TOKEN;
  const dry = args.includes("--dry");
  // Off unless the repo says so (#1521): `--record` keeps each scored round on the server, no flag keeps none.
  const record = args.includes("--record");
  if (!dry && (!url || !repo || !token)) { console.error("need --url, --repo owner/name and CODESPLITTER_TOKEN (or --dry)"); process.exit(2); }
  const every = Number(arg("every") ?? 30) * 1000;
  const mainRef = arg("main") ?? "origin/main";
  const post = async (body: unknown) => {
    const r = await fetch(`${url}/api/repos/${repo}/board`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`board POST ${r.status}: ${(await r.text()).slice(0, 200)}`);
  };

  let seen = "", kept: Board | null = null, keptDir = "", posted = new Map<number, string>();
  const hits: Hits = {};
  const pass = async () => {
    sh(["git", "fetch", "origin", "main", "--quiet"], top);
    const prs: BoardPr[] = JSON.parse(sh(["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefOid,headRefName,baseRefName,statusCheckRollup"], top) || "[]");
    for (const p of prs) if (sh(["git", "cat-file", "-e", `${p.headRefOid}^{commit}`], top) === null) sh(["git", "fetch", "origin", `pull/${p.number}/head`, "--quiet"], top);
    const main = sh(["git", "rev-parse", mainRef], top)!.trim();
    const fp = main + prs.map((p) => `${p.number}:${p.headRefOid}:${p.statusCheckRollup?.map((c) => c.conclusion ?? c.status).join(",") ?? ""}`).join(";");
    if (fp === seen) return;
    seen = fp;

    // The PRs that landed since the last board: score it against main now, then stage again.
    let scored = false, round: Round | null = null;
    if (kept && kept.main !== main && kept.stages.some((s) => !prs.some((p) => p.number === s.pr))) {
      const r = score(top, kept, join(keptDir, "tree"), main);
      if (r.landed.length) { addHits(hits, r.rows); scored = true; round = roundOf(r.landed, r.rows); }
    }
    const workers = arg("workers") ? JSON.parse(await Bun.file(arg("workers")!).text()) : JSON.parse(sh(["office-workers", "list", "--json"]) || "[]");
    const owners = ownersOf(workers);
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
    const reaches = new Map(board.stages.map((s) => [s.pr, reach(s.files.map((f) => f.path), apps, uses)]));
    const rows = board.stages.map((s) => {
      const r = reaches.get(s.pr)!;
      const blast = r.blast ? { apps: r.blast, prs: board.stages.filter((o) => o.pr !== s.pr && reaches.get(o.pr)!.own.some((a) => r.blast!.includes(a))).map((o) => o.pr) } : undefined;
      return rowOf(s, board, owners, blast);
    });
    const changed = rows.filter((r) => posted.get(r.pr) !== JSON.stringify(r));
    const drop = [...posted.keys()].filter((n) => !rows.some((r) => r.pr === n));
    if (dry) console.log(JSON.stringify({ main, prs: changed, drop, hits, ...(round && record && { round }) }, null, 2));
    else if (changed.length || drop.length || scored) await post({ main, prs: changed, drop, ...(!kept && { replace: true }), ...(scored && { hits }), ...(record && { record: true, ...(round && { round }) }) });
    posted = new Map(rows.map((r) => [r.pr, JSON.stringify(r)]));
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
