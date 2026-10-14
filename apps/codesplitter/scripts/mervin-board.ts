// Mervin on the open PR board: merge every open PR onto main in a sandbox, one stage per PR, and say how sure
// each file is. Then, once the PRs have merged for real, score the sandbox against what landed.
//
//   bun scripts/mervin-board.ts [1468 1478 ...] [--out dir] [--from prs.json] [--check] [--check-stages] [--json]
//   bun scripts/mervin-board.ts --score <dir> [--main origin/main]
//
// With no PR numbers it takes every open PR (`gh pr list`, read only), oldest first, a stacked PR right after
// the PR it's built on. Each stage merges one PR's files onto the tree the stages before it left, and files
// each one in a tier:
//
//   certain   nothing to merge: no one else changed the file since the PR's base (or it already reads as the PR
//             wrote it), so the result is the PR's own copy. 100% for that file's text: no merge logic ran. It says
//             nothing about the files around it (two PRs adding migrations with one stamp are both certain).
//   agree     git and Mervin both merge it clean, to the same text.
//   mervin    git conflicts, Mervin settles it: the stretch that needs the build and tests (--check) to trust.
//   differ    both merge clean, to different text (Mervin's is kept): look at it.
//   card      Mervin asks (a conflict, a guard, a lockfile, a binary): the PR's change to this file isn't in
//             the tree, so the stage is partial.
//
// `--check` builds the final tree like CI: bun install, `bun run typecheck`, and the touched apps' tests, in a
// throwaway HOME with none of this shell's env (shadow.ts's sandbox). When something fails, main's tree runs the
// same way, and only the failures the board adds count. Each stage also shows the PR's own CI: a PR red on its own
// explains failures the merge didn't cause.
//
// `certain` is about one file's text. Clashes that span files get their own list (`clashes`): migrations with
// one stamp (two PRs, or a PR and main), two PRs adding the same export to a file, two PRs adding the same
// route. They merge clean as text and break at build or run time, so the board names them.
//
// `--check-stages` is `--check` once per stage (opt-in: one install per stage): the tree after stage 1, after
// stage 2 and so on, so a failure the board adds points at the first stage that caused it.
//
// Safe to swarm: it only reads git (show, diff, merge-base, archive) and `gh pr list`. It never writes a ref,
// never pushes, never touches a worktree; everything goes to its own fresh temp folder (or --out, which must
// not exist yet), so any number of agents can run it at once.
//
// `--score` is the answer to "was the merge right?": after the real merge round (PRs, CI, squash), each file
// the sandbox wrote is compared with main's copy: exact, close (same lines in another order, or bar
// indentation), wrong (a silent bad merge: make it a fixture in test/conflicts.test.ts), asked (Mervin carded
// it; what the person landed is the answer to learn from). Files a commit outside the board touched since
// are `moved` and files of PRs that haven't landed are `waiting`; neither is scored.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sandbox, shadow, testRuns, testTree, writeTree } from "./shadow.ts";

export type Tier = "certain" | "agree" | "mervin" | "differ" | "card";
export const TIERS: Tier[] = ["certain", "agree", "mervin", "differ", "card"];

export interface BoardPr {
  number: number; title?: string; headRefOid: string; headRefName?: string; baseRefName?: string;
  statusCheckRollup?: { name?: string; conclusion?: string | null; status?: string }[];
}
/** The PR's own CI: red on its own means a failure in the merged tree may be the PR's, not the merge's. */
export type Ci = "pass" | "fail" | "pending" | "none";
export function ciOf(pr: BoardPr): { ci: Ci; failing: string[] } {
  const checks = pr.statusCheckRollup ?? [];
  const failing = checks.filter((c) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ERROR"].includes(c.conclusion ?? "")).map((c) => c.name ?? "?");
  const ci: Ci = failing.length ? "fail" : !checks.length ? "none" : checks.some((c) => c.status && c.status !== "COMPLETED") ? "pending" : "pass";
  return { ci, failing };
}
/** `main` is true when the PR conflicts with main's own copy of the file, whatever earlier stages did. */
export interface FileRow { path: string; tier: Tier; why: string; after: number[]; main?: true }
export interface Stage { pr: number; title?: string; head: string; base: string; stackedOn?: number; ci?: Ci; failing?: string[]; files: FileRow[] }
/** A clash between files (or PRs) that merges clean as text: `prs` lists the PRs, `main` is true when main holds one side. */
export interface Clash { kind: "migration" | "export" | "route"; key: string; prs: number[]; main?: boolean }
export interface Board { main: string; at: string; stages: Stage[]; written: string[]; skipped: { pr: number; why: string }[]; clashes: Clash[] }

const BUF = 64 << 20;
const gitIn = (repo: string | undefined) => (...a: string[]) => {
  const r = Bun.spawnSync(["git", ...a], { cwd: repo, stderr: "pipe", maxBuffer: BUF });
  return r.exitCode === 0 ? r.stdout.toString() : null;
};

const stampOf = (path: string) => (/(^|\/)migrations\//.test(path) ? path.match(/(?:^|\/)(\d+)_[^/]*$/)?.[1] : undefined);
const DECL = /^\+\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+(\w+)/;
const ROUTE = /^\+.*\b(?:path|pathname)\s*===?\s*"(\/[^"]*)"/;

/** What a PR adds that another PR (or main) may add too: new migration stamps, exports per file, routes. */
export function claims(git: ReturnType<typeof gitIn>, base: string, head: string, main: string): Clash[] {
  const out: Clash[] = [];
  const dir = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
  for (const line of (git("diff", "--name-status", "--no-renames", base, head) ?? "").split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t") as [string, string];
    const stamp = status === "A" ? stampOf(path) : undefined;
    if (stamp) {
      // main already has a different file under that stamp (the same file is the same migration)
      const there = (git("ls-tree", "--name-only", main, dir(path) || ".") ?? "").split("\n").filter((f) => f !== path && stampOf(f) === stamp);
      out.push({ kind: "migration", key: `${dir(path)}${stamp}`, prs: [], ...(there.length && { main: true }) });
    }
    if (status === "D" || !/\.[cm]?[jt]sx?$/.test(path)) continue;
    for (const l of (git("diff", "-U0", "--no-renames", base, head, "--", path) ?? "").split("\n")) {
      const name = l.match(DECL)?.[1], route = l.match(ROUTE)?.[1];
      if (name) out.push({ kind: "export", key: `${path} ${name}`, prs: [] });
      if (route) out.push({ kind: "route", key: route, prs: [] });
    }
  }
  return out;
}

/** The claims every stage made, folded to the ones two PRs made, or one PR made against main. */
export function clashes(perStage: { pr: number; claims: Clash[] }[]): Clash[] {
  const by = new Map<string, Clash>();
  for (const { pr, claims } of perStage) for (const c of claims) {
    const id = `${c.kind} ${c.key}`;
    const e = by.get(id) ?? { kind: c.kind, key: c.key, prs: [] };
    if (!e.prs.includes(pr)) e.prs.push(pr);
    if (c.main) e.main = true;
    by.set(id, e);
  }
  return [...by.values()].filter((c) => c.prs.length > 1 || c.main);
}

/** Oldest first, each stacked PR moved to just after the PR it's built on (when that's on the board too). */
export function order(prs: BoardPr[], given?: number[]): BoardPr[] {
  const list = given ? given.map((n) => prs.find((p) => p.number === n)).filter((p): p is BoardPr => !!p) : [...prs].sort((a, b) => a.number - b.number);
  if (given) return list;
  const byHead = new Map(list.map((p) => [p.headRefName, p]));
  const out: BoardPr[] = [], seen = new Set<number>();
  const visit = (p: BoardPr) => {
    if (seen.has(p.number)) return;
    seen.add(p.number);
    const parent = p.baseRefName ? byHead.get(p.baseRefName) : undefined;
    if (parent) visit(parent);
    out.push(p);
  };
  list.forEach(visit);
  return out;
}

/**
 * Runs the board onto `main` in `repo` and returns the stages and the final tree's changed files (path to text,
 * null for deleted). Reads git only.
 */
export function run(repo: string | undefined, main: string, prs: BoardPr[]): { board: Board; tree: Map<string, string | null>; writes: Map<string, string | null>[] } {
  const git = gitIn(repo);
  const show = (rev: string, path: string) => git("show", `${rev}:${path}`);
  const attributes = show(main, ".gitattributes") ?? "";
  const tree = new Map<string, string | null>();
  const touched = new Map<string, number[]>();
  const now = (path: string) => (tree.has(path) ? tree.get(path)! : show(main, path));
  const board: Board = { main, at: new Date().toISOString(), stages: [], written: [], skipped: [], clashes: [] };
  const writes: Map<string, string | null>[] = []; // per stage: what it wrote into the tree
  const perStage: { pr: number; claims: Clash[] }[] = [];
  const done = new Map<string, string>(); // a landed stage's branch name, to its head

  for (const pr of prs) {
    if (git("cat-file", "-e", `${pr.headRefOid}^{commit}`) === null) { board.skipped.push({ pr: pr.number, why: "head not in this clone: git fetch origin" }); continue; }
    // A stacked PR merges from the PR it's built on, which is already in the tree.
    const parent = pr.baseRefName && done.get(pr.baseRefName);
    const base = git("merge-base", parent || main, pr.headRefOid)?.trim();
    if (!base) { board.skipped.push({ pr: pr.number, why: "no merge base with main" }); continue; }
    const stage: Stage = { pr: pr.number, title: pr.title, head: pr.headRefOid, base, ...(pr.statusCheckRollup && ciOf(pr)), files: [] };
    if (parent) stage.stackedOn = board.stages.find((s) => s.head === parent)?.pr;
    perStage.push({ pr: pr.number, claims: claims(git, base, pr.headRefOid, main) });
    const mine = new Map<string, string | null>();
    const diff = (git("diff", "--name-status", "--no-renames", base, pr.headRefOid) ?? "").split("\n").filter(Boolean);
    for (const line of diff) {
      const [status, path] = line.split("\t") as [string, string];
      const b = show(base, path), br = status === "D" ? null : show(pr.headRefOid, path), cur = now(path);
      const after = touched.get(path) ?? [];
      // Does the PR clash with main's copy alone? (GitHub's CONFLICTING, not only a clash with earlier stages.)
      const mainTxt = show(main, path);
      const clashMain = () => mainTxt !== b && mainTxt !== br && (mainTxt === null || br === null || [b ?? "", mainTxt, br].some((t) => t.includes("\0")) || !shadow(path, b ?? "", mainTxt, br, attributes).git.clean);
      const row = (tier: Tier, why: string) => stage.files.push({ path, tier, why, after: [...after], ...((tier === "card" || tier === "mervin") && clashMain() && { main: true as const }) });
      if (cur === br) row("certain", "already reads as this PR wrote it");
      else if (cur === b) { tree.set(path, br); mine.set(path, br); row("certain", br === null ? "deleted, untouched since the base" : "untouched since the base: the PR's copy"); }
      else if (br === null || cur === null) row("card", br === null ? "deleted here, changed on main" : "changed here, deleted on main");
      else if ([b ?? "", cur, br].some((t) => t.includes("\0"))) row("card", "binary, both changed");
      else {
        const s = shadow(path, b ?? "", cur, br, attributes);
        if (!s.ours.clean) row("card", s.ours.conflicts.map((c) => c.lint ?? (c.whole ? "lockfile" : `line ${c.line}`)).slice(0, 3).join(", "));
        else {
          tree.set(path, s.ours.text); mine.set(path, s.ours.text);
          if (!s.git.clean) row("mervin", "git conflicts, Mervin settles");
          else if (s.git.text === s.ours.text) row("agree", "git and Mervin agree");
          else row("differ", "both clean, different text: Mervin's kept");
        }
      }
      if (stage.files.at(-1)!.tier !== "card") touched.set(path, [...after, pr.number]);
    }
    board.stages.push(stage);
    writes.push(mine);
    if (pr.headRefName) done.set(pr.headRefName, pr.headRefOid);
  }
  board.written = [...tree.keys()].sort();
  board.clashes = clashes(perStage);
  return { board, tree, writes };
}

/** Writes one file of a stage into a checked-out tree (null deletes it). */
function applyFile(root: string, path: string, text: string | null) {
  const file = join(root, path);
  if (text === null) rmSync(file, { force: true });
  else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
}

export const count = (rows: FileRow[]) => Object.fromEntries(TIERS.map((t) => [t, rows.filter((r) => r.tier === t).length])) as Record<Tier, number>;

/** One stage as lines: the tally, then every file that isn't certain. */
export function describe(s: Stage): string[] {
  const c = count(s.files);
  const sure = s.files.length ? Math.round((100 * c.certain) / s.files.length) : 100;
  const head = `#${s.pr}${s.stackedOn ? ` (on #${s.stackedOn})` : ""} ${s.title ?? ""}`.trimEnd();
  const ci = s.ci ? `   own CI ${s.ci}${s.failing?.length ? ` (${s.failing.join(", ")})` : ""}` : "";
  const out = [head, `  ${s.files.length} files, ${sure}% certain   ${TIERS.map((t) => `${t} ${c[t]}`).join("  ")}${ci}`];
  for (const f of s.files) if (f.tier !== "certain") out.push(`  ${f.tier.padEnd(7)} ${f.path}  ${f.why}${f.main ? "  (conflicts with main)" : ""}${f.after.length ? `  (after ${f.after.map((n) => `#${n}`).join(", ")})` : ""}`);
  return out;
}

export type Score = "exact" | "close" | "wrong" | "asked" | "moved" | "waiting";
const unindented = (t: string) => t.split("\n").map((l) => l.trim()).join("\n");
const sorted = (t: string) => t.split("\n").sort().join("\n");

/** Each board file against `now` (main after the real merges). */
export function score(repo: string | undefined, board: Board, treeDir: string, now: string) {
  const git = gitIn(repo);
  const log = (git("log", "--format=%H%x09%s", `${board.main}..${now}`) ?? "").split("\n").filter(Boolean);
  const onBoard = new Set(board.stages.map((s) => s.pr));
  const landed = new Set<number>(), moved = new Set<string>();
  for (const l of log) {
    const [sha, subject = ""] = l.split("\t");
    const pr = Number([...subject.matchAll(/\(#(\d+)\)/g)].at(-1)?.[1]);
    if (onBoard.has(pr)) { landed.add(pr); continue; }
    for (const p of (git("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", sha!) ?? "").split("\n").filter(Boolean)) moved.add(p);
  }
  const rows: { path: string; score: Score; tiers: Tier[] }[] = [];
  const byPath = new Map<string, { prs: number[]; tiers: Tier[] }>();
  for (const s of board.stages) for (const f of s.files) {
    const e = byPath.get(f.path) ?? { prs: [], tiers: [] };
    e.prs.push(s.pr); e.tiers.push(f.tier); byPath.set(f.path, e);
  }
  for (const [path, { prs, tiers }] of [...byPath].sort()) {
    const push = (score: Score) => rows.push({ path, score, tiers });
    if (moved.has(path)) { push("moved"); continue; }
    if (prs.some((p) => !landed.has(p))) { push("waiting"); continue; }
    if (tiers.includes("card")) { push("asked"); continue; }
    const file = join(treeDir, path);
    const ours = existsSync(file) ? readFileSync(file, "utf8") : null;
    const real = git("show", `${now}:${path}`);
    if (ours === real) push("exact");
    else if (ours !== null && real !== null && (sorted(ours) === sorted(real) || unindented(ours) === unindented(real))) push("close");
    else push("wrong");
  }
  return { landed: [...landed].sort(), rows };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const top = gitIn(undefined)("rev-parse", "--show-toplevel")!.trim();

  const scoring = arg("score");
  if (scoring) {
    const dir = resolve(scoring);
    const board: Board = JSON.parse(readFileSync(join(dir, "board.json"), "utf8"));
    const now = gitIn(top)("rev-parse", arg("main") ?? "origin/main")!.trim();
    const { landed, rows } = score(top, board, join(dir, "tree"), now);
    const tally = (k: Score) => rows.filter((r) => r.score === k).length;
    console.log(`sandbox from ${board.main.slice(0, 9)} vs main ${now.slice(0, 9)}: ${landed.length} of ${board.stages.length} PRs landed`);
    for (const k of ["exact", "close", "wrong", "asked", "moved", "waiting"] as Score[]) console.log(`  ${k.padEnd(7)} ${String(tally(k)).padStart(4)}`);
    for (const r of rows.filter((r) => r.score === "wrong" || r.score === "close")) console.log(`  ${r.score.padEnd(7)} ${r.path}  (${r.tiers.join(" > ")})`);
    // The tiers' track record: how often a file Mervin was sure of landed exactly.
    for (const t of TIERS) {
      const rs = rows.filter((r) => r.tiers.at(-1) === t && ["exact", "close", "wrong"].includes(r.score));
      if (rs.length) console.log(`  ${t.padEnd(7)} landed exact ${rs.filter((r) => r.score === "exact").length} of ${rs.length}`);
    }
    process.exit(tally("wrong") ? 1 : 0);
  }

  const given = args.filter((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")).map(Number);
  const from = arg("from");
  const prs: BoardPr[] = JSON.parse(from ? readFileSync(from, "utf8")
    : Bun.spawnSync(["gh", "pr", "list", "--state", "open", "--limit", "200", "--json", "number,title,headRefOid,headRefName,baseRefName,statusCheckRollup"], { cwd: top }).stdout.toString() || "[]");
  const main = gitIn(top)("rev-parse", arg("main") ?? "origin/main")!.trim();
  const out = arg("out") ? resolve(arg("out")!) : mkdtempSync(join(tmpdir(), "mervin-board-"));
  if (arg("out")) { if (existsSync(out)) throw new Error(`${out} exists: pick a new folder`); mkdirSync(out, { recursive: true }); }

  const { board, tree, writes } = run(top, main, order(prs, given.length ? given : undefined));
  writeTree(join(out, "tree"), main);
  for (const [path, t] of tree) applyFile(join(out, "tree"), path, t);
  writeFileSync(join(out, "board.json"), JSON.stringify(board, null, 2));

  if (args.includes("--json")) console.log(JSON.stringify(board, null, 2));
  else {
    console.log(`Mervin's board: ${board.stages.length} PRs onto main ${main.slice(0, 9)}\n`);
    board.stages.forEach((s, i) => console.log([`stage ${i + 1}: ${describe(s)[0]}`, ...describe(s).slice(1)].join("\n") + "\n"));
    for (const c of board.clashes) console.log(`clash ${c.kind}: ${c.key}  ${c.prs.map((n) => `#${n}`).join(" + ")}${c.main ? " + main" : ""}`);
    for (const s of board.skipped) console.log(`skipped #${s.pr}: ${s.why}`);
    const all = count(board.stages.flatMap((s) => s.files));
    const n = board.stages.reduce((k, s) => k + s.files.length, 0);
    console.log(`all stages: ${n} file merges, ${TIERS.map((t) => `${t} ${all[t]}`).join("  ")}`);
    console.log(`certain ${n ? Math.round((100 * all.certain) / n) : 100}%, needs proof (agree + mervin + differ) ${all.agree + all.mervin + all.differ}, cards ${all.card}`);
    console.log(`\ntree and board.json in ${out}\nafter the real merges: bun scripts/mervin-board.ts --score ${out}`);
  }

  if (args.includes("--check-stages")) {
    const tmp = mkdtempSync(join(tmpdir(), "mervin-board-home-"));
    try {
      const env = sandbox(join(tmp, "home"));
      mkdirSync(env.HOME);
      const dir = join(out, "stages");
      writeTree(join(out, "main"), main);
      const runsFor = (paths: string[]) => [{ dir: ".", cmd: "bun run typecheck" }, ...testRuns(readFileSync(join(out, "tree/scripts/ci-apps.ts"), "utf8"), paths)];
      const before = new Set<string>();
      writeTree(dir, main);
      let broke = false;
      for (const [i, s] of board.stages.entries()) {
        for (const [path, t] of writes[i]!) applyFile(dir, path, t);
        const runs = runsFor([...writes[i]!.keys()]);
        const r = await testTree(dir, runs, env);
        // main's own failures for these runs, once per run set
        const base = r.failed.length ? (await testTree(join(out, "main"), runs, env)).failed : [];
        base.forEach((f) => before.add(f));
        const added = r.failed.filter((f) => !before.has(f));
        console.log(`stage ${i + 1} #${s.pr}: ${added.length ? `the board breaks ${added.join(", ")}` : "ok"}`);
        if (added.length) { console.log(r.log); broke = true; break; }
      }
      if (broke) process.exit(1);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }

  if (args.includes("--check")) {
    const tmp = mkdtempSync(join(tmpdir(), "mervin-board-home-"));
    try {
      const env = sandbox(join(tmp, "home"));
      mkdirSync(env.HOME);
      const runs = [{ dir: ".", cmd: "bun run typecheck" }, ...testRuns(readFileSync(join(out, "tree/scripts/ci-apps.ts"), "utf8"), board.written)];
      const r = await testTree(join(out, "tree"), runs, env);
      for (const x of r.runs) console.log(`${x.ok ? "pass" : "FAIL"}  ${x.dir}: ${x.cmd}`);
      if (r.failed.length) {
        // The sandbox fails some tests on main too (no claude CLI, no native build): only what the board adds counts.
        writeTree(join(out, "main"), main);
        const before = new Set((await testTree(join(out, "main"), runs, env)).failed);
        const added = r.failed.filter((f) => !before.has(f));
        console.log(`\n${r.failed.length - added.length} fail on main in this sandbox too (not the board)`);
        const red = board.stages.filter((s) => s.ci === "fail").map((s) => `#${s.pr} (${s.failing!.join(", ")})`);
        if (red.length) console.log(`already red on their own, so look at them before blaming the merge: ${red.join("; ")}`);
        if (added.length) { console.log(`the board breaks:\n  ${added.join("\n  ")}\n\n${r.log}`); process.exit(1); }
        console.log("the board adds no failures");
      }
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
}
