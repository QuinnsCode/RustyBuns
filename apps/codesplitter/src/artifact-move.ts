// Moving the Artifacts namespace off codesplitters (#823). A repo's git remote names its namespace and D1
// stores that remote, so the move copies every repo (with its history) and then rewrites the stored remotes.
// Artifacts' `import` only takes public repos, so the copy is git itself, `clone --mirror` and `push --mirror`,
// run by scripts/move-artifacts.ts on a machine with git, from a plan this file hands out.
//
//   1. Deploy with ARTIFACTS_NEXT bound to the new namespace (rustybuns.config.ts). Nothing reads it yet.
//   2. POST /api/admin/artifacts/copy {after?}  makes a page of empty repos in the new namespace and returns, for
//      each, the old remote with a read token and the new one with a write token (an hour). Repeat with `next`.
//   3. bun scripts/move-artifacts.ts <plan.json>  mirrors each one.
//   4. POST /api/admin/artifacts/verify {after?}  compares each repo's refs old against new; a match is recorded
//      in artifact_moves with its new remote. Anything that differs is listed. Pushes to the old repo after its
//      copy show up here as a difference: copy that one again.
//   5. Deploy with ARTIFACTS pointing at the new namespace and ARTIFACTS_NEXT gone.
//   6. POST /api/admin/artifacts/rewrite  points repos.artifact_remote and crew_remote at the new remotes.
//
// The old namespace and its repos stay until the new ones are checked. Admins only.

import { remoteRefs } from "./git.ts";
import { json, readBody, type Env } from "./env.ts";

const PAGE = 10;

/** The names a repo row keeps an Artifact under: its own and its crew copy (old_artifacts are kept history, left behind). */
export const namesOf = (rows: { artifact: string | null; crew_artifact: string | null }[]) =>
  [...new Set(rows.flatMap((r) => [r.artifact, r.crew_artifact]).filter((n): n is string => !!n))];

/** A page of Artifact names in name order, after `after`. */
async function page(env: Env, after: string) {
  const names = ((await env.DB.prepare(
    "SELECT n AS name FROM (SELECT artifact AS n FROM repos UNION SELECT crew_artifact FROM repos) WHERE n IS NOT NULL AND n > ? ORDER BY n LIMIT ?",
  ).bind(after, PAGE).all()).results as { name: string }[]).map((r) => r.name);
  return { names, next: names.length < PAGE ? null : names.at(-1)! };
}

const both = (env: Env) => {
  if (!env.ARTIFACTS || !env.ARTIFACTS_NEXT) throw new Error("bind both ARTIFACTS and ARTIFACTS_NEXT");
  return { from: env.ARTIFACTS, to: env.ARTIFACTS_NEXT };
};

/** Makes each repo of the page in the new namespace if it isn't there, and hands out the tokens to mirror it with. */
export async function planPage(env: Env, after = "") {
  const { from, to } = both(env);
  const { names, next } = await page(env, after);
  const done = new Set(((await env.DB.prepare("SELECT name FROM artifact_moves").all()).results as { name: string }[]).map((r) => r.name));
  const out = { repos: [] as { name: string; from: { remote: string; token: string }; to: { remote: string; token: string } }[], skipped: [] as string[], failed: [] as { name: string; error: string }[], next };
  for (const name of names) {
    if (done.has(name)) { out.skipped.push(name); continue; }
    try {
      const old = await from.get(name), src = await old.info();
      const made = await to.get(name).catch(() => null) ?? await to.get((await to.create(name, { description: `moved from ${src.name}`, setDefaultBranch: src.defaultBranch })).name);
      out.repos.push({
        name,
        from: { remote: src.remote, token: (await old.createToken("read", 3600)).plaintext },
        to: { remote: (await made.info()).remote, token: (await made.createToken("write", 3600)).plaintext },
      });
    } catch (e) {
      out.failed.push({ name, error: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** Records each repo of the page whose refs are the same in both namespaces; lists the rest. */
export async function verifyPage(env: Env, after = "", refs = remoteRefs) {
  const { from, to } = both(env);
  const { names, next } = await page(env, after);
  const out = { verified: [] as string[], differs: [] as { name: string; why: string }[], next };
  for (const name of names) {
    try {
      const [a, b] = [await from.get(name), await to.get(name)];
      const [ra, rb] = [await refs((await a.info()).remote, (await a.createToken("read", 300)).plaintext, false), await refs((await b.info()).remote, (await b.createToken("read", 300)).plaintext, false)];
      const off = [...new Set([...ra.keys(), ...rb.keys()])].filter((r) => ra.get(r) !== rb.get(r));
      if (off.length) { out.differs.push({ name, why: `${off.length} refs differ: ${off.slice(0, 3).join(", ")}` }); continue; }
      await env.DB.prepare("INSERT INTO artifact_moves (name, remote, moved_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET remote = excluded.remote, moved_at = excluded.moved_at")
        .bind(name, (await b.info()).remote, Date.now()).run();
      out.verified.push(name);
    } catch (e) {
      out.differs.push({ name, why: String((e as Error)?.message ?? e) });
    }
  }
  return out;
}

/** Points the stored remotes at the copies. Run once ARTIFACTS is the new namespace; a repo with no verified copy keeps its remote and is listed. */
export async function rewriteRemotes(env: Env) {
  const [main, crew] = await env.DB.batch([
    env.DB.prepare("UPDATE repos SET artifact_remote = (SELECT remote FROM artifact_moves WHERE name = repos.artifact) WHERE artifact IN (SELECT name FROM artifact_moves)"),
    env.DB.prepare("UPDATE repos SET crew_remote = (SELECT remote FROM artifact_moves WHERE name = repos.crew_artifact) WHERE crew_artifact IN (SELECT name FROM artifact_moves)"),
  ]);
  const rows = (await env.DB.prepare("SELECT artifact, crew_artifact FROM repos").all()).results as { artifact: string | null; crew_artifact: string | null }[];
  const moved = new Set(((await env.DB.prepare("SELECT name FROM artifact_moves").all()).results as { name: string }[]).map((r) => r.name));
  return { rewritten: { artifact_remote: main!.meta.changes, crew_remote: crew!.meta.changes }, notCopied: namesOf(rows).filter((n) => !moved.has(n)) };
}

/** POST /api/admin/artifacts/copy {after?}, /verify {after?} and /rewrite. */
export async function artifactMoveRoutes(req: Request, env: Env, p: string[], admin: boolean): Promise<Response | null> {
  if (p[1] !== "admin" || p[2] !== "artifacts" || !["copy", "verify", "rewrite"].includes(p[3]!) || p[4]) return null;
  if (!admin) return json({ error: "admins only" }, 403);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (p[3] === "rewrite") return json(await rewriteRemotes(env));
  if (!env.ARTIFACTS || !env.ARTIFACTS_NEXT) return json({ error: "ARTIFACTS_NEXT isn't bound: deploy with it first" }, 409);
  const { after } = await readBody<"after">(req), from = typeof after === "string" ? after : "";
  return json(await (p[3] === "copy" ? planPage(env, from) : verifyPage(env, from)));
}
