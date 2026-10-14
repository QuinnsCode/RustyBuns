// Borg agents: pretend to be a team. One real commit from any repo's history is split across N agents
// who write it into one file at the same time, through the file Durable Object, the way agents.ts does.
//
//   bun scripts/borg-agents.ts <repo> [commit ...] [--agents 4] [--contest 0.3] [--seed 1] [--json]
//
// With no commit it takes the repo's last 20 non-merge commits. For each file the commit changed:
//   1. the file's parent copy is seeded as the base doc;
//   2. diffToOps turns parent -> commit into line ops, grouped into units that must travel together
//      (one change per line; a run of new lines after one anchor);
//   3. the units are dealt to the agents, which all fire at once, re-reading and retrying on a 409;
//   4. with --contest, that share of the rewritten lines is ALSO rewritten by a second agent to different
//      text: two agents on the same line, the fight the engine exists for.
//
// A run passes when the file ends as the commit wrote it (uncontested), or, for a contested line, as exactly
// one of the texts offered: no lost update, no line doubled, no agent left hanging. Nothing leaves the
// machine: the local twins, no GitHub, no Cloudflare.
import { text, type Doc, type Op } from "../src/lines.ts";
import { diffToOps } from "../src/sync.ts";
import { local, type Call } from "../src/local.ts";

const git = (repo: string, ...a: string[]) => {
  const r = Bun.spawnSync(["git", "-C", repo, ...a], { stderr: "pipe", maxBuffer: 64 << 20 });
  return r.exitCode === 0 ? r.stdout.toString() : null;
};

/** Seeded, so a failing run replays. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** A unit of work: ops that only make sense together. */
export type Unit = Op[];

/** Group diff ops so no unit splits a run of inserts after one anchor (they were emitted last-first to land in order). */
export function units(ops: Op[]): Unit[] {
  const out: Unit[] = [];
  for (const op of ops) {
    const last = out.at(-1);
    if (op.kind === "insert" && last && last[0]!.kind === "insert" && (last[0] as { after: string | null }).after === op.after) last.push(op);
    else out.push([op]);
  }
  return out;
}

export interface AgentStat { name: string; units: number; conflicts: number; yielded: number }
export interface FileRun {
  path: string; agents: number; units: number; contested: number; conflicts: number; yielded: number;
  /** "exact": the file is the commit's. "settled": every difference is a contested line holding one offered text. */
  verdict: "exact" | "settled" | "lost" | "stuck"; detail: string[]; stats: AgentStat[]; ms: number;
}

/**
 * Write `target` over `base` with `agents` concurrent agents and report how it came out.
 * `contest` is the share of rewritten lines a second agent also rewrites, differently.
 */
export async function pretend(call: Call, path: string, base: string, target: string, opts: { agents?: number; contest?: number; seed?: number; owner?: string; repo?: string } = {}): Promise<FileRun> {
  const n = Math.max(1, opts.agents ?? 4), rand = rng(opts.seed ?? 1), t0 = performance.now();
  const owner = opts.owner ?? "borg", repo = opts.repo ?? `replay-${Math.floor(rand() * 1e9).toString(36)}`;
  const ok = async (r: Promise<Response>) => { const res = await r; if (!res.ok) throw new Error(`${res.status} ${await res.text()}`); return res.json() as Promise<any>; };
  const post = (user: string, url: string, body: unknown) => ok(call(user, url, { method: "POST", body: JSON.stringify(body) }));
  const names = Array.from({ length: n }, (_, i) => `agent-${i + 1}`);

  await post(owner, "/api/login", { name: owner });
  await post(owner, "/api/repos", { name: repo, visibility: "public" });
  for (const a of names) await post(owner, `/api/repos/${owner}/${repo}/collaborators`, { name: a });
  await post(owner, `/api/repos/${owner}/${repo}/files`, { path, content: base });
  const door = `/api/repos/${owner}/${repo}/do`, q = `?path=${encodeURIComponent(path)}`;
  const read = (as: string): Promise<Doc> => ok(call(as, `${door}/file${q}`));

  // What the commit did, as ops on the seeded doc's own ids.
  const seeded = await read(owner);
  const plan = units(diffToOps(seeded.lines, target.split("\n")));
  const deal: Unit[][] = names.map(() => []);
  const offered = new Map<string, Set<string>>(); // line id -> every text an agent tried to put there
  plan.forEach((u, i) => deal[i % n]!.push(u));
  let contested = 0;
  if (n > 1) for (const [i, u] of plan.entries()) {
    const op = u[0]!;
    if (op.kind !== "set" || rand() >= (opts.contest ?? 0)) continue;
    contested++;
    const rival: Unit = [{ ...op, text: `${op.text} /* rival */` }];
    offered.set(op.line, new Set([op.text, (rival[0] as { text: string }).text]));
    deal[(i + 1 + Math.floor(rand() * (n - 1))) % n]!.push(rival);
  }

  // Each agent works its pile in its own order, so a rival is as likely to land first as the original.
  for (const d of deal) for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [d[i], d[j]] = [d[j]!, d[i]!]; }

  const stats: AgentStat[] = names.map((name) => ({ name, units: 0, conflicts: 0, yielded: 0 }));
  const stuck: string[] = [];
  await Promise.all(names.map(async (name, k) => {
    for (const u of deal[k]!) {
      for (let tries = 0; ; tries++) {
        // Re-read each try: the line revs this unit pinned may be stale.
        const doc = await read(name), byId = new Map(doc.lines.map((l) => [l.id, l]));
        const fresh: Op[] = [];
        let moved = false;
        for (const op of u) {
          if (op.kind === "insert") { fresh.push(op); continue; }
          const l = byId.get(op.line);
          if (!l) { moved = true; break; } // another agent deleted it: this unit has nothing left to do
          if (op.kind === "set" && l.text === op.text) { moved = true; break; } // already says so
          // A contested line someone else rewrote since the seed is theirs: after the file's guard has said no once, yield rather than clobber.
          if (tries > 0 && op.kind === "set" && offered.has(op.line) && l.rev !== (seeded.lines.find((s) => s.id === op.line)?.rev ?? l.rev)) { stats[k]!.yielded++; moved = true; break; }
          // First try on a contested line goes out as read at the seed: the file's own guard decides if it is stale.
          fresh.push(tries === 0 && offered.has(op.line) ? op : { ...op, base: l.rev });
        }
        if (moved || !fresh.length) break;
        await new Promise((r) => setTimeout(r, rand() * 4)); // think
        const res = await call(name, `${door}/ops${q}`, { method: "POST", body: JSON.stringify({ ops: fresh }) });
        if (res.ok) { stats[k]!.units++; break; }
        if (res.status !== 409) throw new Error(`${name}: ${res.status} ${await res.text()}`);
        stats[k]!.conflicts++;
        if (tries >= 25) { stuck.push(`${name} gave up on ${JSON.stringify(u[0])}`); break; }
      }
    }
  }));

  const now = text(await read(owner));
  const detail: string[] = [...stuck];
  let verdict: FileRun["verdict"] = stuck.length ? "stuck" : "exact";
  if (!stuck.length && now !== target) {
    verdict = "settled";
    // Allowed to differ: a contested line holding one of the texts offered for it, and nothing else.
    const allowed = new Set([...offered.values()].flatMap((s) => [...s]));
    const want = target.split("\n"), have = now.split("\n");
    const bad = have.length !== want.length
      ? [`line count ${have.length}, the commit has ${want.length}`]
      : have.flatMap((l, i) => l === want[i] || allowed.has(l) ? [] : [`line ${i + 1}: ${JSON.stringify(l)}, the commit has ${JSON.stringify(want[i])}`]);
    if (bad.length) { verdict = "lost"; detail.push(...bad.slice(0, 5)); }
  }
  return { path, agents: n, units: plan.length, contested, conflicts: stats.reduce((s, a) => s + a.conflicts, 0), yielded: stats.reduce((s, a) => s + a.yielded, 0), verdict, detail, stats, ms: Math.round(performance.now() - t0) };
}

export interface CommitRun { commit: string; subject: string; files: FileRun[]; skipped: number }

/** One commit's text files, each replayed by a team. Binary, huge, new and deleted files are skipped: no base to rewrite. */
export async function replayCommit(call: Call, repo: string, commit: string, opts: { agents?: number; contest?: number; seed?: number; maxLines?: number } = {}): Promise<CommitRun> {
  commit = (git(repo, "rev-parse", "--verify", `${commit}^{commit}`) ?? "").trim();
  if (!commit) throw new Error("not a commit");
  const subject = (git(repo, "log", "-1", "--format=%s", commit) ?? "").trim();
  const changed = (git(repo, "diff-tree", "-r", "--no-commit-id", "--name-status", "--no-renames", `${commit}^`, commit) ?? "").split("\n").filter(Boolean);
  const files: FileRun[] = [];
  let skipped = 0;
  for (const row of changed) {
    const [status, path] = row.split("\t");
    const [before, after] = [`${commit}^`, commit].map((rev) => git(repo, "show", `${rev}:${path}`));
    if (status !== "M" || before === null || after === null || before.includes("\0") || after.includes("\0") || after.split("\n").length > (opts.maxLines ?? 2000) || before === after) { skipped++; continue; }
    // A file's last newline isn't a line: docs drop it, so both sides are compared without it.
    files.push(await pretend(call, path!, before.replace(/\n$/, ""), after.replace(/\n$/, ""), { ...opts, repo: `r${files.length}-${commit.slice(0, 7)}` }));
  }
  return { commit: commit.slice(0, 9), subject, files, skipped };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (f: string, d: number) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : d; };
  const pos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const [repo, ...given] = pos;
  if (!repo) { console.error("usage: bun scripts/borg-agents.ts <repo> [commit ...] [--agents 4] [--contest 0.3] [--seed 1] [--json]"); process.exit(2); }
  const commits = given.length ? given : (git(repo, "log", "--no-merges", "-n20", "--format=%H") ?? "").split("\n").filter(Boolean);
  const call = await local({ GH_CLI: "off" });
  const runs: CommitRun[] = [];
  try {
    for (const c of commits) runs.push(await replayCommit(call, repo, c, { agents: flag("--agents", 4), contest: flag("--contest", 0.3), seed: flag("--seed", 1) }));
  } finally { call.close(); }
  const all = runs.flatMap((r) => r.files);
  const n = (v: FileRun["verdict"]) => all.filter((f) => f.verdict === v).length;
  if (args.includes("--json")) console.log(JSON.stringify(runs, null, 2));
  else {
    for (const r of runs) {
      console.log(`${r.commit} ${r.subject.slice(0, 70)}`);
      for (const f of r.files) {
        console.log(`  ${f.verdict.padEnd(7)} ${f.path} (${f.units} units, ${f.contested} contested, ${f.conflicts} retried, ${f.yielded} yielded, ${f.ms} ms)`);
        for (const d of f.detail) console.log(`      ${d}`);
      }
    }
    console.log(`${all.length} files from ${runs.length} commits: ${n("exact")} exact, ${n("settled")} settled, ${n("lost")} lost, ${n("stuck")} stuck`);
  }
  process.exit(n("lost") + n("stuck") ? 1 : 0);
}
