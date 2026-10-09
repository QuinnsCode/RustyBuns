// Branches and merges. An agent works on a branch: its own copy of each file
// it touches, which a person or another agent reviews and merges. Built on
// the line-op log, not git branches: a branch's copy of a file is its own
// Durable Object, forked from main's with every line id and rev intact, so a
// merge is a three-way merge by line id (`merge` in lines.ts) that main's
// file applies in one batch, each line keeping its author. Lines only one
// side changed never conflict; a line both changed is settled per line,
// keeping the branch's or main's. Git hears about it when main is catalogued.

import { empty, fromText, type Conflict, type Doc } from "./lines.ts";
import { materialize, toFile } from "./archive.ts";
import { json, NAME, type Env } from "./env.ts";

type Pick = "branch" | "main";
interface Access { read: boolean; write: boolean }

export async function openBranch(env: Env, owner: string, repo: string, name: string) {
  const b = await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  return b?.status === "open" ? b : null;
}

/** Make sure `path` has a copy on `branch`, forked from main's file the first time it's opened. */
export async function materializeOn(env: Env, owner: string, repo: string, branch: string, path: string): Promise<{ ok: true } | { error: string; status: number }> {
  if (await env.DB.prepare("SELECT 1 FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, branch, path).first()) return { ok: true };
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return m;
  const doc = await (await toFile(env, owner, repo, path, "upstream", "file")).json();
  // Fork before the row lands, so nobody reads the copy empty; the DO forks once.
  await toFile(env, owner, repo, path, "upstream", "fork", { method: "POST", body: JSON.stringify({ doc }) }, "", branch);
  await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path) VALUES (?, ?, ?, ?)").bind(owner, repo, branch, path).run();
  return { ok: true };
}

/** A file that's new on the branch: forked from nothing. */
export async function createOn(env: Env, owner: string, repo: string, branch: string, path: string, content: string, user: string) {
  const onMain = await materialize(env, owner, repo, path);
  if (!("error" in onMain) || onMain.status !== 404) return json({ error: "file exists" }, 409);
  const r = await env.DB.prepare("INSERT OR IGNORE INTO branch_files (owner, repo, branch, path) VALUES (?, ?, ?, ?)").bind(owner, repo, branch, path).run();
  if (!r.meta?.changes) return json({ error: "file exists" }, 409);
  await toFile(env, owner, repo, path, user, "fork", { method: "POST", body: JSON.stringify({ doc: empty() }) }, "", branch);
  await toFile(env, owner, repo, path, user, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(content) }) }, "", branch);
  return json({ path, branch }, 201);
}

/** Ask main's copy of `path` to merge the branch's: a dry run, or for real. */
async function mergeFile(env: Env, owner: string, repo: string, branch: { name: string; by: string }, path: string, user: string, resolve: Record<string, Pick> | undefined, dry: boolean) {
  const [base, doc] = await Promise.all(["base", "file"].map(async (op) => (await toFile(env, owner, repo, path, user, op, {}, "", branch.name)).json() as Promise<Doc>));
  const res = await toFile(env, owner, repo, path, user, "merge", { method: "POST", body: JSON.stringify({ base, branch: doc, resolve, dry, deleter: branch.by }) });
  return { status: res.status, ...(await res.json() as { rev: number; ops?: unknown[]; conflicts: Conflict[] }) };
}

export async function branchRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null, a: Access): Promise<Response | null> {
  if (p[4] !== "branches") return null;
  const name = p[5];

  // GET /api/repos/:o/:r/branches
  if (!name && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT name, by, status, created_at, merged_by, merged_at FROM branches WHERE owner = ? AND repo = ? ORDER BY created_at DESC").bind(owner, repo).all();
    return json(results);
  }
  // POST /api/repos/:o/:r/branches {name}
  if (!name && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    const { name: b } = (await req.json()) as { name: string };
    if (!NAME.test(b ?? "") || b === "main") return json({ error: "bad branch name" }, 400);
    const r = await env.DB.prepare("INSERT OR IGNORE INTO branches (owner, repo, name, by, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(owner, repo, b, user, Date.now()).run();
    if (!r.meta?.changes) return json({ error: "branch exists" }, 409);
    return json({ name: b, by: user, status: "open" }, 201);
  }

  const branch = name && await env.DB.prepare("SELECT * FROM branches WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, name).first();
  if (!branch) return json({ error: "no such branch" }, 404);
  const files = async () => ((await env.DB.prepare("SELECT path, merged FROM branch_files WHERE owner = ? AND repo = ? AND branch = ? ORDER BY path").bind(owner, repo, name).all()).results as { path: string; merged: number }[]);

  // GET /api/repos/:o/:r/branches/:b  the review: each file's ops against main now, and its conflicts
  if (!p[6] && req.method === "GET") {
    const out = await Promise.all((await files()).map(async (f) => {
      if (f.merged) return { path: f.path, merged: true, ops: [], conflicts: [] };
      const m = await mergeFile(env, owner, repo, branch, f.path, user ?? "anon", undefined, true);
      return { path: f.path, merged: false, ops: m.ops ?? [], conflicts: m.conflicts };
    }));
    return json({ ...branch, files: out });
  }

  // POST /api/repos/:o/:r/branches/:b/merge {resolve?: {path: {lineId: "branch"|"main"}}}
  if (p[6] === "merge" && req.method === "POST") {
    if (!a.write) return json({ error: "no write access" }, 403);
    if (branch.status !== "open") return json({ error: `branch is ${branch.status}` }, 409);
    const { resolve = {} } = (await req.json().catch(() => ({}))) as { resolve?: Record<string, Record<string, Pick>> };
    const todo = (await files()).filter((f) => !f.merged);
    // A dry run first, so a conflict anywhere merges nothing.
    const dry = await Promise.all(todo.map(async (f) => ({ path: f.path, ...(await mergeFile(env, owner, repo, branch, f.path, user!, resolve[f.path], true)) })));
    const blocked = dry.filter((d) => d.conflicts.length).map(({ path, conflicts }) => ({ path, conflicts }));
    if (blocked.length) return json({ error: "conflicts", conflicts: blocked }, 409);

    const merged: { path: string; rev: number; ops: number }[] = [], conflicts: { path: string; conflicts: Conflict[] }[] = [];
    for (const f of todo) {
      // Claim the file, so two merges at once can't both apply it.
      const claim = await env.DB.prepare("UPDATE branch_files SET merged = 1 WHERE owner = ? AND repo = ? AND branch = ? AND path = ? AND merged = 0").bind(owner, repo, name, f.path).run();
      if (!claim.meta?.changes) continue;
      // A file new on the branch becomes a file on main.
      const onMain = await materialize(env, owner, repo, f.path);
      if ("error" in onMain && onMain.status === 404) await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, f.path).run();
      const m = await mergeFile(env, owner, repo, branch, f.path, user!, resolve[f.path], false);
      if (m.status === 200) { merged.push({ path: f.path, rev: m.rev, ops: m.ops?.length ?? 0 }); continue; }
      // Main moved into a conflict between the dry run and now: this file waits for another merge.
      await env.DB.prepare("UPDATE branch_files SET merged = 0 WHERE owner = ? AND repo = ? AND branch = ? AND path = ?").bind(owner, repo, name, f.path).run();
      conflicts.push({ path: f.path, conflicts: m.conflicts });
    }
    if (!conflicts.length) await env.DB.prepare("UPDATE branches SET status = 'merged', merged_by = ?, merged_at = ? WHERE owner = ? AND repo = ? AND name = ?").bind(user, Date.now(), owner, repo, name).run();
    return json({ status: conflicts.length ? "open" : "merged", merged, conflicts }, conflicts.length ? 409 : 200);
  }
  return null;
}
