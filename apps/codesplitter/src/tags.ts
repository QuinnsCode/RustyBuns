// Tags (#879): a repo's tags, listed, made and deleted over git's own wire (smart
// HTTP), so it goes the same on Cloudflare Artifacts and on the desktop's bare
// repos. The Artifacts handle reads commits and trees but has nothing for refs;
// its git remote takes a push of any ref, a tag included. Tags made here are
// lightweight: a ref to a commit. They live in the repo's own git, the one the
// commit graph reads. A mirror's tags come from upstream and go up to it with
// git itself (mirror.ts).
//
//   GET    /api/repos/:o/:r/tags          {tags: [{name, commit}]}, newest-looking first
//   POST   /api/repos/:o/:r/tags          {name, commit?} (owner) tag main's tip, or a commit
//   DELETE /api/repos/:o/:r/tags/:name    (owner)

import { access, handleFor } from "./archive.ts";
import { branchNameError, code, json, readBody, type Env } from "./env.ts";
import { remoteRefs, setRef, ZERO } from "./git.ts";

export interface Tag { name: string; commit: string }

/** What's wrong with `name` as a tag name, or null: git's rule, as for a branch ("main" is fine for a tag). */
export const tagNameError = (name: string) => name === "main" ? null : branchNameError(name)?.replace(/\bbranch\b/g, "tag") ?? null;

/** Version tags first, the highest first (v10 above v9, v1.0 above v1.0-rc1), then the rest by name. */
export const byVersion = (a: Tag, b: Tag) => {
  const [x, y] = [a.name, b.name].map((n) => n.replace(/^v(?=\d)/, ""));
  const [vx, vy] = [x, y].map((n) => /^\d/.test(n!));
  if (vx !== vy) return vx ? -1 : 1;
  if (!vx) return x!.localeCompare(y!);
  if (x!.startsWith(`${y}-`)) return 1;
  if (y!.startsWith(`${x}-`)) return -1;
  return y!.localeCompare(x!, undefined, { numeric: true });
};

/** The repo's git, and a fresh token for it. */
async function remote(env: Env, owner: string, repo: string, scope: "read" | "write") {
  const h = await handleFor(env, owner, repo);
  return h && { h, ...(await access(h.handle, h.remote, scope, 120)) };
}

/** The repo's tags, each with the commit it names. */
export async function listTags(env: Env, owner: string, repo: string): Promise<Tag[]> {
  const g = await remote(env, owner, repo, "read");
  if (!g) return [];
  const refs = await remoteRefs(g.remote, g.token);
  return [...refs].filter(([ref]) => ref.startsWith("refs/tags/")).map(([ref, commit]) => ({ name: ref.slice(10), commit })).sort(byVersion);
}

export async function tagRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null): Promise<Response | null> {
  if (p[4] !== "tags") return null;
  const name = p.slice(5).join("/");
  try {
    if (req.method === "GET" && !name) return json({ tags: await listTags(env, owner, repo) });
    if (req.method !== "POST" && req.method !== "DELETE") return null;
    if (user !== owner) return json({ error: "owner only" }, 403);
    const g = await remote(env, owner, repo, "write");
    if (!g) return json({ error: "this repo has no git yet: commit something first" }, 409);
    // Unpeeled: a delete names the ref's own hash (an annotated tag's object, not its commit).
    const refs = await remoteRefs(g.remote, g.token, false);

    if (req.method === "DELETE") {
      const ref = `refs/tags/${name}`, had = refs.get(ref);
      if (!name || !had) return json({ error: `no tag ${name}` }, 404);
      const why = await setRef(g.remote, g.token, ref, had, ZERO);
      return why ? json({ error: `git didn't delete it: ${why}` }, 409) : json({ ok: true });
    }

    if (name) return null;
    const b = await readBody<"name" | "commit">(req);
    const tag = typeof b.name === "string" ? b.name.trim() : "";
    const bad = tagNameError(tag);
    if (bad) return json({ error: bad }, 400);
    if (b.commit !== undefined && (typeof b.commit !== "string" || !/^[0-9a-f]{40,64}$/.test(b.commit))) return json({ error: "commit: a full commit hash" }, 400);
    const at = refs.get(`refs/tags/${tag}`);
    if (at) return json({ error: `there's already a tag ${tag}` }, 409);
    const commit = (b.commit as string | undefined) ?? (await g.h.handle.log({ ref: g.h.branch, limit: 1 }))[0]?.hash;
    if (!commit) return json({ error: "this repo has no commits yet" }, 409);
    if (b.commit && !(await g.h.handle.readCommit(commit).catch(() => null))) return json({ error: `no commit ${commit.slice(0, 7)} in this repo` }, 404);
    const why = await setRef(g.remote, g.token, `refs/tags/${tag}`, ZERO, commit);
    return why ? json({ error: `git didn't take it: ${why}` }, 409) : json({ name: tag, commit }, 201);
  } catch (e) {
    if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ error: "this repo is still being copied in" }, 409);
    throw e;
  }
}

