// Layout: branches: forking a file onto one, review, merge
// Branches and merges. An agent works on a branch: its own copy of each file
// it touches, which a person or another agent reviews and merges. Built on
// the line-op log, not git branches: a branch's copy of a file is its own
// Durable Object, forked from main's with every line id and rev intact, so a
// merge is a three-way merge by line id (`merge` in lines.ts) that main's
// file applies in one batch, each line keeping its author. Lines only one
// side changed never conflict; a line both changed is settled per line:
// main's, the branch's, both, or a text of the merger's (Pick in lines.ts).
// The review says which picks each conflict takes, and suggests a text where
// both sides only added words at one spot; a coding agent can write one too
// (POST .../conflicts/agent, conflict-agent.ts), offered as settled only when the merged file parses
// and the repo's tests pass with it in a throwaway clone. A merged JavaScript or TypeScript file that
// would no longer build (lint.ts) is a conflict too. Git hears about it when
// main is catalogued. A branch can delete a file too: its row is marked
// deleted, and merging deletes it from main, and from git there and then.
// A merge also waits for the repo's required checks to pass on the branch (checks.ts).
// A binary file a mirror branch took from upstream has no lines: its row holds
// the git blob (#446), which the review shows as changed and the merge writes into main's git.
// A branch can be opened on another branch (#1025): B on A forks each file from A's copy where A has
// one, waits for A to merge first, and when A does, its copies move onto main's (restack below).
// A branch that clashed with one that merged (merge-plan.ts) takes main in by itself, once (#1162, afterBlocker).
// When it really clashes, a rebuild task merges main in for it, both sides kept (#1219, rebuildOnMain).
// So does one that follows a branch upstream and clashes with main only in git, at the next sync (#1190, takeMainUpstream).

import { apply, empty, explain, fromText, merge, PICKS, text, type Conflict, type Doc, type Line, type Op, type Pick, type Resolve } from "./lines.ts";
import { lintMerge } from "./lint.ts";
import { policyOf, type Policy, type Rule } from "./policy.ts";
import { conflictNote, conflictRound } from "./budget.ts";
import { regenerateDocs, regenerateLock, tryInClone } from "./deps.ts";
import { catalogueBlob, handleFor, materialize, toFile, uncatalogue } from "./archive.ts";
import { changedLines, isBuildFile } from "./buildfiles.ts";
import { branchEdited, mergeBlock, refChecks, waiting } from "./checks.ts";
import { settings as deploySettings } from "./deploy.ts";
import { branchNameError, json, type Env, readBody } from "./env.ts";
import { byToken } from "./tokens.ts";
import { emit } from "./hooks.ts";
import { diffToOps, keptPairs } from "./sync.ts";
import { unindexFile } from "./search.ts";
import { HARNESSES, type Harness } from "./harness.ts";
import { protectOn } from "./protect.ts";
import { localSandbox, type Exec } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { ADMINS_ONLY, adminsOnly, agentsUnavailable, hostedBudget, installedHarnesses } from "./agent-routes.ts";
import { askAgent, cheapest } from "./conflict-agent.ts";
import { alsoFor, fixUnavailable, guardTripped, healUnavailable, openFix, rebuildTask } from "./heal.ts";
import { hunks, revertOps } from "./review.ts";
import { MERVIN } from "./mervin.ts";
import { noteConflict } from "./usage.ts";
import { busyOn, clashIn, taskFiles, waves, type Busy, type Clash, type Side } from "./merge-plan.ts";
import { sha256 } from "./util.ts";
import { countMerge } from "./stats.ts";
import { deleteLearning, learningState, recordEvents, setLearning, type Event as LearnEvent } from "./mervin-learning.ts";
import { emitOutcome } from "./mervin-events.ts";
import { boardRoutes } from "./board-routes.ts";

const TEXT_MAX = 20_000;

/** `resolve` as a merge sends it, {path: {line: pick}}, checked; or what's wrong with it. */
export function parseResolve(raw: unknown): Record<string, Resolve> | string {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return "resolve: {path: {line: pick}}";
  const out: Record<string, Resolve> = {};
  for (const [path, lines] of Object.entries(raw)) {
    if (!lines || typeof lines !== "object" || Array.isArray(lines)) return `resolve.${path}: {line: pick}`;
    out[path] = {};
    for (const [line, v] of Object.entries(lines as Record<string, unknown>)) {
      const ok = (PICKS as readonly unknown[]).includes(v) ||
        (!!v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" && (v as { text: string }).text.length <= TEXT_MAX);
      if (!ok) return `resolve.${path}.${line}: ${PICKS.map((p) => JSON.stringify(p)).join(", ")} or {"text": "..."} (up to ${TEXT_MAX} characters)`;
      out[path]![line] = (typeof v === "object" ? { text: (v as { text: string }).text.replace(/\r\n?/g, "\n") } : v) as Pick;
    }
  }
  return out;
}
interface Access { read: boolean; write: boolean }

export async function openBranch(env: Env, owner: string, repo: string, name: string) {
  const b = await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first() as BranchRow | null;
  return b?.status === "open" ? b : null;
}

/** Every open branch of the repo, oldest first. */
async function openBranches(env: Env, owner: string, repo: string) {
  return (await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND status = 'open' ORDER BY created_at, name").bind(owner, repo).all()).results as BranchRow[];
}

/** The open branches `branch` is stacked on, nearest first: its parent, that one's, and on down. One that merged has its work on main, and ends it. */
export async function ancestors(env: Env, owner: string, repo: string, branch: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT name, parent, status FROM branches WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const all = new Map((results as { name: string; parent: string | null; status: string }[]).map((b) => [b.name, b]));
  const out: string[] = [];
  for (let p = all.get(branch)?.parent; p && all.get(p)?.status === "open" && p !== branch && !out.includes(p); p = all.get(p)?.parent) out.push(p);
  return out;
}

/** Where `branch`'s copy of `path` forks from: the nearest open branch under it with a copy of its own (deleted or binary there, maybe), or null for main. */
async function forkSource(env: Env, owner: string, repo: string, branch: string, path: string) {
  for (const from of await ancestors(env, owner, repo, branch)) {
    const row = await env.DB.prepare("SELECT deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND merged = 0").bind(owner, repo, from, path).first();
    if (row) return { from, deleted: !!row.deleted, blob: !!row.blob };
  }
  return null;
}

/** Make sure `path` has a copy on `branch`, forked the first time it's opened from the copy of the branch it's stacked on, or else main's. */
export async function materializeOn(env: Env, owner: string, repo: string, branch: string, path: string): Promise<{ ok: true } | { error: string; status: number }> {
  const row = await env.DB.prepare("SELECT deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).first();
  if (row?.blob) return { error: "binary file", status: 415 };
  if (row) return row.deleted ? { error: "deleted on this branch", status: 404 } : { ok: true };
  const src = await forkSource(env, owner, repo, branch, path);
  if (src?.deleted) return { error: `deleted on ${src.from}`, status: 404 };
  if (src?.blob) return { error: "binary file", status: 415 };
  if (!src) {
    const m = await materialize(env, owner, repo, path);
    if ("error" in m) return m;
  }
  const doc = await (await toFile(env, owner, repo, path, "upstream", "file", {}, "", src?.from)).json();
  // Fork before the row lands, so nobody reads the copy empty; the DO forks once.
  await toFile(env, owner, repo, path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", branch);
  await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path, source) VALUES (?, ?, ?, ?, ?)").bind(owner, repo, branch, path, src?.from ?? null).run();
  return { ok: true };
}

/** A file that's new on the branch: forked from nothing. One the branch deleted, or had as binary, can be made again. */
export async function createOn(env: Env, owner: string, repo: string, branch: string, path: string, content: string, user: string) {
  const src = await forkSource(env, owner, repo, branch, path);
  const gone = await env.DB.prepare("UPDATE branch_files SET deleted = 0, merged = 0, blob = NULL, mode = NULL, source = ? WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND (deleted = 1 OR blob IS NOT NULL)").bind(src && !src.deleted && !src.blob ? src.from : null, owner, repo, branch, path).run();
  if (gone.meta?.changes) {
    // Its copy starts over, forked again from the branch under it or main, whichever has it, so merging it is an edit of that.
    await toFile(env, owner, repo, path, user, "wipe", { method: "POST" }, "", branch);
    const onMain = src ? null : await materialize(env, owner, repo, path);
    const doc = src?.deleted || src?.blob || (onMain && "error" in onMain) ? empty() : await (await toFile(env, owner, repo, path, "upstream", "file", {}, "", src?.from)).json() as Doc;
    await toFile(env, owner, repo, path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", branch);
    const ops = diffToOps(doc.lines, content.split("\n"));
    if (ops.length) await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops }) }, "", branch);
    return json({ path, branch }, 201);
  }
  // The branch it's stacked on has it: that's the file it sees. One that deleted it doesn't.
  if (src && !src.deleted) return json({ error: "file exists" }, 409);
  const onMain = src ? null : await materialize(env, owner, repo, path);
  if (onMain && (!("error" in onMain) || onMain.status !== 404)) return json({ error: "file exists" }, 409);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path) VALUES (?, ?, ?, ?)").bind(owner, repo, branch, path).run();
  if (!r.meta?.changes) return json({ error: "file exists" }, 409);
  await toFile(env, owner, repo, path, user, "fork", { method: "POST", body: JSON.stringify({ doc: empty() }) }, "", branch);
  await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(content) }) }, "", branch);
  return json({ path, branch }, 201);
}

/**
 * Delete `path` on `branch`. One that's only on the branch just goes; one main
 * has (text or not: binary and too-big files can go too) is marked deleted, so
 * the merge deletes it from main.
 */
export async function deleteOn(env: Env, owner: string, repo: string, branch: string, path: string) {
  const row = await env.DB.prepare("SELECT deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).first();
  if (row?.deleted) return json({ error: "no such file" }, 404);
  // "Main" here is what the branch sees under its own copies: the branch it's stacked on, or main.
  const src = await forkSource(env, owner, repo, branch, path);
  const onMain = src ? null : await materialize(env, owner, repo, path);
  const mainHas = src ? !src.deleted : !("error" in onMain!) || onMain!.status !== 404;
  if (!mainHas && !row) return json({ error: "no such file" }, 404);
  if (row && !row.blob) await toFile(env, owner, repo, path, "upstream", "wipe", { method: "POST" }, "", branch);
  if (!mainHas) await env.DB.prepare("DELETE FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).run();
  else await env.DB.prepare("INSERT INTO branch_files (owner, repo, branch, path, deleted) VALUES (?, ?, ?, ?, 1) ON CONFLICT (owner, repo, branch, path) DO UPDATE SET deleted = 1, merged = 0, blob = NULL, mode = NULL").bind(owner, repo, branch, path).run();
  return json({ path, branch, deleted: true });
}

/** Main loses `path`: its copy, its rows, and its place in git (and the mirror's upstream, at the next sync). */
async function deleteOnMain(env: Env, owner: string, repo: string, path: string, user: string, message: string) {
  await toFile(env, owner, repo, path, user, "wipe", { method: "POST" });
  await env.DB.batch(["files", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ? AND path = ?`).bind(owner, repo, path)));
  await unindexFile(env, owner, repo, path);
  const git = await uncatalogue(env, owner, repo, path, user, message).catch(() => null);
  if (git) {
    const { kickMirror } = await import("./mirror.ts");
    await kickMirror(env, owner, repo);
  }
}

/**
 * What `branch` has at a binary `path` (#1298): its blob, null where it's deleted, "text" where it's
 * lines, or undefined for main's. Its own copy first, then the open branches it's stacked on.
 */
export async function blobOn(env: Env, owner: string, repo: string, branch: string, path: string): Promise<string | null | "text" | undefined> {
  for (const [i, b] of [branch, ...await ancestors(env, owner, repo, branch)].entries()) {
    const row = await env.DB.prepare(`SELECT deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?${i ? " AND merged = 0" : ""}`).bind(owner, repo, b, path).first();
    if (row) return row.deleted ? null : (row.blob as string | null) ?? "text";
  }
}

/** A blob's bytes: from the mirror's git (a branch's from upstream, #446), or else the repo's own (a commit's, picked or reverted, #1298). */
export async function blobBytesOf(env: Env, owner: string, repo: string, blob: string): Promise<Uint8Array | null> {
  const { blobBytes } = await import("./mirror.ts");
  const mirrored = await blobBytes(env, owner, repo, blob);
  if (mirrored) return mirrored;
  const b = await (await handleFor(env, owner, repo).catch(() => null))?.handle.readBlob(blob).catch(() => null);
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}

/** Main takes the branch's binary `path` (#446): its bytes, from git, into main's git (and upstream's, at the next sync). */
async function blobOnMain(env: Env, owner: string, repo: string, f: { path: string; blob: string; mode: string | null }, user: string, message: string) {
  const { kickMirror } = await import("./mirror.ts");
  const bytes = await blobBytesOf(env, owner, repo, f.blob);
  if (!bytes) throw new Error(`${f.path}'s bytes aren't in this repo's git any more`);
  await catalogueBlob(env, owner, repo, f.path, { bytes, mode: f.mode ?? undefined }, user, message);
  await kickMirror(env, owner, repo);
}

/** The policy for `path` (#938): its kind's defaults, under main's `.gitattributes`. */
export async function pathPolicy(env: Env, owner: string, repo: string, path: string, user: string): Promise<Policy> {
  const res = await toFile(env, owner, repo, ".gitattributes", user, "file");
  return policyOf(path, res.ok ? text(await res.json() as Doc) : "");
}

/** Ask main's copy of `path` to merge the branch's, by the path's merge rule: a dry run, or for real. */
async function mergeFile(env: Env, owner: string, repo: string, branch: { name: string; by: string }, path: string, user: string, resolve: Resolve | undefined, dry: boolean) {
  const read = async (op: string) => (await toFile(env, owner, repo, path, user, op, {}, "", branch.name)).json() as Promise<Doc>;
  const [base, doc, policy] = await Promise.all([read("base"), read("file"), pathPolicy(env, owner, repo, path, user)]);
  // Text the merger writes is theirs; deleted lines are the branch's doing.
  const res = await toFile(env, owner, repo, path, user, "merge", { method: "POST", body: JSON.stringify({ base, branch: doc, resolve, dry, deleter: branch.by, path, writer: user, rule: policy.merge }) });
  return { status: res.status, policy, ...(await res.json() as { rev: number; ops?: Op[]; conflicts: Conflict[]; checks?: Conflict[]; regenerate?: string[]; solved?: number }) };
}

/**
 * A copy forked from another branch's, moved onto main's file once that branch merged (#1025). The
 * merge gave the lines it brought main's own ids, so first the copy's lines are matched to main's by
 * text: a line it had when it forked that main has too is main's line; the rest get ids of their own.
 * Then it's a three-way merge like any other, the copy's lines winning where main changed them too.
 * The ops turn `onto` into the copy, restacked; null when even that doesn't settle.
 */
export function restack(base: Doc, copy: Doc, onto: Doc, by: string, path: string, rule?: Rule): { ops: Op[]; by: string[] } | null {
  const ids = new Map<string, Line>(), own = new Map<string, string>();
  for (const { i, j } of keptPairs(base.lines.map((l) => l.text), onto.lines.map((l) => l.text))) ids.set(base.lines[i]!.id, onto.lines[j]!);
  const fresh = (id: string) => own.get(id) ?? own.set(id, `restack-${own.size}`).get(id)!;
  const was = new Map(base.lines.map((l) => [l.id, l.text]));
  const b = { ...base, lines: base.lines.map((l) => ids.get(l.id) ?? { ...l, id: fresh(l.id) }) };
  const c = { ...copy, lines: copy.lines.map((l) => {
    const m = ids.get(l.id);
    return !m ? { ...l, id: fresh(l.id) } : l.text === was.get(l.id) ? m : { ...l, id: m.id, rev: m.rev };
  }) };
  let m = merge(b, c, onto, {}, by, path, by, rule);
  if (m.conflicts.length) m = merge(b, c, onto, Object.fromEntries(m.conflicts.map((x) => [x.line, "branch" as const])), by, path, by, rule);
  return !m.conflicts.length && apply(structuredClone(onto), m.ops, m.by, 0, onto.rev).ok ? { ops: m.ops, by: m.by } : null;
}

/**
 * Branch `from` merged: the copies its children forked from its copies move onto main's files,
 * so they merge into main by its line ids. One that won't settle keeps its source, and its merge says so.
 */
async function restackChildren(env: Env, owner: string, repo: string, from: string) {
  const { results } = await env.DB.prepare(`SELECT f.branch, f.path, f.deleted, f.blob, b.by FROM branch_files f JOIN branches b ON b.owner = f.owner AND b.repo = f.repo AND b.name = f.branch
    WHERE f.owner = ? AND f.repo = ? AND f.source = ? AND f.merged = 0 AND b.status = 'open'`).bind(owner, repo, from).all();
  for (const f of results as { branch: string; path: string; deleted: number; blob: string | null; by: string }[]) {
    const done = () => env.DB.prepare("UPDATE branch_files SET source = NULL WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, f.branch, f.path).run();
    // A deletion or a binary file has no lines to line up.
    if (f.deleted || f.blob) { await done(); continue; }
    const read = async (op: string, on?: string) => (await toFile(env, owner, repo, f.path, "upstream", op, {}, "", on)).json() as Promise<Doc>;
    const onMain = await materialize(env, owner, repo, f.path);
    const [base, copy, onto, policy] = await Promise.all([read("base", f.branch), read("file", f.branch), "error" in onMain ? empty() : read("file"), pathPolicy(env, owner, repo, f.path, "upstream")]);
    const r = restack(base, copy, onto, f.by, f.path, policy.merge);
    if (!r) continue;
    await toFile(env, owner, repo, f.path, "upstream", "wipe", { method: "POST" }, "", f.branch);
    await toFile(env, owner, repo, f.path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc: onto }) }, "", f.branch);
    if (r.ops.length) await toFile(env, owner, repo, f.path, f.by, "ops", { method: "POST", body: JSON.stringify({ ops: r.ops }) }, "", f.branch);
    await done();
  }
}

/** What the branch changed in `path`, as hunks against its fork point; private lines blank outside the crew. */
async function fileHunks(env: Env, owner: string, repo: string, branch: string, path: string, user: string, crew: boolean) {
  const read = async (op: string) => (await toFile(env, owner, repo, path, user, op, { headers: { "x-codesplitter-crew": crew ? "1" : "0" } }, "", branch)).json() as Promise<Doc | null>;
  const [base, doc] = await Promise.all([read("base"), read("file")]);
  return { doc: doc!, hunks: hunks(base ?? empty(), doc!) };
}

type BranchRow = { name: string; by: string; status?: string; parent: string | null; waits_on: string | null; created_at?: unknown; upstream_ref?: unknown };
type FileRow = { path: string; merged: number; deleted: number; blob: string | null; mode: string | null };
/** A coding agent's answer to one conflict, checked: `ok` only when the merged file parses and the tests pass (or don't run). */
export interface Answer { harness: Harness; model?: string; text?: string; ok: boolean; tests: string; failure?: string; round?: number; note?: string }

/** The branch's other files that merge clean, as merged: what a throwaway clone gets beside the file in question. */
async function cleanMerged(env: Env, owner: string, repo: string, branch: BranchRow, rows: FileRow[], skip: string, user: string) {
  const others = rows.filter((x) => x.path !== skip && !x.merged && !x.deleted && !x.blob);
  const clean = await Promise.all(others.map(async (x) => {
    const m = await mergeFile(env, owner, repo, branch, x.path, user, undefined, true);
    if (m.conflicts.length) return null;
    const d = await (await toFile(env, owner, repo, x.path, user, "file")).json() as Doc;
    return apply(d, m.ops ?? [], m.ops?.map(() => user) ?? [], 0, d.rev).ok ? [x.path, text(d)] as const : null;
  }));
  return Object.fromEntries(clean.filter((x) => !!x)) as Record<string, string>;
}

/**
 * A coding agent writes the settled text for conflict `c` in `path`, and it's checked (#934): offered as
 * settled only if the merged file parses and the tests pass; otherwise a person gets it with the failure.
 */
async function checkedAnswer(env: Env, owner: string, repo: string, branch: BranchRow, rows: FileRow[], path: string, c: Conflict,
  ask: { harness: Harness; model?: string; note?: string }, user: string, signal?: AbortSignal): Promise<Answer | { error: string }> {
  const name = branch.name;
  const doc = async (op: string, on?: string) => (await toFile(env, owner, repo, path, user, op, {}, "", on)).json() as Promise<Doc>;
  const [main, base, ours] = await Promise.all([doc("file"), doc("base", name), doc("file", name)]);
  const rule = (await pathPolicy(env, owner, repo, path, user)).merge;
  // The file as the merge leaves it: every other change in, and this conflict settled as `resolve` says.
  const mergedWith = (resolve: Resolve) => {
    const m = merge(base, ours, main, resolve, String(branch.by), path, user, rule), d = structuredClone(main);
    return { m, d, ok: apply(d, m.ops, m.by, 0, main.rev).ok };
  };
  // Why main changed the file since the branch forked: its commit messages. A branch doesn't commit.
  const log = await (await toFile(env, owner, repo, path, user, "commits")).json().catch(() => []) as { at: number; message: string }[];
  const said = (Array.isArray(log) ? log : []).filter((x) => x.at >= Number(branch.created_at) && x.message !== "commit").map((x) => x.message).slice(0, 10);
  // Why the branch changed it: the task of the agent run that made it (agent-routes.ts runBranch), if one did.
  const run = /^agent-run-(\d+)$/.exec(name);
  const meant = run ? ((await env.DB.prepare("SELECT task FROM agent_runs WHERE owner = ? AND repo = ? AND id = ?").bind(owner, repo, Number(run[1])).first()) as { task: string } | null)?.task : undefined;
  // Or, for one that follows a branch upstream, that branch's commit messages to the file (#990).
  const ref = branch.upstream_ref as string | null | undefined;
  const theirs = ref ? await (await import("./mirror.ts")).upstreamMessages(env, owner, repo, ref, path) : [];
  const box = env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined);
  const r = await askAgent(box, { ...ask, path, branch: name, conflict: c, merged: mergedWith({}).d, said, meant, theirs }, signal);
  if ("error" in r) return r;
  const answer = { harness: ask.harness, ...(ask.model && { model: ask.model }), text: r.text };
  const settled = mergedWith({ [c.line]: { text: r.text } });
  const broken = [...settled.m.conflicts.filter((x) => x.lint), ...(settled.ok ? lintMerge(path, main, ours, settled.m) : [])].map((x) => x.lint);
  if (!settled.ok || settled.m.conflicts.some((x) => x.line === c.line)) broken.unshift("the answer doesn't settle the conflict");
  if (broken.length) return { ...answer, ok: false, failure: `merged, it doesn't parse: ${broken.join("; ")}`, tests: "not run" };
  // The test run gets this file as merged, and the branch's other files that merge cleanly;
  // only the tests for the settled file, where the repo's test script runs one runner straight (#990).
  const t = await tryInClone(env, owner, repo, { ...(await cleanMerged(env, owner, repo, branch, rows, path, user)), [path]: text(settled.d) }, [path]);
  if ("skipped" in t) return { ...answer, ok: true, tests: `skipped: ${t.skipped}` };
  const left = settled.m.conflicts.length ? ` (${settled.m.conflicts.length} other conflict${settled.m.conflicts.length > 1 ? "s" : ""} in ${path} ran as main's)` : "";
  return { ...answer, ok: t.ok, tests: (t.ok ? "passed" : "failed") + left, ...(!t.ok && { failure: t.out.slice(-4000) }) };
}

/** Conflicts one merge asks a coding agent about on its own, at most: each is a run on the site's budget. */
export const MAX_ASKED = 3;

/** Which conflict an answer was for: the same line in another conflict needs another answer. */
async function conflictKey(c: Conflict) {
  return (await sha256(JSON.stringify([c.line, c.base, c.main, c.branch]))).slice(0, 32);
}

/** The answers kept for the branch's conflicts, by `path\nline`, with the conflict each was for. */
async function keptAnswers(env: Env, owner: string, repo: string, branch: string) {
  const { results } = await env.DB.prepare("SELECT path, line, key, answer FROM leftover_answers WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, branch).all();
  return new Map((results as { path: string; line: string; key: string; answer: string }[]).map((r) => [`${r.path}\n${r.line}`, { key: r.key, answer: JSON.parse(r.answer) as Answer }]));
}

/** The kept answer to `c`, if it was for this conflict as it stands. */
async function answerFor(kept: Awaited<ReturnType<typeof keptAnswers>>, path: string, c: Conflict) {
  const k = kept.get(`${path}\n${c.line}`);
  return k && k.key === await conflictKey(c) ? k.answer : undefined;
}

/**
 * A merge's leftovers in files whose policy gives them to AI (#1012): a coding agent answers each one
 * that takes a text, on its own, as suggest_resolution would, on the cheapest model there is. Its answer
 * is kept, so merging again asks nothing until the conflict changes. It runs where self-healing does
 * (heal.ts), and each run takes one from the site's `hosted` budget. Why none was asked, if so.
 *
 * A merge that asks again about a conflict answered before, because main moved under it, is another
 * conflict round on the branch (#1089). From the third (budget.ts conflictRound) the file's policy says who
 * answers, from a terse note of the rounds before: `handoff` fresh eyes on the CLI's own default model,
 * `downshift` the cheapest again, `escalate` a person, as everyone does after HANDOFFS of them. `notes`: why
 * a file's conflicts wait for a person.
 */
async function askLeftovers(env: Env, owner: string, repo: string, branch: BranchRow, rows: FileRow[], leftovers: { path: string; policy: Policy; conflicts: Conflict[] }[], user: string) {
  const kept = await keptAnswers(env, owner, repo, branch.name), answers = new Map<string, Answer>(), notes = new Map<string, string>();
  const off = healUnavailable(env, owner), cheap = off ? null : cheapest(installedHarnesses(env));
  const on = [owner, repo, branch.name] as const;
  let asked = 0, why: string | null = null, counted = false;
  let rounds = Number((await env.DB.prepare("SELECT conflict_rounds FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(...on).first())?.conflict_rounds ?? 0);
  for (const f of leftovers) for (const c of f.conflicts) {
    if (!explain(c).choices.includes("text")) continue;
    const id = `${f.path}\n${c.line}`, had = await answerFor(kept, f.path, c);
    if (had) { answers.set(id, had); continue; }
    if (!cheap) { why = off ?? "no coding agent's CLI is installed here"; continue; }
    if (asked >= MAX_ASKED) { why = `a merge asks about ${MAX_ASKED} conflicts at most: merge again for the rest`; continue; }
    // The first ask is round one; asking again about a line answered before is the next, once a merge.
    // One a person gets isn't counted, so merging again doesn't run the count up.
    const round = !counted && (!rounds || kept.has(id)) ? rounds + 1 : rounds;
    const who = conflictRound(round, f.policy.over);
    const note = who === "ask" ? undefined : conflictNote({ branch: branch.name, path: f.path, line: c.line, rounds: round - 1, last: kept.get(id)?.answer });
    if (who === "escalate") { await noteConflict(env, owner, f.path, { round, who }); notes.set(f.path, `conflict round ${round} on ${branch.name}: a person's turn\n${note}`); continue; }
    const spent = await hostedBudget(env);
    if (spent) { why = ((await spent.json()) as { error: string }).error; continue; }
    if (round > rounds) {
      counted = true;
      rounds = Number((await env.DB.prepare("UPDATE branches SET conflict_rounds = conflict_rounds + 1 WHERE owner = ? AND repo = ? AND name = ? RETURNING conflict_rounds").bind(...on).first())?.conflict_rounds ?? round);
    }
    asked++;
    // Fresh eyes under `handoff`: the same CLI on its own default model, not the cheapest that missed twice.
    const ask = { ...(who === "handoff" ? { harness: cheap.harness } : cheap), ...(note && { note }) };
    const r = await checkedAnswer(env, owner, repo, branch, rows, f.path, c, ask, user).catch((e) => ({ error: String((e as Error)?.message ?? e) }));
    const a: Answer = { ...("error" in r ? { harness: ask.harness, ...(ask.model && { model: ask.model }), ok: false, tests: "not run", failure: r.error.slice(-4000) } : r), ...(note && { round: rounds, note }) };
    answers.set(id, a);
    await noteConflict(env, owner, f.path, { round, who, harness: a.harness, ok: a.ok, tests: a.tests });
    await env.DB.prepare(`INSERT INTO leftover_answers (owner, repo, branch, path, line, key, answer, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (owner, repo, branch, path, line) DO UPDATE SET key = excluded.key, answer = excluded.answer, at = excluded.at`)
      .bind(owner, repo, branch.name, f.path, c.line, await conflictKey(c), JSON.stringify(a), Date.now()).run();
  }
  return { answers, why, notes };
}

/**
 * A lockfile both sides changed, in a file whose policy gives its leftovers to CI (#1012): made again
 * from main's lockfile and the branch's manifests as merged, in a throwaway clone (deps.ts), and put on
 * the branch, so the merge takes it whole. Null when it's on the branch; else why not.
 */
async function regenerated(env: Env, owner: string, repo: string, branch: BranchRow, rows: FileRow[], path: string, user: string): Promise<string | null> {
  const main = await toFile(env, owner, repo, path, user, "file");
  if (!main.ok) return "not regenerated: main has no copy to start from";
  const t = await regenerateLock(env, owner, repo, path, { ...(await cleanMerged(env, owner, repo, branch, rows, path, user)), [path]: text(await main.json() as Doc) + "\n" });
  if ("skipped" in t) return `not regenerated: ${t.skipped}`;
  if (!t.ok || t.lock === undefined) return `couldn't be regenerated: ${t.out.trim().slice(-300)}`;
  const ours = await (await toFile(env, owner, repo, path, user, "file", {}, "", branch.name)).json() as Doc;
  const ops = diffToOps(ours.lines, t.lock.replace(/\n$/, "").split("\n"));
  if (ops.length) {
    const res = await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: ours.rev }) }, "", branch.name);
    if (!res.ok) return "not regenerated: the branch's copy changed meanwhile";
  }
  return null;
}

/**
 * Generated text both sides touched kept main's copy in the merge (#1154): each region's command, run once
 * the merge lands, from the folder of the file holding it, on the merged tree in a throwaway clone (deps.ts).
 * What it rewrote goes onto main's copies. One line per command: rebuilt, or why not.
 */
async function rebuilt(env: Env, owner: string, repo: string, paths: string[], dry: { path: string; regenerate?: string[] }[], user: string) {
  const runs = new Map<string, { cwd: string; command: string; read: string[] }>();
  for (const d of dry) for (const command of d.regenerate ?? []) {
    const cwd = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : "";
    const r = runs.get(`${cwd}\n${command}`) ?? runs.set(`${cwd}\n${command}`, { cwd, command, read: [] }).get(`${cwd}\n${command}`)!;
    r.read.push(d.path);
  }
  if (!runs.size) return [];
  const files: Record<string, string> = {};
  for (const path of paths) {
    const res = await toFile(env, owner, repo, path, user, "file");
    if (res.ok) files[path] = text(await res.json() as Doc) + "\n";
  }
  const out: { paths: string[]; command: string; cwd?: string; note?: string }[] = [];
  for (const { cwd, command, read } of runs.values()) {
    const said = (note?: string) => out.push({ paths: read, command, ...(cwd && { cwd }), ...(note && { note }) });
    const t = await regenerateDocs(env, owner, repo, files, cwd, command, read);
    if ("skipped" in t) { said(`not rebuilt: ${t.skipped}`); continue; }
    if (!t.ok || !t.files) { said(`couldn't be rebuilt: ${t.out.trim().slice(-300)}`); continue; }
    for (const [path, next] of Object.entries(t.files)) {
      const doc = await (await toFile(env, owner, repo, path, user, "file")).json() as Doc;
      const ops = diffToOps(doc.lines, next.replace(/\n$/, "").split("\n"));
      if (ops.length) await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops, ifRev: doc.rev }) });
    }
    said();
  }
  return out;
}

/**
 * A merge that settled with no card, checked further where the file's policy says `tests` (#1096): the lint
 * can't see a key or string one side renamed and the other still uses. Each such file both sides changed
 * since the branch forked (or, in code lint can't read, settled where git would have stopped, #1401) runs the repo's tests on the merged tree in a throwaway clone, as an agent's answer
 * does, only those files' tests where the runner can tell. A failure is a `lint:tests` conflict on each, and
 * settled as the branch it lands anyway. Null when it passed, or nothing needed the run, or it can't run here.
 */
async function testedMerge(env: Env, owner: string, repo: string, branch: BranchRow, dry: { path: string; policy: Policy; ops?: Op[]; checks?: Conflict[] }[], resolve: Record<string, Resolve>, user: string) {
  // A file new on the branch has no copy on main yet: it starts empty.
  const read = async (path: string, op: string, on?: string) => {
    const res = await toFile(env, owner, repo, path, user, op, {}, "", on);
    return (res.ok && await res.json() as Doc | null) || empty();
  };
  // Code lint.ts can't read that settled where git would have stopped (#1389, no facts) has only the build to say it still works (#1401).
  const asked = dry.filter((d) => (d.policy.check === "tests" || d.checks?.some((c) => !c.facts?.length)) && d.ops?.length && resolve[d.path]?.["lint:tests"] !== "branch");
  const both = (await Promise.all(asked.map(async (d) => {
    const [main, base] = await Promise.all([read(d.path, "file"), read(d.path, "base", branch.name)]);
    return text(main) !== text(base) ? d : null;
  }))).filter((d) => !!d);
  if (!both.length) return null;
  const files: Record<string, string> = {};
  for (const d of dry) {
    if (!d.ops?.length) continue;
    const doc = await read(d.path, "file");
    if (apply(doc, d.ops, d.ops.map(() => user), 0, doc.rev).ok) files[d.path] = text(doc);
  }
  const t = await tryInClone(env, owner, repo, files, both.map((d) => d.path));
  if ("skipped" in t || t.ok) return null;
  const lint = "merged with main's changes, the tests fail: settle it as the branch to land it anyway";
  return {
    error: `merged, its tests fail: ${both.map((d) => d.path).join(", ")}`, failure: t.out.slice(-4000),
    conflicts: both.map((d) => ({ path: d.path, leftover: d.policy.leftover, conflicts: [explain({ line: "lint:tests", base: "", main: null, branch: null, lint })] })),
  };
}

/**
 * The dry run of merging `branch` into main as main is now, each file by its policy (#1012): a lockfile both
 * changed made again by CI, the AI's leftovers asked of a checked agent, a `check: tests` file's tests run.
 * `blocked` is what a 409 says when anything's left; `resolve` gains what the run settled.
 */
async function dryRun(env: Env, owner: string, repo: string, branch: BranchRow, rows: FileRow[], resolve: Record<string, Resolve>, user: string) {
  const name = branch.name;
  // A deletion never conflicts; a binary file has no lines.
  const dry = await Promise.all(rows.filter((f) => !f.merged && !f.deleted && !f.blob).map(async (f) => ({ path: f.path, ...(await mergeFile(env, owner, repo, branch, f.path, user, resolve[f.path], true)) })));
  // What the merge leaves goes where each file's policy says (#1012). A lockfile both changed, to CI: made again
  // on the branch and taken whole, unless the merger picked a side already.
  const notes = new Map<string, string>();
  for (const d of dry) {
    if (d.policy.leftover !== "ci" || !d.conflicts.some((c) => c.whole) || resolve[d.path]?.file) continue;
    const why = await regenerated(env, owner, repo, branch, rows, d.path, user);
    if (why) { notes.set(d.path, why); continue; }
    resolve[d.path] = { ...resolve[d.path], file: "branch" };
    Object.assign(d, await mergeFile(env, owner, repo, branch, d.path, user, resolve[d.path], true));
  }
  const left = dry.filter((d) => d.conflicts.length);
  // Settling a stretch can leave code that won't build: say so, as the review (settling nothing) can't show it.
  const broken = left.flatMap((b) => b.conflicts.filter((c) => c.lint).map((c) => `${b.path}: ${c.lint}`));
  if (left.length) {
    // A guard tripped (git's markers, a file that won't parse or build): a fix task on the branch, when self-healing is on (heal.ts).
    const trips = left.map((b) => ({ path: b.path, lints: b.conflicts.flatMap((c) => c.lint ? [c.lint] : []) }));
    const fix = await guardTripped(env, owner, repo, name, trips).catch(() => null);
    // To AI: a checked agent's answer to each, offered with the conflict, ok or with its failure for a person.
    const ai = left.filter((d) => d.policy.leftover === "ai" && !broken.length);
    const { answers, why, notes: waits } = ai.length ? await askLeftovers(env, owner, repo, branch, rows, ai, user) : { answers: new Map<string, Answer>(), why: null, notes: new Map<string, string>() };
    const blocked = left.map(({ path, policy, conflicts }) => {
      const note = notes.get(path) ?? waits.get(path) ?? (policy.leftover === "ai" && ai.length > 0 && why ? `no agent asked: ${why}` : undefined);
      return {
        path, leftover: policy.leftover, ...(note && { note }),
        conflicts: conflicts.map((c) => { const a = answers.get(`${path}\n${c.line}`); return { ...explain(c), ...(a && { answer: a }) }; }),
      };
    });
    return { blocked: { error: broken.length ? `merged, it wouldn't build: ${broken.join("; ")}` : "conflicts", conflicts: blocked, ...(fix && "id" in fix && { fix: fix.id }) } };
  }
  const failed = await testedMerge(env, owner, repo, branch, dry, resolve, user);
  return failed ? { blocked: failed } : { dry };
}

/**
 * What a branch that clashed with one that merged did about it (#1162): took main in, left cards for a person,
 * or started from main's copies with a rebuild task (`fix`, an agent run) putting main's side back (#1219).
 */
export interface Took { branch: string; status: "updated" | "cards" | "rebuilding" | "failed"; files?: string[]; pushed?: boolean; error?: string; fix?: number }

/**
 * Branch `name` clashed with `blocker`, which merged (merge-plan.ts): it takes main in, once, by the line-id
 * merge, as merging it would, so nobody has to. Settled with no card left (the checked agent's answers to the
 * AI's leftovers count, a lockfile CI makes again too, and a `check: tests` file's tests passing), each file it
 * changed that main moved under starts again from main's copy with the merge's ops on top, and a branch that
 * follows one upstream pushes there. Cards left wait for a person, the agent's answers with them. Either way
 * its own checks, held while it waited, run once now, unless it still waits for another.
 */
async function afterBlocker(env: Env, owner: string, repo: string, name: string, blocker: string, user: string): Promise<Took> {
  const b = await openBranch(env, owner, repo, name);
  if (!b) return { branch: name, status: "failed", error: "not open any more" };
  await waitFor(env, owner, repo, name, (JSON.parse(b.waits_on ?? "[]") as string[]).filter((w) => w !== blocker));
  try { return await takeMain(env, owner, repo, b, user, { rebuild: blocker }); }
  finally { if (!await waiting(env, owner, repo, name)) await branchEdited(env, owner, repo, name, Date.now(), b.by); }
}

/**
 * Branch `name` follows one upstream whose tip clashes with main's in git alone (#1190): the mirror's sync asks,
 * once main's commit has gone up. When every file it changed merges into main by line id with nothing left, it
 * takes main in (takeMain) and pushes that merge, so upstream's pull request stops showing a conflict. A line
 * that clashes here too is a person's, and a branch still waiting in the merge plan takes main in when its
 * blocker merges (afterBlocker): null for both. So is one a rebuild task is on: it pushes when it ends (#1226).
 */
export async function takeMainUpstream(env: Env, owner: string, repo: string, name: string): Promise<Took | null> {
  const b = await openBranch(env, owner, repo, name);
  if (!b?.upstream_ref || b.waits_on || (await ancestors(env, owner, repo, name)).length) return null;
  if (await env.DB.prepare("SELECT 1 FROM agent_runs WHERE owner = ? AND repo = ? AND branch = ? AND status = 'running' AND json_extract(result, '$.rebuild') IS NOT NULL").bind(owner, repo, name).first()) return null;
  const rows = (await env.DB.prepare("SELECT path FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND deleted = 0 AND blob IS NULL ORDER BY path").bind(owner, repo, name).all()).results as { path: string }[];
  for (const f of rows) if ((await mergeFile(env, owner, repo, b, f.path, b.by, undefined, true)).conflicts.length) return null;
  return takeMain(env, owner, repo, b, b.by, { push: true });
}

/**
 * Branch `b` takes main in (afterBlocker, takeMainUpstream). With `push`, it goes upstream even if no file had to.
 * With `rebuild` (the branch that merged), cards left go to a rebuild task when one can start (rebuildOnMain).
 */
async function takeMain(env: Env, owner: string, repo: string, b: BranchRow, user: string, o: { push?: boolean; rebuild?: string } = {}): Promise<Took> {
  const name = b.name;
  if ((await ancestors(env, owner, repo, name)).length) return { branch: name, status: "failed", error: "stacked on an open branch: it moves onto main when that one merges" };
  const rows = (await env.DB.prepare("SELECT path, merged, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as FileRow[];
  const resolve: Record<string, Resolve> = {};
  let run = await dryRun(env, owner, repo, b, rows, resolve, user);
  // Every card left has a checked agent's answer that passed: settle each with it.
  const cards = "blocked" in run ? run.blocked!.conflicts as { path: string; conflicts: { line: string; answer?: Answer }[] }[] : [];
  if (cards.length && cards.every((f) => f.conflicts.every((c) => c.answer?.ok && c.answer.text !== undefined))) {
    for (const f of cards) for (const c of f.conflicts) resolve[f.path] = { ...resolve[f.path], [c.line]: { text: c.answer!.text! } };
    run = await dryRun(env, owner, repo, b, rows, resolve, user);
  }
  if ("blocked" in run) {
    const left = run.blocked!.conflicts as { path: string; conflicts: (Conflict & { answer?: Answer })[] }[];
    return (o.rebuild && await rebuildOnMain(env, owner, repo, b, o.rebuild, rows, resolve, left, user)) ||
      { branch: name, status: "cards", files: left.map((f) => f.path), error: run.blocked!.error };
  }
  const { files, moved } = await onMainCopies(env, owner, repo, b, run.dry);
  // One that follows a branch upstream takes it there too, as a merge of main's tip.
  const up = files.length || (o.push && !moved) ? await pushTookMain(env, owner, repo, b) : null;
  return { branch: name, status: "updated", files, ...up };
}

/**
 * Branch `b`, which took main in by line id, goes to the branch it follows upstream as a merge of main's tip,
 * even where git alone would clash (mirror.ts pushBranch). Null when it follows none, or nothing mirrors here.
 */
async function pushTookMain(env: Env, owner: string, repo: string, b: BranchRow): Promise<{ pushed: boolean; error?: string } | null> {
  const { mirrorsOn, pushBranch } = await import("./mirror.ts");
  if (!(b.upstream_ref as string | null | undefined) || !mirrorsOn(env)) return null;
  const res = await pushBranch(env, owner, repo, b.name, { tookMain: true });
  if (!res) return null;
  const out = await res.json() as { pushed?: boolean; error?: string };
  return { pushed: res.ok && !!out.pushed, ...(!res.ok && { error: `not pushed upstream: ${out.error}` }) };
}

/**
 * A rebuild task on open branch `name` finished (agent-routes.ts, #1226): main's side is back beside the
 * branch's, so it goes upstream as takeMain's would, and its pull request stops showing the conflict.
 */
export async function rebuiltUpstream(env: Env, owner: string, repo: string, name: string) {
  const b = await openBranch(env, owner, repo, name) as BranchRow | null;
  return b ? pushTookMain(env, owner, repo, b) : null;
}

/**
 * Each of branch `b`'s files main moved under starts again from main's copy, with `dry`'s ops (a dry run's)
 * on top: what main changed is under the branch now, and its review shows only its own change. `moved`: main
 * moved again under one since the dry run, which is left for the next merge to take.
 */
async function onMainCopies(env: Env, owner: string, repo: string, b: BranchRow, dry: { path: string; rev: number; ops?: Op[] }[]) {
  const name = b.name, files: string[] = [];
  let moved = false;
  for (const d of dry) {
    const read = async (op: string, on?: string) => { const res = await toFile(env, owner, repo, d.path, "upstream", op, {}, "", on); return (res.ok && await res.json() as Doc | null) || empty(); };
    const [main, base] = await Promise.all([read("file"), read("base", name)]);
    // Main didn't move under this file, or moved again since the dry run (the next merge takes it): nothing to take.
    if (text(main) === text(base)) continue;
    if (main.rev !== d.rev) { moved = true; continue; }
    await toFile(env, owner, repo, d.path, "upstream", "wipe", { method: "POST" }, "", name);
    await toFile(env, owner, repo, d.path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc: main }) }, "", name);
    if (d.ops?.length) await toFile(env, owner, repo, d.path, b.by, "ops", { method: "POST", body: JSON.stringify({ ops: d.ops }) }, "", name);
    files.push(d.path);
  }
  return { files, moved };
}

/** Rounds of settling a rebuild takes: picking the branch's side can trip a lint the first merge didn't reach. */
const REBUILD_ROUNDS = 3;

/**
 * Branch `b` really clashes with main now that `blocker` merged (#1219): the cards `left` are the rebuild's, as
 * merging main in by hand is. Each clash is settled as a checked agent answered it, else as the branch's side,
 * so none of the branch's work goes; its files start again from main's copies with that on top (onMainCopies);
 * and a fix task (heal.ts rebuildTask) is told main's side of each, to put back. The restart waits until the
 * task is booked, so a branch nobody would rebuild stays as it was, its cards for a person: null then.
 * One that follows a branch upstream goes there when the task ends (rebuiltUpstream), not now: only then has it both sides.
 */
async function rebuildOnMain(env: Env, owner: string, repo: string, b: BranchRow, blocker: string, rows: FileRow[], resolve: Record<string, Resolve>, left: { path: string; conflicts: (Conflict & { answer?: Answer })[] }[], user: string): Promise<Took | null> {
  const name = b.name;
  if (await fixUnavailable(env, owner, repo, name)) return null;
  const picks = structuredClone(resolve);
  for (const f of left) for (const c of f.conflicts) picks[f.path] = { ...picks[f.path], [c.line]: c.answer?.ok && c.answer.text !== undefined ? { text: c.answer.text } : "branch" };
  const dry: { path: string; rev: number; ops?: Op[] }[] = [];
  for (const f of rows.filter((x) => !x.merged && !x.deleted && !x.blob)) {
    let m = await mergeFile(env, owner, repo, b, f.path, user, picks[f.path], true);
    for (let i = 1; m.conflicts.length && i < REBUILD_ROUNDS; i++) {
      for (const c of m.conflicts) picks[f.path] = { ...picks[f.path], [c.line]: "branch" };
      m = await mergeFile(env, owner, repo, b, f.path, user, picks[f.path], true);
    }
    if (m.conflicts.length) return null;
    dry.push({ path: f.path, rev: m.rev, ops: m.ops });
  }
  const clashes = left.flatMap((f) => f.conflicts.filter((c) => !(c.answer?.ok && c.answer.text !== undefined)).map((c) => ({ ...c, path: f.path })));
  const path = clashes[0]?.path ?? left[0]!.path;
  const editable = rows.filter((x) => !x.merged && !x.deleted && !x.blob).map((x) => x.path);
  const also = alsoFor(editable, path, left.map((f) => f.path).join("\n"));
  const fix = await openFix(env, owner, repo, name, path, rebuildTask(name, blocker, clashes), also, { before: async () => { await onMainCopies(env, owner, repo, b, dry); }, rebuild: blocker });
  return "id" in fix ? { branch: name, status: "rebuilding", files: left.map((f) => f.path), fix: fix.id } : null;
}

/**
 * Merge an open branch into main: a dry run first, so a conflict anywhere merges nothing (409),
 * then each file for real. `resolve` settles conflicts by line; `build_ok` lets build files land.
 */
async function mergeBranch(env: Env, owner: string, repo: string, branch: BranchRow, user: string, body: { resolve?: unknown; build_ok?: unknown }, req: Request): Promise<Response> {
  const name = branch.name;
  // build_ok is someone reading the build files: an API token (a prompt-injected agent may hold one) can't say it.
  if (body.build_ok && byToken(req)) return json({ error: "API tokens can't pass build_ok: read the build files and merge on the site, signed in" }, 403);
  // Protected main (#1426): someone other than a branch's author accepts it. The owner's merges are their own to make.
  if (user !== owner && user === branch.by && await protectOn(env, owner, repo)) return json({ error: "main is protected: someone other than the branch's author merges it", protected: true }, 403);
  // An agent run's batch is the owner's to land (its accept, or the timer, agent-routes.ts land()): the branch is in the owner's name,
  // so without this any crew member could pass it off as "someone other than the author" and land a held batch.
  const agentRun = /^agent-run-\d+$/.test(name);
  if (agentRun && user !== owner) return json({ error: "an agent run's batch lands when its owner accepts it (or its timer runs out), not on a crew merge" }, 403);
  const files = async () => ((await env.DB.prepare("SELECT path, merged, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as FileRow[]);
  // build_ok is a reader's word: the owner's, or someone other than the branch's author.
  const resolve = parseResolve(body.resolve), build_ok = body.build_ok && (user === owner || user !== branch.by);
  if (typeof resolve === "string") return json({ error: resolve }, 400);
  // Stacked on a branch that's still open: that one's changes are in this one's copies, so it goes first.
  const under = (await ancestors(env, owner, repo, name))[0];
  if (under) return json({ error: `${name} is stacked on ${under}: merge ${under} first` }, 409);
  const stuck = (await env.DB.prepare("SELECT path, source FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND source IS NOT NULL ORDER BY path").bind(owner, repo, name).all()).results as { path: string; source: string }[];
  if (stuck.length) return json({ error: `${stuck.map((f) => f.path).join(", ")} forked from ${stuck[0]!.source}'s copies and didn't move onto main cleanly when it merged: copy your changes into a branch off main`, files: stuck.map((f) => f.path) }, 409);
  const rows = await files(), todo = rows.filter((f) => !f.merged);
  // Build or deploy files on a merge the owner's next commit would ship: read them first.
  const build = todo.map((f) => f.path).filter(isBuildFile);
  // An agent's batch touching them waits for an accept whatever the deploy setting: codesplitter.ci and .gitattributes drive what runs and who may edit what.
  if (build.length && !build_ok && (agentRun || (await deploySettings(env, owner, repo)).on_commit)) return json({ error: "this branch changes build or deploy files: read them, then merge with build_ok (the owner, or someone other than the branch's author)", build }, 409);
  // Required checks that failed, or haven't finished, hold it, as a GitHub branch protection rule would.
  const held = await mergeBlock(env, owner, repo, name);
  if (held) return json(held, 409);
  // A binary (or too big) file has no lines to merge: one main changed too since the branch left it waits, not overwritten.
  const { blobMovedOnMain } = await import("./mirror.ts");
  const moved = (await Promise.all(todo.filter((f) => f.blob && !f.deleted).map(async (f) => await blobMovedOnMain(env, owner, repo, name, f.path, f.blob!) ? f.path : null))).filter((p): p is string => !!p);
  if (moved.length) return json({ error: `main changed ${moved.join(", ")} too, and it has no lines to merge: bring main into the branch upstream, then pull`, files: moved }, 409);
  // A dry run first, so a conflict anywhere merges nothing.
  const run = await dryRun(env, owner, repo, branch, rows, resolve, user);
  if ("blocked" in run) return json(run.blocked, 409);
  // The open branches that clash with this one (merge-plan.ts), read before main moves: each takes main in after (#1162).
  const others = (await openBranches(env, owner, repo)).filter((b) => b.name !== name && b.parent !== name);
  const clashing = others.length ? await clashesIn(env, owner, repo, [name, ...others.map((b) => b.name)], user, name).catch(() => []) : [];

  const took: Took[] = [];
  const merged: { path: string; rev: number; ops: number; deleted?: true; binary?: true }[] = [], conflicts: { path: string; conflicts: Conflict[] }[] = [];
  let solved = 0;
  const learned: LearnEvent[] = [];
  const outcome: { path: string; picks?: Record<string, unknown>; solved?: number }[] = [];
  for (const f of todo) {
    // Claim the file, so two merges at once can't both apply it.
    const claim = await env.DB.prepare("UPDATE branch_files SET merged = 1 WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND merged = 0").bind(owner, repo, name, f.path).run();
    if (!claim.meta?.changes) continue;
    if (f.deleted) {
      await deleteOnMain(env, owner, repo, f.path, user, `Delete ${f.path}, merging ${name}`);
      merged.push({ path: f.path, rev: 0, ops: 0, deleted: true });
      continue;
    }
    if (f.blob) {
      try { await blobOnMain(env, owner, repo, { path: f.path, blob: f.blob, mode: f.mode }, user, `${f.path}, merging ${name}`); }
      catch (e) {
        await env.DB.prepare("UPDATE branch_files SET merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, f.path).run();
        throw e;
      }
      merged.push({ path: f.path, rev: 0, ops: 0, binary: true });
      continue;
    }
    // A file new on the branch becomes a file on main.
    const onMain = await materialize(env, owner, repo, f.path);
    if ("error" in onMain && onMain.status === 404) await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, f.path).run();
    const m = await mergeFile(env, owner, repo, branch, f.path, user, resolve[f.path], false);
    if (m.status === 200) {
      merged.push({ path: f.path, rev: m.rev, ops: m.ops?.length ?? 0 }); solved += m.solved ?? 0; outcome.push({ path: f.path, picks: resolve[f.path], solved: m.solved });
      if (resolve[f.path]) learned.push({ path: f.path, outcome: "asked" }); else if (m.solved) learned.push({ path: f.path, outcome: "settled" });
      continue;
    }
    // Main moved into a conflict between the dry run and now: this file waits for another merge.
    await env.DB.prepare("UPDATE branch_files SET merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, f.path).run();
    conflicts.push({ path: f.path, conflicts: m.conflicts });
  }
  if (!conflicts.length) {
    const at = Date.now();
    await env.DB.prepare("UPDATE branches SET status = 'merged', merged_by = ?, merged_at = ? WHERE owner = ? AND repo = ? AND name = ?").bind(user, at, owner, repo, name).run();
    await env.DB.prepare("DELETE FROM leftover_answers WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, name).run();
    await restackChildren(env, owner, repo, name);
    await countMerge(env, solved);
    await recordEvents(env, owner, repo, learned);
    await emitOutcome(env, owner, repo, outcome);
    for (const c of clashing) took.push(await afterBlocker(env, owner, repo, c.then, name, user).catch((e) => ({ branch: c.then, status: "failed" as const, error: String((e as Error)?.message ?? e) })));
    // Shaped like a merged pull request, the branch as its head. Git hears about it at the next commit of main.
    await emit(env, owner, repo, "branch.merged", user, {
      action: "closed",
      pull_request: { merged: true, merged_at: new Date(at).toISOString(), merged_by: { login: user }, user: { login: branch.by }, head: { ref: name }, base: { ref: "main" } },
      files: merged.map((m) => m.path),
    });
  }
  const docs = conflicts.length ? [] : await rebuilt(env, owner, repo, merged.filter((m) => !m.deleted && !m.binary).map((m) => m.path), run.dry, user);
  return json({ status: conflicts.length ? "open" : "merged", merged, conflicts, ...(docs.length && { regenerated: docs }), ...(took.length && { took }) }, conflicts.length ? 409 : 200);
}

/**
 * Which of the open branches in `order` clash, on the files two or more of them change (merge-plan.ts): each pair
 * in that order, the first merging first. With `first`, only that branch's clashes with the others.
 */
async function clashesIn(env: Env, owner: string, repo: string, order: string[], user: string, first?: string): Promise<Clash[]> {
  const rows = (await env.DB.prepare("SELECT branch, path, deleted, blob FROM branch_files WHERE owner = ? AND repo = ? AND merged = 0").bind(owner, repo).all()).results as { branch: string; path: string; deleted: number; blob: string | null }[];
  const on = new Map<string, typeof rows>();
  for (const r of rows) if (order.includes(r.branch) && !r.deleted) on.set(r.path, [...on.get(r.path) ?? [], r]);
  const clashes = new Map<string, Clash>();
  const clash = (x: string, y: string, path: string) => {
    if (first && x !== first) return;
    (clashes.get(`${x}\n${y}`) ?? clashes.set(`${x}\n${y}`, { first: x, then: y, files: [] }).get(`${x}\n${y}`)!).files.push(path);
  };
  const rank = (b: string) => order.indexOf(b);
  for (const [path, touched] of on) {
    if (touched.length < 2 || (first && !touched.some((t) => t.branch === first))) continue;
    touched.sort((x, y) => rank(x.branch) - rank(y.branch));
    // A binary file has no lines to merge: the second to change it waits for the first, as its merge would.
    const text = touched.filter((t) => !t.blob);
    for (const [i, x] of touched.entries()) for (const y of touched.slice(i + 1)) if (x.blob && y.blob) clash(x.branch, y.branch, path);
    if (text.length < 2 || (first && !text.some((t) => t.branch === first))) continue;
    const read = async (op: string, branch?: string) => { const res = await toFile(env, owner, repo, path, user, op, {}, "", branch); return (res.ok && await res.json() as Doc | null) || empty(); };
    const [main, policy, ...sides] = await Promise.all([read("file"), pathPolicy(env, owner, repo, path, user),
      ...text.map(async (t) => ({ base: await read("base", t.branch), copy: await read("file", t.branch) }))]) as [Doc, Policy, ...Side[]];
    for (const [i, x] of text.entries()) for (const [j, y] of text.entries())
      if (j > i && (!first || x.branch === first) && clashIn(path, main, sides[i]!, sides[j]!, policy.merge).length) clash(x.branch, y.branch, path);
  }
  return [...clashes.values()];
}

/** Keep the open branches `branch` waits for in the merge plan (#1162): till they've merged, its own checks wait. */
async function waitFor(env: Env, owner: string, repo: string, branch: string, on: string[]) {
  const v = on.length ? JSON.stringify(on) : null;
  await env.DB.prepare("UPDATE branches SET waits_on = ? WHERE owner = ? AND repo = ? AND name = ? AND waits_on IS NOT ?").bind(v, owner, repo, branch, v).run();
}

/**
 * The merge plan (#1155): the open branches in waves, each wave merging together, a branch waiting for any
 * before it that it clashes with (merge-plan.ts). They go in the order the bulk merge takes them, oldest
 * first, the ones whose required checks passed ahead of the ones they hold. Only files two branches both
 * change are merged in the dry run: a branch on files nobody else touches clashes with nothing.
 */
async function mergePlan(env: Env, owner: string, repo: string, user: string) {
  const open = await openBranches(env, owner, repo);
  const held = new Set((await Promise.all(open.map(async (b) => await mergeBlock(env, owner, repo, b.name) ? b.name : null))).filter((n) => n !== null));
  // A stacked branch can't merge before the one it's on, so that one comes first whatever its age.
  const order: string[] = [], parent = new Map(open.map((b) => [b.name, b.parent]));
  const place = (b: string) => { if (order.includes(b)) return; const on = parent.get(b); if (on && parent.has(on)) place(on); order.push(b); };
  for (const b of [...open.filter((b) => !held.has(b.name)), ...open.filter((b) => held.has(b.name))]) place(b.name);
  const clashes = new Map<string, Clash>();
  // A stacked branch waits for the one it's on: its merge refuses until then.
  for (const b of open) if (b.parent && parent.has(b.parent)) clashes.set(`${b.parent}\n${b.name}`, { first: b.parent, then: b.name, files: [], stacked: true });
  for (const c of await clashesIn(env, owner, repo, order, user)) clashes.set(`${c.first}\n${c.then}`, { ...clashes.get(`${c.first}\n${c.then}`), ...c });
  const plan = waves(order, [...clashes.values()]);
  // What each branch waits for, kept: its own checks wait till those have merged and it's taken main in (#1162).
  for (const p of plan.flat()) await waitFor(env, owner, repo, p.branch, p.after.filter((a) => !a.stacked).map((a) => a.branch));
  return { engine: MERVIN.name, order, held: [...held], waves: plan };
}

/**
 * The dispatch hint (#1163): before a task starts, the files it will likely touch (`files`, plus those its
 * text names, merge-plan.ts taskFiles) and the open branches already rewriting any of them. A queue can
 * hold the task till those merge, or stack it on the first (POST .../branches {name, parent}).
 */
export async function dispatchHint(env: Env, owner: string, repo: string, task: string, files: string[] = []): Promise<{ files: string[]; busy: Busy[] }> {
  const changed = (await env.DB.prepare("SELECT b.name AS branch, f.path FROM branch_files f JOIN branches b ON b.owner = f.owner AND b.repo = f.repo AND b.name = f.branch WHERE f.owner = ? AND f.repo = ? AND f.merged = 0 AND b.status = 'open'").bind(owner, repo).all()).results as { branch: string; path: string }[];
  const onMain = (await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ?").bind(owner, repo).all()).results as { path: string }[];
  const paths = [...new Set([...onMain.map((f) => f.path), ...changed.map((c) => c.path)])];
  const guess = [...new Set([...files, ...taskFiles(task, paths)])].sort();
  return { files: guess, busy: busyOn(guess, changed) };
}

export async function branchRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null, a: Access): Promise<Response | null> {
  // POST /api/repos/:o/:r/merges {branches?, build_ok?}  merge every open branch (or those named) that
  // merges clean, oldest first. Each merges against main as the last one left it, so two that change
  // different lines (a README edit, a package.json bump) both land; one that conflicts, or that its
  // checks hold, stays open and says why.
  if (p[4] === "merges" && !p[5] && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    const b = await readBody<"branches" | "build_ok">(req);
    const named = b.branches;
    if (named !== undefined && !(Array.isArray(named) && named.every((x): x is string => typeof x === "string"))) return json({ error: "branches: [name]" }, 400);
    const open = await openBranches(env, owner, repo);
    const todo = named ? open.filter((r) => named.includes(r.name)) : open;
    const merged: string[] = [];
    const skipped: { branch: string; error: string; files?: string[] }[] = (named ?? []).filter((n) => !todo.some((r) => r.name === n)).map((n) => ({ branch: n, error: "no open branch" }));
    for (const br of todo) {
      const name = br.name;
      // A branch with nothing on it yet is someone's work about to start: leave it open.
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0").bind(owner, repo, name).first() as { n: number } | null;
      if (!left?.n) { skipped.push({ branch: name, error: "nothing to merge" }); continue; }
      const res = await mergeBranch(env, owner, repo, br, user!, { build_ok: b.build_ok }, req);
      const out = (await res.json()) as { error?: string; conflicts?: { path: string }[]; build?: string[] };
      if (res.ok) merged.push(name);
      else skipped.push({ branch: name, error: out.error ?? "conflicts", ...((out.conflicts?.length || out.build) && { files: out.build ?? out.conflicts!.map((c) => c.path) }) });
    }
    return json({ merged, skipped });
  }
  // GET /api/repos/:o/:r/merge-plan  the open branches in waves (merge-plan.ts).
  if (p[4] === "merge-plan" && !p[5] && req.method === "GET") return json(await mergePlan(env, owner, repo, user ?? "anon"));
  // GET|PUT|DELETE /api/repos/:o/:r/mervin  Mervin's learning: the opt-in, the weekly report, delete-my-data (mervin-learning.ts).
  if (p[4] === "mervin" && !p[5]) {
    if (req.method === "GET") return json(await learningState(env, owner, repo));
    if (req.method === "PUT" || req.method === "DELETE") {
      if (user !== owner) return json({ error: "only the owner changes this" }, 403);
      if (req.method === "DELETE") return json({ ok: true, deleted: await deleteLearning(env, owner, repo) });
      const b = await readBody<"learning">(req);
      if (typeof b.learning !== "boolean") return json({ error: "learning: true | false" }, 400);
      await setLearning(env, owner, repo, b.learning);
      return json(await learningState(env, owner, repo));
    }
  }
  // GET|POST /api/repos/:o/:r/board  the live board (board-routes.ts).
  if (p[4] === "board" && !p[5] && (req.method === "GET" || req.method === "POST")) return boardRoutes(req, env, owner, repo, a.write);
  // GET /api/repos/:o/:r/dispatch-hint?task=&paths=a,b  which open branches a new task's files are already on (dispatchHint).
  if (p[4] === "dispatch-hint" && !p[5] && req.method === "GET") {
    const q = new URL(req.url).searchParams;
    return json(await dispatchHint(env, owner, repo, (q.get("task") ?? "").slice(0, 20_000), (q.get("paths") ?? "").split(",").filter(Boolean)));
  }
  if (p[4] !== "branches") return null;
  const name = p[5];

  // GET /api/repos/:o/:r/branches
  if (!name && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT name, by, status, parent, created_at, merged_by, merged_at, upstream_ref FROM branches WHERE owner = ? AND repo = ? ORDER BY created_at DESC").bind(owner, repo).all();
    return json(results);
  }
  // POST /api/repos/:o/:r/branches {name, parent?}  parent: an open branch to stack this one on (#1025)
  if (!name && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    const { name: b, parent } = await readBody<"name" | "parent">(req);
    if (typeof b !== "string") return json({ error: `bad branch name: ${branchNameError("")}` }, 400);
    const bad = branchNameError(b);
    if (bad) return json({ error: `bad branch name: ${bad}` }, 400);
    if (parent !== undefined && parent !== null && (typeof parent !== "string" || !(await openBranch(env, owner, repo, parent)))) return json({ error: `parent: no open branch ${parent}` }, 404);
    const on = typeof parent === "string" ? parent : null;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at, parent) VALUES (?, ?, ?, ?, 'open', ?, ?)").bind(owner, repo, b, user, Date.now(), on).run();
    if (!r.meta?.changes) return json({ error: "branch exists" }, 409);
    await emit(env, owner, repo, "branch.opened", user!, { ref: b, ref_type: "branch", master_branch: on ?? "main" });
    return json({ name: b, by: user, status: "open", parent: on }, 201);
  }

  const branch = name && await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  if (!branch) return json({ error: "no such branch" }, 404);
  const files = async () => ((await env.DB.prepare("SELECT path, merged, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as { path: string; merged: number; deleted: number; blob: string | null; mode: string | null }[]);

  // DELETE /api/repos/:o/:r/branches/:b/files?path=  delete a file on the branch; merging deletes it from main.
  if (p[6] === "files" && req.method === "DELETE") {
    if (!a.write) return json({ error: "no write access" }, 403);
    if (branch.status !== "open") return json({ error: `branch is ${branch.status}` }, 409);
    const path = new URL(req.url).searchParams.get("path") ?? "";
    if (!path) return json({ error: "path?" }, 400);
    return deleteOn(env, owner, repo, name, path);
  }

  // GET /api/repos/:o/:r/branches/:b  the review: each file's ops against main now, and its conflicts.
  // A file that runs at build or deploy time says so, with its changed lines spelled out,
  // and `deploys` says whether the owner's commit after this merge would ship.
  if (!p[6] && req.method === "GET") {
    // A merge's agent answers to its leftovers (#1012), for the crew: one quotes the file's lines.
    const kept = a.write ? await keptAnswers(env, owner, repo, name) : new Map();
    const out = await Promise.all((await files()).map(async (f) => {
      const build = isBuildFile(f.path);
      if (f.merged) return { path: f.path, merged: true, build, ops: [], conflicts: [], ...(f.deleted && { deleted: true }) };
      if (f.deleted) return { path: f.path, merged: false, build, deleted: true, ops: [], conflicts: [] };
      // Binary: no lines to show, only that it changed.
      if (f.blob) return { path: f.path, merged: false, build, binary: true, blob: f.blob, ops: [], conflicts: [] };
      const m = await mergeFile(env, owner, repo, branch, f.path, user ?? "anon", undefined, true);
      let ops = m.ops ?? [], conflicts = m.conflicts;
      if (!a.write) {
        // Outside the crew, main's private lines stay blank here too.
        const secret = new Set(await (await toFile(env, owner, repo, f.path, "upstream", "private")).json() as string[]);
        ops = ops.map((o: any) => o.kind === "set" && secret.has(o.line) ? { ...o, text: "" } : o);
        conflicts = conflicts.map((c) => secret.has(c.line) ? { ...c, base: "", main: c.main === null ? null : "", branch: c.branch === null ? null : "" } : c);
      }
      const lines = build ? changedLines(await (await toFile(env, owner, repo, f.path, user ?? "anon", "file")).json() as Doc, ops) : undefined;
      // What the branch itself changed, a stretch at a time, to accept or reject (#735).
      const changed = (await fileHunks(env, owner, repo, name, f.path, user ?? "anon", a.write)).hunks;
      const shown = await Promise.all(conflicts.map(async (c) => { const answer = await answerFor(kept, f.path, c); return { ...explain(c), ...(answer && { answer }) }; }));
      // Prose that settled faithful to both sides, which may now state something one side changed (#1254).
      // For the crew: a stretch can hold main's private lines.
      const checks = a.write ? (m.checks ?? []).map(explain) : [];
      return { path: f.path, merged: false, build, policy: m.policy, ops, conflicts: shown, hunks: changed, ...(checks.length && { checks }), ...(lines && { lines }) };
    }));
    return json({ ...branch, deploys: (await deploySettings(env, owner, repo)).on_commit, checks: await refChecks(env, owner, repo, name), files: out });
  }

  // GET /api/repos/:o/:r/branches/:b/hunks?path=  what the branch changed in one file, as hunks against where it forked.
  if (p[6] === "hunks" && !p[7] && req.method === "GET") {
    const path = new URL(req.url).searchParams.get("path") ?? "";
    const f = (await files()).find((x) => x.path === path && !x.merged && !x.deleted && !x.blob);
    if (!f) return json({ path, hunks: [] });
    return json({ path, hunks: (await fileHunks(env, owner, repo, name, path, user ?? "anon", a.write)).hunks });
  }
  // POST /api/repos/:o/:r/branches/:b/hunks/reject {path, key}  put one hunk back as it was where the branch forked.
  if (p[6] === "hunks" && p[7] === "reject" && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    if (branch.status !== "open") return json({ error: `branch is ${branch.status}` }, 409);
    const b = await readBody<"path" | "key">(req);
    const f = typeof b.path === "string" && (await files()).find((x) => x.path === b.path && !x.merged && !x.deleted && !x.blob);
    const got = f && await fileHunks(env, owner, repo, name, f.path, user!, true);
    const h = got && got.hunks.find((x) => x.key === b.key);
    if (!f || !got || !h) return json({ error: `no change ${b.key} in ${b.path} on ${name}: read the review again` }, 404);
    const res = await toFile(env, owner, repo, f.path, user!, "ops", { method: "POST", body: JSON.stringify({ ops: revertOps(got.doc, h), ifRev: got.doc.rev }) }, "", name);
    const out = await res.json() as { rev: number };
    return res.ok ? json({ path: f.path, key: h.key, rev: out.rev }) : json({ error: "the branch changed under you: read the review again", ...out }, 409);
  }

  // POST /api/repos/:o/:r/branches/:b/conflicts/agent {path, line, harness, model?}
  // A coding agent writes the settled text for one conflict: {text}, to merge with as {text}. Nothing lands.
  if (p[6] === "conflicts" && p[7] === "agent" && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    const why = agentsUnavailable(env);
    if (why) return json({ error: why }, 501);
    if (adminsOnly(env, user)) return json({ error: ADMINS_ONLY }, 403);
    const b = await readBody<"path" | "line" | "harness" | "model">(req);
    const harness = HARNESSES.find((x) => x === b.harness);
    if (!harness) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
    if (!installedHarnesses(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
    if (typeof b.path !== "string" || typeof b.line !== "string" || !b.path || !b.line) return json({ error: "path and line: a conflict the review lists" }, 400);
    if (b.model !== undefined && b.model !== null && typeof b.model !== "string") return json({ error: "model: text" }, 400);
    const rows = await files();
    const f = rows.find((x) => x.path === b.path && !x.merged && !x.deleted && !x.blob);
    const m = f && await mergeFile(env, owner, repo, branch, f.path, user!, undefined, true);
    // A fact check (#1254) is asked about as a conflict is: the stretch both changed, to settle true.
    const c = m && [...m.conflicts, ...m.checks ?? []].find((x) => x.line === b.line);
    if (!c) return json({ error: `no conflict ${b.line} in ${b.path} on ${name}` }, 404);
    if (!explain(c).choices.includes("text")) return json({ error: "this conflict only takes main or branch" }, 400);
    const spent = await hostedBudget(env);
    if (spent) return spent;
    const r = await checkedAnswer(env, owner, repo, branch, rows, b.path, c, { harness, model: b.model?.trim() || undefined }, user!, req.signal);
    if ("error" in r) return json({ error: r.error }, 502);
    return json({ path: b.path, line: b.line, ...r });
  }

  // POST /api/repos/:o/:r/branches/:b/merge {resolve?: {path: {lineId: pick}}}, a pick being
  // "main", "branch", "both", "both:branch-first" or {text}
  if (p[6] === "merge" && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    if (branch.status !== "open") return json({ error: `branch is ${branch.status}` }, 409);
    return mergeBranch(env, owner, repo, branch, user!, await readBody<"resolve" | "build_ok">(req), req);
  }
  return null;
}
