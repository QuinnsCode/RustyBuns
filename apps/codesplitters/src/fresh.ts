// Limits, and the fresh start. Artifacts holds 1 GB a repo and every commit
// adds to it. When a repo's git nears that, it moves to a new Artifact that
// holds only its current files: one root commit with the very same tree. No
// line loses its authors or history, because those live in each file's
// Durable Object, not in git. The old Artifact is kept, history and all,
// until the owner deletes it.
//
// It copies in steps small enough for one request (a bounded number of
// Artifacts reads, a pack of a few MB), each step its own push, so a big repo
// moves over many requests: the page's polls and the five-minute cron drive it.
// Commits made meanwhile wait in git_pending and land on the new git after.
//   GET    /api/repos/:o/:r/limits         what this repo and you may do, and how close you are
//   POST   /api/repos/:o/:r/fresh          (owner) start a fresh start, or retry one that failed
//   GET    /api/repos/:o/:r/fresh          where it stands; takes a step while it's running
//   DELETE /api/repos/:o/:r/fresh?artifact= (owner) delete git it moved off

import { access, flushPending, handleFor, MAX_BYTES, MAX_LINES, readTree } from "./archive.ts";
import { copyObjects, rawObj, type Obj } from "./git.ts";
import { digCap } from "./github.ts";
import { usage } from "./limits.ts";
import { json, type Env } from "./env.ts";

/** Cloudflare's caps (developers.cloudflare.com/artifacts/platform/limits). */
export const REPO_CAP = 1024 ** 3, BLOB_CAP = 32 * 1024 ** 2;
/** Past this share of the cap, or once a push fails for size, the repo starts fresh by itself. */
const NEARLY_FULL = 0.9;
/** How much one step may do: Artifacts reads, and bytes in its pack. Tests shrink it. */
export const STEP = { reads: 150, bytes: 8 * 1024 ** 2 };
const STAGE = "refs/heads/codesplitters-fresh-start";
// Cloudflare's wording for a full repo isn't documented; anything that reads like one counts.
const FULL = /storage|quota|too large|exceed|size limit|limit exceeded|no space/i;

type Fresh = { owner: string; repo: string; state: string; artifact: string; remote: string; previous: string; tip: string; tree: string; queue: string | null; stage: string | null; done: number; total: number; bytes: number; error: string | null; started_at: number; finished_at: number | null };

const row = (env: Env, owner: string, repo: string) =>
  env.DB.prepare("SELECT * FROM fresh_starts WHERE owner = ? AND repo = ?").bind(owner, repo).first() as Promise<Fresh | null>;
const running = (f: Fresh | null) => f?.state === "walking" || f?.state === "copying";

/** /api/repos/:o/:r/limits and /fresh. `a.write` doesn't matter here: only the owner moves git. */
export async function freshRoutes(req: Request, env: Env, p: string[], url: URL, owner: string, repo: string, user: string | null): Promise<Response | null> {
  if (p[4] === "limits" && req.method === "GET") return json(await limits(env, owner, repo, user));
  if (p[4] !== "fresh") return null;
  if (req.method === "GET") return json(await advance(env, owner, repo));
  if (user !== owner) return json({ error: "owner only" }, 403);
  if (req.method === "POST") {
    const f = await start(env, owner, repo);
    return "status" in f ? json({ error: f.error }, f.status) : json(await advance(env, owner, repo), 202);
  }
  if (req.method === "DELETE") {
    const name = url.searchParams.get("artifact") ?? "";
    const r = await env.DB.prepare("SELECT old_artifacts FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
    const old: string[] = JSON.parse((r?.old_artifacts as string) ?? "[]");
    if (!old.includes(name)) return json({ error: "that isn't git this repo moved off" }, 404);
    await env.ARTIFACTS?.delete?.(name);
    await env.DB.prepare("UPDATE repos SET old_artifacts = ? WHERE owner = ? AND name = ?").bind(JSON.stringify(old.filter((n) => n !== name)), owner, repo).run();
    return json({ deleted: name });
  }
  return null;
}

/** Everything that caps this repo and its owner, and where each stands. */
async function limits(env: Env, owner: string, repo: string, user: string | null) {
  const [r, f, pending] = await Promise.all([
    env.DB.prepare("SELECT artifact, git_bytes, git_error, old_artifacts, expires_at FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first(),
    row(env, owner, repo),
    env.DB.prepare("SELECT path FROM git_pending WHERE owner = ? AND repo = ?").bind(owner, repo).all(),
  ]);
  return {
    git: {
      artifact: r?.artifact ?? null, cap: REPO_CAP, fileCap: BLOB_CAP,
      // Measured by a fresh start and added to by each push since; without one, only what we pushed.
      bytes: (r?.git_bytes as number) ?? null, measured: f?.state === "done",
      error: r?.git_error ?? null, full: isFull(r), pending: pending.results.map((x: any) => x.path),
      old: JSON.parse((r?.old_artifacts as string) ?? "[]"),
    },
    fresh: f && { state: f.state, done: f.done, total: f.total, bytes: f.bytes, error: f.error, started_at: f.started_at, finished_at: f.finished_at },
    files: { maxBytes: MAX_BYTES, maxLines: MAX_LINES },
    dig: { expires_at: r?.expires_at ?? null, cap: digCap(env) },
    you: user ? await usage(env, user) : [],
  };
}

const isFull = (r: any) => !!r && ((r.git_bytes ?? 0) >= REPO_CAP * NEARLY_FULL || (!!r.git_error && FULL.test(r.git_error)));

/** After a push that didn't land: if git looks full, start fresh without being asked. */
export async function startIfFull(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT git_bytes, git_error FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!isFull(r) || running(await row(env, owner, repo))) return null;
  const f = await start(env, owner, repo);
  return "status" in f ? null : advance(env, owner, repo);
}

async function start(env: Env, owner: string, repo: string): Promise<Fresh | { error: string; status: number }> {
  const f = await row(env, owner, repo);
  if (running(f)) return f!;
  if (f?.state === "failed") {
    // Pick up where it stopped.
    await env.DB.prepare("UPDATE fresh_starts SET state = ?, error = NULL, lease = NULL WHERE owner = ? AND repo = ?").bind(f.queue ? "walking" : "copying", owner, repo).run();
    return (await row(env, owner, repo))!;
  }
  const h = await handleFor(env, owner, repo);
  if (!h || !env.ARTIFACTS) return { error: "this repo has no git to move", status: 409 };
  const [tip] = await h.handle.log({ ref: h.branch, limit: 1 });
  if (!tip) return { error: "nothing in git yet", status: 409 };
  const r = await env.DB.prepare("SELECT artifact FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  const previous = r!.artifact as string;
  const art = await env.ARTIFACTS.create(`${previous.replace(/\.f[0-9a-z]+$/, "")}.f${Date.now().toString(36)}`, { description: `${owner}/${repo}, started fresh`, setDefaultBranch: h.branch });
  await env.DB.prepare(`INSERT OR REPLACE INTO fresh_starts (owner, repo, state, artifact, remote, previous, tip, tree, queue, started_at)
    VALUES (?, ?, 'walking', ?, ?, ?, ?, ?, ?, ?)`).bind(owner, repo, art.name, art.remote, previous, tip.hash, tip.treeHash, JSON.stringify([tip.treeHash]), Date.now()).run();
  await env.DB.prepare("DELETE FROM fresh_objects WHERE owner = ? AND repo = ?").bind(owner, repo).run();
  return (await row(env, owner, repo))!;
}

/** Take one step if one's due and nobody else is taking it; then where it stands. */
export async function advance(env: Env, owner: string, repo: string) {
  const now = Date.now();
  const got = await env.DB.prepare("UPDATE fresh_starts SET lease = ? WHERE owner = ? AND repo = ? AND state IN ('walking', 'copying') AND (lease IS NULL OR lease < ?) RETURNING *")
    .bind(now, owner, repo, now - 60_000).first() as Fresh | null;
  if (got) {
    try { await step(env, got); }
    catch (e) { await env.DB.prepare("UPDATE fresh_starts SET state = 'failed', error = ? WHERE owner = ? AND repo = ?").bind(String((e as Error).message ?? e), owner, repo).run(); }
    await env.DB.prepare("UPDATE fresh_starts SET lease = NULL WHERE owner = ? AND repo = ?").bind(owner, repo).run();
  }
  return (await limits(env, owner, repo, null)).fresh;
}

/** The five-minute cron: a step for every fresh start under way. */
export async function advanceAll(env: Env) {
  const { results } = await env.DB.prepare("SELECT owner, repo FROM fresh_starts WHERE state IN ('walking', 'copying')").all();
  for (const { owner, repo } of results as { owner: string; repo: string }[]) await advance(env, owner, repo);
}

async function step(env: Env, f: Fresh) {
  const old = await env.ARTIFACTS!.get(f.previous);
  const tree = async (hash: string) => {
    const t = await readTree(env, old, hash);
    if (!t) throw new Error(`tree ${hash} is missing from ${f.previous}`);
    return t;
  };

  if (f.state === "walking") {
    // Read every tree once; D1 keeps them (they're named by hash), so later reads are free.
    const queue: string[] = JSON.parse(f.queue!);
    for (let reads = 0; queue.length && reads < STEP.reads; reads++)
      for (const e of await tree(queue.pop()!)) if (e.type === "tree") queue.push(e.hash);
    if (queue.length) {
      await env.DB.prepare("UPDATE fresh_starts SET queue = ? WHERE owner = ? AND repo = ?").bind(JSON.stringify(queue), f.owner, f.repo).run();
      return;
    }
    // Lay out every object once, what's in a tree before the tree.
    const order: { hash: string; type: string }[] = [], seen = new Set<string>();
    const visit = async (hash: string) => {
      for (const e of await tree(hash)) {
        if (e.type === "gitlink" || seen.has(e.hash)) continue;   // a submodule points elsewhere: nothing to copy
        seen.add(e.hash);
        if (e.type === "tree") await visit(e.hash);
        else order.push({ hash: e.hash, type: "blob" });
      }
      order.push({ hash, type: "tree" });
    };
    await visit(f.tree);
    for (let i = 0; i < order.length; i += 400)
      await env.DB.batch(order.slice(i, i + 400).map((o, j) => env.DB.prepare("INSERT INTO fresh_objects (owner, repo, seq, hash, type) VALUES (?, ?, ?, ?, ?)").bind(f.owner, f.repo, i + j, o.hash, o.type)));
    await env.DB.prepare("UPDATE fresh_starts SET state = 'copying', queue = NULL, total = ? WHERE owner = ? AND repo = ?").bind(order.length, f.owner, f.repo).run();
    return;
  }

  // Copying: the next objects in order, as long as the step has room.
  const { results } = await env.DB.prepare("SELECT hash, type FROM fresh_objects WHERE owner = ? AND repo = ? AND seq >= ? ORDER BY seq LIMIT ?").bind(f.owner, f.repo, f.done, STEP.reads).all();
  const objs: Obj[] = [];
  let size = 0;
  for (const { hash, type } of results as { hash: string; type: string }[]) {
    let o: Obj;
    if (type === "blob") {
      const blob = await old.readBlob(hash);
      if (!blob) throw new Error(`blob ${hash} is missing from ${f.previous}`);
      if (objs.length && size + blob.size > STEP.bytes) break;
      size += blob.size;
      o = await rawObj({ type: "blob", body: new Uint8Array(await blob.arrayBuffer()) });
    } else o = await rawObj({ type: "tree", entries: (await tree(hash)).map((e) => ({ ...e, mode: e.mode.replace(/^0+/, "") })) });
    // Built back byte for byte, or the new tree wouldn't be the old one.
    if (o.id !== hash) throw new Error(`${type} ${hash} came out as ${o.id}`);
    objs.push(o);
  }
  const last = f.done + objs.length === f.total;
  const h = await env.ARTIFACTS!.get(f.artifact);
  const a = await access(h, f.remote, "write", 300);
  const branch = (await h.info().catch(() => null))?.defaultBranch ?? "main";
  const r = await copyObjects(a.remote, a.token, objs, { ref: STAGE, parent: f.stage, author: "codesplitters" },
    last ? { tree: f.tree, branch, message: `Fresh start from ${f.tip.slice(0, 7)}: the same files, in a new Artifact. Every line's history is kept in codeSplitters.` } : undefined);
  await env.DB.prepare("UPDATE fresh_starts SET done = done + ?, bytes = bytes + ?, stage = ? WHERE owner = ? AND repo = ?").bind(objs.length, r.bytes, r.stage, f.owner, f.repo).run();
  if (!last) return;

  // Done: point the repo at the new git, keep the old, and land what waited.
  const repo = await env.DB.prepare("SELECT old_artifacts FROM repos WHERE owner = ? AND name = ?").bind(f.owner, f.repo).first();
  const kept = [...JSON.parse((repo?.old_artifacts as string) ?? "[]"), f.previous];
  await env.DB.batch([
    env.DB.prepare("UPDATE repos SET artifact = ?, artifact_remote = ?, git_bytes = ?, git_error = NULL, old_artifacts = ? WHERE owner = ? AND name = ?")
      .bind(f.artifact, f.remote, f.bytes + r.bytes, JSON.stringify(kept), f.owner, f.repo),
    env.DB.prepare("UPDATE fresh_starts SET state = 'done', finished_at = ? WHERE owner = ? AND repo = ?").bind(Date.now(), f.owner, f.repo),
    env.DB.prepare("DELETE FROM fresh_objects WHERE owner = ? AND repo = ?").bind(f.owner, f.repo),
  ]);
  await flushPending(env, f.owner, f.repo).catch(() => null);
}
