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

import { apply, empty, explain, fromText, merge, PICKS, text, type Conflict, type Doc, type Line, type Op, type Pick, type Resolve } from "./lines.ts";
import { lintMerge } from "./lint.ts";
import { policyOf, type Policy, type Rule } from "./policy.ts";
import { conflictNote, conflictRound } from "./budget.ts";
import { regenerateLock, tryInClone } from "./deps.ts";
import { catalogueBlob, materialize, toFile, uncatalogue } from "./archive.ts";
import { changedLines, isBuildFile } from "./buildfiles.ts";
import { mergeBlock, refChecks } from "./checks.ts";
import { settings as deploySettings } from "./deploy.ts";
import { branchNameError, json, type Env, readBody } from "./env.ts";
import { emit } from "./hooks.ts";
import { diffToOps, keptPairs } from "./sync.ts";
import { unindexFile } from "./search.ts";
import { HARNESSES, type Harness } from "./harness.ts";
import { localSandbox, type Exec } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { ADMINS_ONLY, adminsOnly, agentsUnavailable, hostedBudget, installedHarnesses } from "./agent-routes.ts";
import { askAgent, cheapest } from "./conflict-agent.ts";
import { guardTripped, healUnavailable } from "./heal.ts";
import { hunks, revertOps } from "./review.ts";

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
  const b = await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  return b?.status === "open" ? b : null;
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

/** Main takes the branch's binary `path` (#446): its bytes, from the mirror's git, into main's git (and upstream's, at the next sync). */
async function blobOnMain(env: Env, owner: string, repo: string, f: { path: string; blob: string; mode: string | null }, user: string, message: string) {
  const { blobBytes, kickMirror } = await import("./mirror.ts");
  const bytes = await blobBytes(env, owner, repo, f.blob);
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
  return { status: res.status, policy, ...(await res.json() as { rev: number; ops?: Op[]; conflicts: Conflict[] }) };
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

type BranchRow = { name: string; by: string; created_at?: unknown; upstream_ref?: unknown };
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
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([c.line, c.base, c.main, c.branch])));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
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
    if (who === "escalate") { notes.set(f.path, `conflict round ${round} on ${branch.name}: a person's turn\n${note}`); continue; }
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
 * A merge that settled with no card, checked further where the file's policy says `tests` (#1096): the lint
 * can't see a key or string one side renamed and the other still uses. Each such file both sides changed
 * since the branch forked runs the repo's tests on the merged tree in a throwaway clone, as an agent's answer
 * does, only those files' tests where the runner can tell. A failure is a `lint:tests` conflict on each, and
 * settled as the branch it lands anyway. Null when it passed, or nothing needed the run, or it can't run here.
 */
async function testedMerge(env: Env, owner: string, repo: string, branch: BranchRow, dry: { path: string; policy: Policy; ops?: Op[] }[], resolve: Record<string, Resolve>, user: string) {
  // A file new on the branch has no copy on main yet: it starts empty.
  const read = async (path: string, op: string, on?: string) => {
    const res = await toFile(env, owner, repo, path, user, op, {}, "", on);
    return (res.ok && await res.json() as Doc | null) || empty();
  };
  const asked = dry.filter((d) => d.policy.check === "tests" && d.ops?.length && resolve[d.path]?.["lint:tests"] !== "branch");
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
 * Merge an open branch into main: a dry run first, so a conflict anywhere merges nothing (409),
 * then each file for real. `resolve` settles conflicts by line; `build_ok` lets build files land.
 */
async function mergeBranch(env: Env, owner: string, repo: string, branch: BranchRow, user: string, body: { resolve?: unknown; build_ok?: unknown }): Promise<Response> {
  const name = branch.name;
  const files = async () => ((await env.DB.prepare("SELECT path, merged, deleted, blob, mode FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as FileRow[]);
  const resolve = parseResolve(body.resolve), build_ok = body.build_ok;
  if (typeof resolve === "string") return json({ error: resolve }, 400);
  // Stacked on a branch that's still open: that one's changes are in this one's copies, so it goes first.
  const under = (await ancestors(env, owner, repo, name))[0];
  if (under) return json({ error: `${name} is stacked on ${under}: merge ${under} first` }, 409);
  const stuck = (await env.DB.prepare("SELECT path, source FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0 AND source IS NOT NULL ORDER BY path").bind(owner, repo, name).all()).results as { path: string; source: string }[];
  if (stuck.length) return json({ error: `${stuck.map((f) => f.path).join(", ")} forked from ${stuck[0]!.source}'s copies and didn't move onto main cleanly when it merged: copy your changes into a branch off main`, files: stuck.map((f) => f.path) }, 409);
  const rows = await files(), todo = rows.filter((f) => !f.merged);
  // Build or deploy files on a merge the owner's next commit would ship: read them first.
  const build = todo.map((f) => f.path).filter(isBuildFile);
  if (build.length && !build_ok && (await deploySettings(env, owner, repo)).on_commit) return json({ error: "this branch changes build or deploy files: read them, then merge with build_ok", build }, 409);
  // Required checks that failed, or haven't finished, hold it, as a GitHub branch protection rule would.
  const held = await mergeBlock(env, owner, repo, name);
  if (held) return json(held, 409);
  // A binary (or too big) file has no lines to merge: one main changed too since the branch left it waits, not overwritten.
  const { blobMovedOnMain } = await import("./mirror.ts");
  const moved = (await Promise.all(todo.filter((f) => f.blob && !f.deleted).map(async (f) => await blobMovedOnMain(env, owner, repo, name, f.path, f.blob!) ? f.path : null))).filter((p): p is string => !!p);
  if (moved.length) return json({ error: `main changed ${moved.join(", ")} too, and it has no lines to merge: bring main into the branch upstream, then pull`, files: moved }, 409);
  // A dry run first, so a conflict anywhere merges nothing. A deletion never conflicts.
  const dry = await Promise.all(todo.filter((f) => !f.deleted && !f.blob).map(async (f) => ({ path: f.path, ...(await mergeFile(env, owner, repo, branch, f.path, user, resolve[f.path], true)) })));
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
    return json({ error: broken.length ? `merged, it wouldn't build: ${broken.join("; ")}` : "conflicts", conflicts: blocked, ...(fix && "id" in fix && { fix: fix.id }) }, 409);
  }
  const failed = await testedMerge(env, owner, repo, branch, dry, resolve, user);
  if (failed) return json(failed, 409);

  const merged: { path: string; rev: number; ops: number; deleted?: true; binary?: true }[] = [], conflicts: { path: string; conflicts: Conflict[] }[] = [];
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
    if (m.status === 200) { merged.push({ path: f.path, rev: m.rev, ops: m.ops?.length ?? 0 }); continue; }
    // Main moved into a conflict between the dry run and now: this file waits for another merge.
    await env.DB.prepare("UPDATE branch_files SET merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, f.path).run();
    conflicts.push({ path: f.path, conflicts: m.conflicts });
  }
  if (!conflicts.length) {
    const at = Date.now();
    await env.DB.prepare("UPDATE branches SET status = 'merged', merged_by = ?, merged_at = ? WHERE owner = ? AND repo = ? AND name = ?").bind(user, at, owner, repo, name).run();
    await env.DB.prepare("DELETE FROM leftover_answers WHERE owner = ? AND repo = ? AND branch = ?").bind(owner, repo, name).run();
    await restackChildren(env, owner, repo, name);
    // Shaped like a merged pull request, the branch as its head. Git hears about it at the next commit of main.
    await emit(env, owner, repo, "branch.merged", user, {
      action: "closed",
      pull_request: { merged: true, merged_at: new Date(at).toISOString(), merged_by: { login: user }, user: { login: branch.by }, head: { ref: name }, base: { ref: "main" } },
      files: merged.map((m) => m.path),
    });
  }
  return json({ status: conflicts.length ? "open" : "merged", merged, conflicts }, conflicts.length ? 409 : 200);
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
    const open = (await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND status = 'open' ORDER BY created_at, name").bind(owner, repo).all()).results as { name: string; by: string }[];
    const todo = named ? open.filter((r) => named.includes(r.name)) : open;
    const merged: string[] = [];
    const skipped: { branch: string; error: string; files?: string[] }[] = (named ?? []).filter((n) => !todo.some((r) => r.name === n)).map((n) => ({ branch: n, error: "no open branch" }));
    for (const br of todo) {
      const name = br.name;
      // A branch with nothing on it yet is someone's work about to start: leave it open.
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND merged = 0").bind(owner, repo, name).first() as { n: number } | null;
      if (!left?.n) { skipped.push({ branch: name, error: "nothing to merge" }); continue; }
      const res = await mergeBranch(env, owner, repo, br, user!, { build_ok: b.build_ok });
      const out = (await res.json()) as { error?: string; conflicts?: { path: string }[]; build?: string[] };
      if (res.ok) merged.push(name);
      else skipped.push({ branch: name, error: out.error ?? "conflicts", ...((out.conflicts?.length || out.build) && { files: out.build ?? out.conflicts!.map((c) => c.path) }) });
    }
    return json({ merged, skipped });
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
      return { path: f.path, merged: false, build, policy: m.policy, ops, conflicts: shown, hunks: changed, ...(lines && { lines }) };
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
    const c = f && (await mergeFile(env, owner, repo, branch, f.path, user!, undefined, true)).conflicts.find((x) => x.line === b.line);
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
    return mergeBranch(env, owner, repo, branch, user!, await readBody<"resolve" | "build_ok">(req));
  }
  return null;
}
