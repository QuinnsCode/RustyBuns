// Moving the Artifacts namespace off codesplitters (#823). A repo's git remote names its namespace and D1
// stores that remote, so the move copies every repo and then rewrites the stored remotes.
//
//   1. Deploy with ARTIFACTS_NEXT bound to the new namespace (rustybuns.config.ts). Nothing reads it yet.
//   2. POST /api/admin/artifacts/copy {after?}  copies a page of repos old -> new; repeat with `next` until it's null.
//      Safe to repeat: a repo already in the new namespace is skipped. Pushes to the old one after its copy are
//      not carried, so stop writing (or copy again after deleting the stale copy) before step 3.
//   3. Deploy with ARTIFACTS pointing at the new namespace and ARTIFACTS_NEXT gone.
//   4. POST /api/admin/artifacts/rewrite  points repos.artifact_remote and crew_remote at the new remotes.
//
// The old namespace and its repos stay until the new ones are checked. Admins only.

import { json, readBody, type Artifacts, type Env } from "./env.ts";

const PAGE = 10;

/** The names a repo row keeps an Artifact under: its own and its crew copy (old_artifacts are kept history, left behind). */
export const namesOf = (rows: { artifact: string | null; crew_artifact: string | null }[]) =>
  [...new Set(rows.flatMap((r) => [r.artifact, r.crew_artifact]).filter((n): n is string => !!n))];

/** The remote with a read token in it, which `import` takes as the source URL. */
const withToken = (remote: string, token: string) => remote.replace("://", `://x:${token.split("?")[0]}@`);

/** Cloudflare's import answers at once and `get` refuses the repo until the clone lands: wait for it, up to `ms`. */
async function ready(to: Artifacts, name: string, ms = 20_000) {
  for (const stop = Date.now() + ms; ; await new Promise((r) => setTimeout(r, 500))) {
    if (await to.get(name).then(() => true, () => false)) return;
    if (Date.now() > stop) throw new Error("the import hasn't landed yet: copy again");
  }
}

/** Copies one page of repos' Artifacts (those named after `after`, in name order) into ARTIFACTS_NEXT. */
export async function copyPage(env: Env, after = "") {
  const { ARTIFACTS: from, ARTIFACTS_NEXT: to } = env;
  if (!from || !to) throw new Error("bind both ARTIFACTS and ARTIFACTS_NEXT");
  const names = ((await env.DB.prepare(
    "SELECT n AS name FROM (SELECT artifact AS n FROM repos UNION SELECT crew_artifact FROM repos) WHERE n IS NOT NULL AND n > ? ORDER BY n LIMIT ?",
  ).bind(after, PAGE).all()).results as { name: string }[]).map((r) => r.name);
  const out = { copied: [] as string[], skipped: [] as string[], failed: [] as { name: string; error: string }[], next: names.length < PAGE ? null : names.at(-1)! };
  for (const name of names) {
    try {
      if (await to.get(name).then((h) => h.info()).then(() => true, () => false)) { out.skipped.push(name); continue; }
      const old = await from.get(name);
      const src = await old.info();
      const made = await to.import({ source: { url: withToken(src.remote, (await old.createToken("read", 3600)).plaintext), branch: src.defaultBranch }, target: { name } });
      await ready(to, name);
      await env.DB.prepare("INSERT INTO artifact_moves (name, remote, moved_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET remote = excluded.remote, moved_at = excluded.moved_at")
        .bind(name, made.remote, Date.now()).run();
      out.copied.push(name);
    } catch (e) {
      out.failed.push({ name, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** Points the stored remotes at the copies. Run once ARTIFACTS is the new namespace; a repo with no copy keeps its remote and is listed. */
export async function rewriteRemotes(env: Env) {
  const [main, crew] = await env.DB.batch([
    env.DB.prepare("UPDATE repos SET artifact_remote = (SELECT remote FROM artifact_moves WHERE name = repos.artifact) WHERE artifact IN (SELECT name FROM artifact_moves)"),
    env.DB.prepare("UPDATE repos SET crew_remote = (SELECT remote FROM artifact_moves WHERE name = repos.crew_artifact) WHERE crew_artifact IN (SELECT name FROM artifact_moves)"),
  ]);
  const rows = (await env.DB.prepare("SELECT artifact, crew_artifact FROM repos").all()).results as { artifact: string | null; crew_artifact: string | null }[];
  const moved = new Set(((await env.DB.prepare("SELECT name FROM artifact_moves").all()).results as { name: string }[]).map((r) => r.name));
  return { rewritten: { artifact_remote: main!.meta.changes, crew_remote: crew!.meta.changes }, notCopied: namesOf(rows).filter((n) => !moved.has(n)) };
}

/** POST /api/admin/artifacts/copy {after?} and POST /api/admin/artifacts/rewrite. */
export async function artifactMoveRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "artifacts" || (p[3] !== "copy" && p[3] !== "rewrite") || p[4]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (p[3] === "rewrite") return json(await rewriteRemotes(env));
  if (!env.ARTIFACTS || !env.ARTIFACTS_NEXT) return json({ error: "ARTIFACTS_NEXT isn't bound: deploy with it first" }, 409);
  const { after } = await readBody<"after">(req);
  return json(await copyPage(env, typeof after === "string" ? after : ""));
}
