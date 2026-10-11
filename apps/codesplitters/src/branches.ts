// Branches and merges. An agent works on a branch: its own copy of each file
// it touches, which a person or another agent reviews and merges. Built on
// the line-op log, not git branches: a branch's copy of a file is its own
// Durable Object, forked from main's with every line id and rev intact, so a
// merge is a three-way merge by line id (`merge` in lines.ts) that main's
// file applies in one batch, each line keeping its author. Lines only one
// side changed never conflict; a line both changed is settled per line,
// keeping the branch's or main's. A merged JavaScript or TypeScript file that
// would no longer build (lint.ts) is a conflict too. Git hears about it when
// main is catalogued. A branch can delete a file too: its row is marked
// deleted, and merging deletes it from main, and from git there and then.
// A merge also waits for the repo's required checks to pass on the branch (checks.ts).

import { empty, fromText, type Conflict, type Doc, type Op } from "./lines.ts";
import { materialize, toFile, uncatalogue } from "./archive.ts";
import { changedLines, isBuildFile } from "./buildfiles.ts";
import { mergeBlock, refChecks } from "./checks.ts";
import { settings as deploySettings } from "./deploy.ts";
import { json, NAME, type Env, readBody } from "./env.ts";
import { emit } from "./hooks.ts";
import { diffToOps } from "./sync.ts";

type Pick = "branch" | "main";
interface Access { read: boolean; write: boolean }

export async function openBranch(env: Env, owner: string, repo: string, name: string) {
  const b = await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  return b?.status === "open" ? b : null;
}

/** Make sure `path` has a copy on `branch`, forked from main's file the first time it's opened. */
export async function materializeOn(env: Env, owner: string, repo: string, branch: string, path: string): Promise<{ ok: true } | { error: string; status: number }> {
  const row = await env.DB.prepare("SELECT deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).first();
  if (row) return row.deleted ? { error: "deleted on this branch", status: 404 } : { ok: true };
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return m;
  const doc = await (await toFile(env, owner, repo, path, "upstream", "file")).json();
  // Fork before the row lands, so nobody reads the copy empty; the DO forks once.
  await toFile(env, owner, repo, path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", branch);
  await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path) VALUES (?, ?, ?, ?)").bind(owner, repo, branch, path).run();
  return { ok: true };
}

/** A file that's new on the branch: forked from nothing. One the branch deleted can be made again. */
export async function createOn(env: Env, owner: string, repo: string, branch: string, path: string, content: string, user: string) {
  const gone = await env.DB.prepare("UPDATE branch_files SET deleted = 0, merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND deleted = 1").bind(owner, repo, branch, path).run();
  if (gone.meta?.changes) {
    // Its copy starts over, forked from main's again if main has it, so merging it is an edit of main's.
    await toFile(env, owner, repo, path, user, "wipe", { method: "POST" }, "", branch);
    const onMain = await materialize(env, owner, repo, path);
    const doc = "error" in onMain ? empty() : await (await toFile(env, owner, repo, path, "upstream", "file")).json() as Doc;
    await toFile(env, owner, repo, path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", branch);
    const ops = diffToOps(doc.lines, content.split("\n"));
    if (ops.length) await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops }) }, "", branch);
    return json({ path, branch }, 201);
  }
  const onMain = await materialize(env, owner, repo, path);
  if (!("error" in onMain) || onMain.status !== 404) return json({ error: "file exists" }, 409);
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
  const row = await env.DB.prepare("SELECT deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).first();
  if (row?.deleted) return json({ error: "no such file" }, 404);
  const onMain = await materialize(env, owner, repo, path);
  const mainHas = !("error" in onMain) || onMain.status !== 404;
  if (!mainHas && !row) return json({ error: "no such file" }, 404);
  if (row) await toFile(env, owner, repo, path, "upstream", "wipe", { method: "POST" }, "", branch);
  if (!mainHas) await env.DB.prepare("DELETE FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).run();
  else await env.DB.prepare("INSERT INTO branch_files (owner, repo, branch, path, deleted) VALUES (?, ?, ?, ?, 1) ON CONFLICT (owner, repo, branch, path) DO UPDATE SET deleted = 1, merged = 0").bind(owner, repo, branch, path).run();
  return json({ path, branch, deleted: true });
}

/** Main loses `path`: its copy, its rows, and its place in git (and the mirror's upstream, at the next sync). */
async function deleteOnMain(env: Env, owner: string, repo: string, path: string, user: string, message: string) {
  await toFile(env, owner, repo, path, user, "wipe", { method: "POST" });
  await env.DB.batch(["files", "file_search", "git_pending"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE owner = ? AND repo = ? AND path = ?`).bind(owner, repo, path)));
  const git = await uncatalogue(env, owner, repo, path, user, message).catch(() => null);
  if (git) {
    const { kickMirror } = await import("./mirror.ts");
    await kickMirror(env, owner, repo);
  }
}

/** Ask main's copy of `path` to merge the branch's: a dry run, or for real. */
async function mergeFile(env: Env, owner: string, repo: string, branch: { name: string; by: string }, path: string, user: string, resolve: Record<string, Pick> | undefined, dry: boolean) {
  const [base, doc] = await Promise.all(["base", "file"].map(async (op) => (await toFile(env, owner, repo, path, user, op, {}, "", branch.name)).json() as Promise<Doc>));
  const res = await toFile(env, owner, repo, path, user, "merge", { method: "POST", body: JSON.stringify({ base, branch: doc, resolve, dry, deleter: branch.by, path }) });
  return { status: res.status, ...(await res.json() as { rev: number; ops?: Op[]; conflicts: Conflict[] }) };
}

export async function branchRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null, a: Access): Promise<Response | null> {
  if (p[4] !== "branches") return null;
  const name = p[5];

  // GET /api/repos/:o/:r/branches
  if (!name && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT name, by, status, created_at, merged_by, merged_at, upstream_ref FROM branches WHERE owner = ? AND repo = ? ORDER BY created_at DESC").bind(owner, repo).all();
    return json(results);
  }
  // POST /api/repos/:o/:r/branches {name}
  if (!name && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    const { name: b } = await readBody<"name">(req);
    if (typeof b !== "string" || !NAME.test(b) || b === "main") return json({ error: "bad branch name" }, 400);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(owner, repo, b, user, Date.now()).run();
    if (!r.meta?.changes) return json({ error: "branch exists" }, 409);
    await emit(env, owner, repo, "branch.opened", user!, { ref: b, ref_type: "branch", master_branch: "main" });
    return json({ name: b, by: user, status: "open" }, 201);
  }

  const branch = name && await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  if (!branch) return json({ error: "no such branch" }, 404);
  const files = async () => ((await env.DB.prepare("SELECT path, merged, deleted FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as { path: string; merged: number; deleted: number }[]);

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
    const out = await Promise.all((await files()).map(async (f) => {
      const build = isBuildFile(f.path);
      if (f.merged) return { path: f.path, merged: true, build, ops: [], conflicts: [], ...(f.deleted && { deleted: true }) };
      if (f.deleted) return { path: f.path, merged: false, build, deleted: true, ops: [], conflicts: [] };
      const m = await mergeFile(env, owner, repo, branch, f.path, user ?? "anon", undefined, true);
      let ops = m.ops ?? [], conflicts = m.conflicts;
      if (!a.write) {
        // Outside the crew, main's private lines stay blank here too.
        const secret = new Set(await (await toFile(env, owner, repo, f.path, "upstream", "private")).json() as string[]);
        ops = ops.map((o: any) => o.kind === "set" && secret.has(o.line) ? { ...o, text: "" } : o);
        conflicts = conflicts.map((c) => secret.has(c.line) ? { ...c, base: "", main: c.main === null ? null : "", branch: c.branch === null ? null : "" } : c);
      }
      const lines = build ? changedLines(await (await toFile(env, owner, repo, f.path, user ?? "anon", "file")).json() as Doc, ops) : undefined;
      return { path: f.path, merged: false, build, ops, conflicts, ...(lines && { lines }) };
    }));
    return json({ ...branch, deploys: (await deploySettings(env, owner, repo)).on_commit, checks: await refChecks(env, owner, repo, name), files: out });
  }

  // POST /api/repos/:o/:r/branches/:b/merge {resolve?: {path: {lineId: "branch"|"main"}}}
  if (p[6] === "merge" && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    if (branch.status !== "open") return json({ error: `branch is ${branch.status}` }, 409);
    const body = await readBody<"resolve" | "build_ok">(req), build_ok = body.build_ok;
    // path → line → "branch" | "main", rebuilt from what came in: anything else in it settles nothing.
    const resolve: Record<string, Record<string, Pick>> = Object.fromEntries(Object.entries(Object(body.resolve)).map(([path, lines]) =>
      [path, Object.fromEntries(Object.entries(Object(lines)).filter((e): e is [string, Pick] => e[1] === "branch" || e[1] === "main"))]));
    const todo = (await files()).filter((f) => !f.merged);
    // Build or deploy files on a merge the owner's next commit would ship: read them first.
    const build = todo.map((f) => f.path).filter(isBuildFile);
    if (build.length && !build_ok && (await deploySettings(env, owner, repo)).on_commit) return json({ error: "this branch changes build or deploy files: read them, then merge with build_ok", build }, 409);
    // Required checks that failed, or haven't finished, hold it, as a GitHub branch protection rule would.
    const held = await mergeBlock(env, owner, repo, name);
    if (held) return json(held, 409);
    // A dry run first, so a conflict anywhere merges nothing. A deletion never conflicts.
    const dry = await Promise.all(todo.filter((f) => !f.deleted).map(async (f) => ({ path: f.path, ...(await mergeFile(env, owner, repo, branch, f.path, user!, resolve[f.path], true)) })));
    const blocked = dry.filter((d) => d.conflicts.length).map(({ path, conflicts }) => ({ path, conflicts }));
    // Settling a stretch can leave code that won't build: say so, as the review (settling nothing) can't show it.
    const broken = blocked.flatMap((b) => b.conflicts.filter((c) => c.lint).map((c) => `${b.path}: ${c.lint}`));
    if (blocked.length) return json({ error: broken.length ? `merged, it wouldn't build: ${broken.join("; ")}` : "conflicts", conflicts: blocked }, 409);

    const merged: { path: string; rev: number; ops: number; deleted?: true }[] = [], conflicts: { path: string; conflicts: Conflict[] }[] = [];
    for (const f of todo) {
      // Claim the file, so two merges at once can't both apply it.
      const claim = await env.DB.prepare("UPDATE branch_files SET merged = 1 WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND merged = 0").bind(owner, repo, name, f.path).run();
      if (!claim.meta?.changes) continue;
      if (f.deleted) {
        await deleteOnMain(env, owner, repo, f.path, user!, `Delete ${f.path}, merging ${name}`);
        merged.push({ path: f.path, rev: 0, ops: 0, deleted: true });
        continue;
      }
      // A file new on the branch becomes a file on main.
      const onMain = await materialize(env, owner, repo, f.path);
      if ("error" in onMain && onMain.status === 404) await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, f.path).run();
      const m = await mergeFile(env, owner, repo, branch, f.path, user!, resolve[f.path], false);
      if (m.status === 200) { merged.push({ path: f.path, rev: m.rev, ops: m.ops?.length ?? 0 }); continue; }
      // Main moved into a conflict between the dry run and now: this file waits for another merge.
      await env.DB.prepare("UPDATE branch_files SET merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, f.path).run();
      conflicts.push({ path: f.path, conflicts: m.conflicts });
    }
    if (!conflicts.length) {
      const at = Date.now();
      await env.DB.prepare("UPDATE branches SET status = 'merged', merged_by = ?, merged_at = ? WHERE owner = ? AND repo = ? AND name = ?").bind(user, at, owner, repo, name).run();
      // Shaped like a merged pull request, the branch as its head. Git hears about it at the next commit of main.
      await emit(env, owner, repo, "branch.merged", user!, {
        action: "closed",
        pull_request: { merged: true, merged_at: new Date(at).toISOString(), merged_by: { login: user }, user: { login: branch.by }, head: { ref: name }, base: { ref: "main" } },
        files: merged.map((m) => m.path),
      });
    }
    return json({ status: conflicts.length ? "open" : "merged", merged, conflicts }, conflicts.length ? 409 : 200);
  }
  return null;
}
