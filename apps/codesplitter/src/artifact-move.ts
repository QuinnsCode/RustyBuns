// Moving the Artifacts namespace off codesplitters (#823). A repo's git remote names its namespace and D1
// stores that remote, so the move copies every repo and then rewrites the stored remotes.
//
// Artifacts' `import` can't read a private repo (it answers 401), and a Worker has no git, so the copy is a
// mirror push done by scripts/move-artifacts.ts on a machine with git. This file is the Worker's side of it.
//
//   1. Deploy with ARTIFACTS_NEXT bound to the new namespace (rustybuns.config.ts). Nothing reads it yet.
//   2. POST /api/admin/artifacts/copy {after?}  makes the empty repo in the new namespace and hands back, per repo,
//      a read URL on the old one and a write URL on the new one (`todo`). The script mirrors each; repeat with
//      `next` until it's null. Safe to repeat: a repo whose new copy already has the old one's head is skipped.
//   3. POST /api/admin/artifacts/verify {after?}  compares each pair's default branch and head commit, and only
//      a pair that matches is recorded as moved. A push to the old one after its copy shows here as a mismatch.
//   4. Deploy with ARTIFACTS pointing at the new namespace and ARTIFACTS_NEXT gone.
//   5. POST /api/admin/artifacts/rewrite  points repos.artifact_remote and crew_remote at the new remotes.
//
// The old namespace and its repos stay until the new ones are checked. Admins only.

import { json, readBody, type Artifacts, type Env } from "./env.ts";

const PAGE = 10;

/** The names a repo row keeps an Artifact under: its own and its crew copy (old_artifacts are kept history, left behind). */
export const namesOf = (rows: { artifact: string | null; crew_artifact: string | null }[]) =>
  [...new Set(rows.flatMap((r) => [r.artifact, r.crew_artifact]).filter((n): n is string => !!n))];

/** The remote with a token in it, as git takes it. */
const withToken = (remote: string, token: string) => remote.replace("://", `://x:${token.split("?")[0]}@`);

/** A repo's default branch and head commit, or null when it isn't there. Empty repos have a head of "". */
async function tip(ns: Artifacts, name: string) {
  try {
    const h = await ns.get(name), info = await h.info();
    return { branch: info.defaultBranch, head: (await h.log({ limit: 1 }))[0]?.hash ?? "" };
  } catch { return null; }
}

/** The repo names after `after`, in name order: one page. */
async function page(env: Env, after: string) {
  const names = ((await env.DB.prepare(
    "SELECT n AS name FROM (SELECT artifact AS n FROM repos UNION SELECT crew_artifact FROM repos) WHERE n IS NOT NULL AND n > ? ORDER BY n LIMIT ?",
  ).bind(after, PAGE).all<{ name: string }>()).results).map((r) => r.name);
  return { names, next: names.length < PAGE ? null : names.at(-1)! };
}

export interface MirrorJob { name: string; from: string; to: string }

/** Gets one page of repos ready for the mirror push: the empty repo in ARTIFACTS_NEXT, and the two URLs the script copies between. */
export async function copyPage(env: Env, after = "") {
  const { ARTIFACTS: from, ARTIFACTS_NEXT: to } = env;
  if (!from || !to) throw new Error("bind both ARTIFACTS and ARTIFACTS_NEXT");
  const { names, next } = await page(env, after);
  const out = { todo: [] as MirrorJob[], skipped: [] as string[], failed: [] as { name: string; error: string }[], next };
  for (const name of names) {
    try {
      const was = await tip(from, name), now = await tip(to, name);
      if (!was) throw new Error("not in the old namespace");
      if (now && now.head === was.head && now.branch === was.branch) { out.skipped.push(name); continue; }
      const old = await from.get(name), oldInfo = await old.info();
      const made = now ? await to.get(name).then((h) => h.info()) : await to.create(name, { setDefaultBranch: was.branch });
      const dest = await to.get(name);
      out.todo.push({ name, from: withToken(oldInfo.remote, (await old.createToken("read", 3600)).plaintext), to: withToken(made.remote, (await dest.createToken("write", 3600)).plaintext) });
    } catch (e) {
      out.failed.push({ name, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** Compares one page of pairs; a pair that matches is recorded as moved, and rewrite uses only those. */
export async function verifyPage(env: Env, after = "") {
  const { ARTIFACTS: from, ARTIFACTS_NEXT: to } = env;
  if (!from || !to) throw new Error("bind both ARTIFACTS and ARTIFACTS_NEXT");
  const { names, next } = await page(env, after);
  const out = { verified: [] as string[], mismatched: [] as { name: string; why: string }[], next };
  for (const name of names) {
    const [was, now] = [await tip(from, name), await tip(to, name)];
    const why = !was ? "gone from the old namespace" : !now ? "not copied yet" : was.branch !== now.branch ? `default branch ${now.branch}, was ${was.branch}` : was.head !== now.head ? "the old one has commits the copy doesn't: copy again" : "";
    if (why) { out.mismatched.push({ name, why }); continue; }
    const remote = (await (await to.get(name)).info()).remote;
    await env.DB.prepare("INSERT INTO artifact_moves (name, remote, moved_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET remote = excluded.remote, moved_at = excluded.moved_at")
      .bind(name, remote, Date.now()).run();
    out.verified.push(name);
  }
  return out;
}

/** Points the stored remotes at the copies. Run once ARTIFACTS is the new namespace; a repo with no copy keeps its remote and is listed. */
export async function rewriteRemotes(env: Env) {
  const [main, crew] = await env.DB.batch([
    env.DB.prepare("UPDATE repos SET artifact_remote = (SELECT remote FROM artifact_moves WHERE name = repos.artifact) WHERE artifact IN (SELECT name FROM artifact_moves)"),
    env.DB.prepare("UPDATE repos SET crew_remote = (SELECT remote FROM artifact_moves WHERE name = repos.crew_artifact) WHERE crew_artifact IN (SELECT name FROM artifact_moves)"),
  ]);
  const rows = (await env.DB.prepare("SELECT artifact, crew_artifact FROM repos").all<{ artifact: string | null; crew_artifact: string | null }>()).results;
  const moved = new Set(((await env.DB.prepare("SELECT name FROM artifact_moves").all<{ name: string }>()).results).map((r) => r.name));
  return { rewritten: { artifact_remote: main!.meta.changes, crew_remote: crew!.meta.changes }, notCopied: namesOf(rows).filter((n) => !moved.has(n)) };
}

/** POST /api/admin/artifacts/copy {after?}, /verify {after?} and /rewrite. */
export async function artifactMoveRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "artifacts" || (p[3] !== "copy" && p[3] !== "verify" && p[3] !== "rewrite") || p[4]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (p[3] === "rewrite") return json(await rewriteRemotes(env));
  if (!env.ARTIFACTS || !env.ARTIFACTS_NEXT) return json({ error: "ARTIFACTS_NEXT isn't bound: deploy with it first" }, 409);
  const { after } = await readBody<"after">(req);
  const from = typeof after === "string" ? after : "";
  return json(await (p[3] === "verify" ? verifyPage(env, from) : copyPage(env, from)));
}
