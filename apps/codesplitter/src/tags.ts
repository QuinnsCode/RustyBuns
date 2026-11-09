// Tags (#879): a repo's tags, listed, made and deleted over git's own wire (smart
// HTTP), so it goes the same on Cloudflare Artifacts and on the desktop's bare
// repos. The Artifacts handle reads commits and trees but has nothing for refs;
// its git remote takes a push of any ref, a tag included. Tags made here are
// lightweight: a ref to a commit. They live in the repo's own git, the one the
// commit graph reads. A mirror's tags come from upstream and go up to it with
// git itself (mirror.ts).
//
//   GET    /api/repos/:o/:r/tags          {tags: [{name, commit}]}, newest-looking first
//   POST   /api/repos/:o/:r/tags          {name, commit?} (owner) tag main's tip, or a commit; a version tag
//                                         (v1.2, 3.0-rc1) cuts a release in a repo with a pipeline file (checks.ts)
//   DELETE /api/repos/:o/:r/tags/:name    (owner)

import { access, handleFor } from "./archive.ts";
import { branchNameError, code, fail, json, need, readBody, type Env } from "./env.ts";
import { obj, opt, str } from "@rustybuns/util/guard";
import { remoteRefs, setRef, ZERO } from "./git.ts";

export interface Tag { name: string; commit: string }

/** A tag that names a version (v1.2, 3.0-rc1), the kind that cuts a release. */
const VERSION = /^v?\d/;

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
    if (user !== owner) return fail("OwnerOnly", "only the repo's owner tags it");
    const g = await remote(env, owner, repo, "write");
    if (!g) return fail("NoGit", "this repo has no git yet: commit something first");
    // Unpeeled: a delete names the ref's own hash (an annotated tag's object, not its commit).
    const refs = await remoteRefs(g.remote, g.token, false);

    if (req.method === "DELETE") {
      const ref = `refs/tags/${name}`, had = refs.get(ref);
      if (!name || !had) return fail("NoSuchTag", `no tag ${name}`);
      const why = await setRef(g.remote, g.token, ref, had, ZERO);
      return why ? fail("TagRefused", "the repo's git didn't take the change: try again") : json({ ok: true });
    }

    if (name) return null;
    const b = need(await readBody(req), obj({ name: str(Infinity, { min: 0, dflt: "" }), commit: opt(str(64, { re: /^[0-9a-f]{40,64}$/ })) }), "commit: a full commit hash");
    if (b instanceof Response) return b;
    const tag = b.name.trim(), bad = tagNameError(tag);
    if (bad) return fail("BadInput", bad);
    const at = refs.get(`refs/tags/${tag}`);
    if (at) return fail("TagExists", `there's already a tag ${tag}: delete it first to move it`);
    const commit = b.commit ?? (await g.h.handle.log({ ref: g.h.branch, limit: 1 }))[0]?.hash;
    if (!commit) return fail("NoGit", "this repo has no commits yet");
    if (b.commit && !(await g.h.handle.readCommit(commit).catch(() => null))) return fail("NoSuchCommit", `no commit ${commit.slice(0, 7)} in this repo`);
    const why = await setRef(g.remote, g.token, `refs/tags/${tag}`, ZERO, commit);
    if (why) return fail("TagRefused", "the repo's git didn't take the tag: try again");
    // A version tag is a release: the pipeline's often and release lanes run and its buses leave (pipeline-lanes.ts).
    const release = VERSION.test(tag) && await (await import("./checks.ts")).cutRelease(env, owner, repo, commit, user, tag).catch(() => null);
    return json({ name: tag, commit, ...(release && { release }) }, 201);
  } catch (e) {
    if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return fail("StillCopying", "this repo is still being copied in");
    throw e;
  }
}

