// Revert and cherry-pick (#880), from a dot on the commit graph. Neither runs git:
// what a commit changed (its tree against its first parent's) is merged into each
// file's lines as they are now, three ways (sync.ts merge3), and lands as line ops
// by whoever pressed it, so every line it doesn't touch keeps its id and its blame.
// A revert merges the commit's after back to its before; a pick its before to its
// after. On main the files are committed as one git commit, git's own wording and
// all; on an open branch the edits wait for the branch to merge, like any other.
// A dry run comes first, so a clash anywhere (lines changed since, a file deleted
// or made since, a binary file) lands nothing.
//
//   POST /api/repos/:o/:r/commits/:sha/revert {branch?}
//   POST /api/repos/:o/:r/commits/:sha/pick {branch?}

import { fromText, type Doc } from "./lines.ts";
import { handleFor, materialize, pushCatalogues, toFile, MAX_BYTES } from "./archive.ts";
import { createOn, deleteOn, materializeOn, openBranch } from "./branches.ts";
import { fromDisk } from "./agent-run.ts";
import { startChecks } from "./checks.ts";
import { deployOnCommit } from "./deploy.ts";
import { code, json, type ArtifactsRepo, type CommitMeta, type Env, type TreeEntry } from "./env.ts";
import { emit } from "./hooks.ts";
import { kickMirror, landPushes, mirrorsOn, pushHolds } from "./mirror.ts";
import { indexFile, unindexFile } from "./search.ts";
import { diffToOps, merge3 } from "./sync.ts";

export type PickKind = "revert" | "pick";
/** One file a commit changed: its lines before and after (null: it wasn't there), or that it's binary or too big. */
export interface Change { path: string; before: string[] | null; after: string[] | null; binary?: true }

/** The most files one revert or pick takes. */
const MAX_FILES = 100;

/** What `hash` changed against its first parent, file by file; null for a commit this repo hasn't got. */
export async function commitChanges(handle: Pick<ArtifactsRepo, "readCommit" | "readTree" | "readBlob">, hash: string): Promise<{ commit: CommitMeta; changes: Change[]; more: boolean } | null> {
  const commit = await handle.readCommit(hash).catch(() => null);
  if (!commit) return null;
  const parent = commit.parents[0] ? await handle.readCommit(commit.parents[0]).catch(() => null) : null;
  const changes: Change[] = [];
  let more = false;
  const read = async (e: TreeEntry | undefined): Promise<string[] | null | "binary"> => {
    if (!e) return null;
    if (e.type === "gitlink" || e.type === "symlink") return "binary";
    const b = await handle.readBlob(e.hash);
    if (!b) return null;
    if (b.size > MAX_BYTES) return "binary";
    const t = await b.text();
    return t.includes("\0") ? "binary" : fromDisk(t);
  };
  const walk = async (a: string | null, b: string | null, dir: string): Promise<void> => {
    const [ea, eb] = await Promise.all([a ? handle.readTree(a) : null, b ? handle.readTree(b) : null]);
    const left = new Map((ea ?? []).map((e) => [e.name, e])), right = new Map((eb ?? []).map((e) => [e.name, e]));
    for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const x = left.get(name), y = right.get(name), path = dir ? `${dir}/${name}` : name;
      if (x?.hash === y?.hash && x?.mode === y?.mode) continue;
      if (changes.length >= MAX_FILES) { more = true; return; }
      const xt = x?.type === "tree" ? x.hash : null, yt = y?.type === "tree" ? y.hash : null;
      if (xt || yt) await walk(xt, yt, path);
      const xf = xt ? undefined : x, yf = yt ? undefined : y;
      if (!xf && !yf) continue;
      const [before, after] = await Promise.all([read(xf), read(yf)]);
      if (before === "binary" || after === "binary") changes.push({ path, before: null, after: null, binary: true });
      else changes.push({ path, before, after });
    }
  };
  await walk(parent?.treeHash ?? null, commit.treeHash, "");
  return { commit, changes, more };
}

/** What landing one change does to a file: edits it (`doc` to `next`), makes it, deletes it, or leaves it be. */
export type Step = { path: string; do: "edit"; doc: Doc; next: string[] } | { path: string; do: "make"; next: string[] } | { path: string; do: "delete" } | { path: string; do: "skip" };
export interface Clash { path: string; why: string }

/**
 * The step for one change, given the file as the target has it now (null: not there):
 * a revert goes from the commit's after to its before, a pick the other way.
 */
export function plan(kind: PickKind, c: Change, doc: Doc | null): Step | Clash {
  if (c.binary) return { path: c.path, why: "a binary file: it has no lines to undo or take" };
  const [base, want] = kind === "revert" ? [c.after, c.before] : [c.before, c.after];
  const lines = doc?.lines.map((l) => l.text) ?? null;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
  if (base === null) {
    // The file goes from nothing to `want`.
    if (!lines) return { path: c.path, do: "make", next: want! };
    return same(lines, want!) ? { path: c.path, do: "skip" } : { path: c.path, why: "made again since, with other lines" };
  }
  if (!lines) return want === null ? { path: c.path, do: "skip" } : { path: c.path, why: "deleted since" };
  if (want === null) return same(lines, base) ? { path: c.path, do: "delete" } : { path: c.path, why: "changed since: deleting it would lose those lines" };
  if (same(lines, want)) return { path: c.path, do: "skip" };
  const next = merge3(base, lines, want);
  return next ? { path: c.path, do: "edit", doc: doc!, next } : { path: c.path, why: "the same lines changed since" };
}

/** The commit message, as git writes it. */
export const pickMessage = (kind: PickKind, c: Pick<CommitMeta, "hash" | "message">) => {
  const subject = c.message.split("\n")[0]!;
  return kind === "revert" ? `Revert "${subject}"\n\nThis reverts commit ${c.hash}.` : `${subject}\n\n(cherry picked from commit ${c.hash})`;
};

/** POST .../commits/:sha/(revert|pick) {branch?}: the commit undone, or taken again, on main or an open branch. */
export async function pickRoute(env: Env, owner: string, repo: string, user: string, kind: PickKind, sha: string, body: { branch?: unknown }): Promise<Response> {
  const branch = typeof body.branch === "string" && body.branch && body.branch !== "main" ? body.branch : undefined;
  if (branch && !(await openBranch(env, owner, repo, branch))) return json({ error: `no open branch ${branch}` }, 404);
  if (!/^[0-9a-f]{4,64}$/.test(sha)) return json({ error: "a commit hash, please" }, 400);
  let h: Awaited<ReturnType<typeof handleFor>>;
  try { h = await handleFor(env, owner, repo); } catch (e) {
    if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ error: "still being dug up" }, 409);
    throw e;
  }
  if (!h) return json({ error: "this repo has no git" }, 404);
  const got = await commitChanges(h.handle, sha);
  if (!got) return json({ error: `no commit ${sha} here` }, 404);
  if (got.more) return json({ error: `it changed more than ${MAX_FILES} files: too many to ${kind === "revert" ? "revert" : "pick"} here` }, 413);
  // A push from outside reaches main's files first, so this merges into what git really has (#773).
  if (!branch && mirrorsOn(env)) await landPushes(env, owner, repo).catch(() => {});

  // The dry run: every file's step, or why it can't.
  const steps: Step[] = [], clashes: Clash[] = [];
  for (const c of got.changes) {
    const m = branch ? await materializeOn(env, owner, repo, branch, c.path) : await materialize(env, owner, repo, c.path);
    if ("error" in m && m.status !== 404) { clashes.push({ path: c.path, why: m.error }); continue; }
    const doc = "error" in m ? null : await (await toFile(env, owner, repo, c.path, user, "file", {}, "", branch)).json() as Doc;
    if (!branch && doc && mirrorsOn(env) && await pushHolds(env, owner, repo, c.path)) { clashes.push({ path: c.path, why: "a push to this repo's git clashes with it: settle that first" }); continue; }
    const s = plan(kind, c, doc);
    "why" in s ? clashes.push(s) : s.do !== "skip" && steps.push(s);
  }
  const what = kind === "revert" ? "revert" : "pick", short = got.commit.hash.slice(0, 7);
  if (clashes.length) return json({ error: `can't ${what} ${short}: ${clashes.map((c) => `${c.path} (${c.why})`).join(", ")}`, clashes }, 409);
  if (!steps.length) return json({ error: kind === "revert" ? `${short}'s changes aren't here any more: nothing to undo` : `${branch ?? "main"} has ${short}'s changes already` }, 409);

  // For real: line edits by whoever pressed it, each against the rev the dry run read.
  const message = pickMessage(kind, got.commit);
  for (const s of steps) {
    if (s.do === "edit") {
      const res = await toFile(env, owner, repo, s.path, user, "ops", { method: "POST", body: JSON.stringify({ ops: diffToOps(s.doc.lines, s.next), ifRev: s.doc.rev }) }, "", branch);
      if (!res.ok) return json({ error: `${s.path} was edited while this ran: try again`, landed: steps.slice(0, steps.indexOf(s)).map((x) => x.path) }, 409);
    } else if (s.do === "make") {
      if (branch) await createOn(env, owner, repo, branch, s.path, s.next.join("\n"), user);
      else {
        await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, s.path).run();
        await toFile(env, owner, repo, s.path, user, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(s.next.join("\n")) }) });
      }
    } else if (branch) await deleteOn(env, owner, repo, branch, s.path);
    else {
      await toFile(env, owner, repo, s.path, user, "wipe", { method: "POST" });
      await env.DB.batch(["files", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ? AND path = ?`).bind(owner, repo, s.path)));
      await unindexFile(env, owner, repo, s.path);
    }
  }
  const files = steps.map((s) => ({ path: s.path, did: s.do }));
  if (branch) return json({ kind, commit: got.commit.hash, branch, message, files });

  // Main: each file commits, and git gets them all as one commit.
  const catalogue: Record<string, { content: string; published: string } | null> = {};
  for (const s of steps) {
    if (s.do === "delete") { catalogue[s.path] = null; continue; }
    const res = await toFile(env, owner, repo, s.path, user, "commit", { method: "POST", body: JSON.stringify({ message }) });
    const { content, published } = (await res.json()) as { content: string; published: string };
    await indexFile(env, owner, repo, s.path, published);
    catalogue[s.path] = { content, published };
  }
  const git = await pushCatalogues(env, owner, repo, catalogue, user, message).catch((e: Error) => ({ error: e.message }));
  if (git && !("error" in git)) {
    const made = (d: Step["do"]) => steps.filter((s) => s.do === d).map((s) => s.path);
    await emit(env, owner, repo, "commit", user, {
      ref: "refs/heads/main", before: git.parent ?? "0".repeat(40), after: git.commit, created: !git.parent, pusher: { name: user },
      head_commit: { id: git.commit, message, timestamp: new Date().toISOString(), author: { name: user, username: user }, added: made("make"), modified: made("edit"), removed: made("delete") },
    });
    await deployOnCommit(env, owner, repo, user);
    await startChecks(env, owner, repo, "main", git.commit, user);
    await kickMirror(env, owner, repo);
  }
  return json({ kind, commit: got.commit.hash, branch: "main", message, files, git });
}
