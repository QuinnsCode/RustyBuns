// Limits, and the fresh start. Artifacts holds 1 GB a repo and every commit
// adds to it. When a repo's git nears that, it moves to a new Artifact that
// holds only its current files: one root commit with the very same tree. No
// line loses its authors or history, because those live in each file's
// Durable Object, not in git. The old Artifact is kept, history and all,
// until the owner deletes it.
//
// It copies in steps small enough for one request (a bounded number of
// Artifacts reads, a pack of a few MB), each step its own push, so a big repo
// moves over many requests: the page's polls and the hourly cron drive it.
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
/** Blobs are numbered up from 1 and trees down from here, so every blob is copied before every tree. */
const TREES = 2 ** 50;
// Cloudflare's wording for a full repo isn't documented; anything that reads like one counts.
const FULL = /storage|quota|too large|exceed|size limit|limit exceeded|no space/i;

type Fresh = { owner: string; repo: string; state: string; artifact: string; remote: string; previous: string; tip: string; tree: string; queue: string | null; stage: string | null; seq: number; done: number; total: number; bytes: number; error: string | null; started_at: number; finished_at: number | null };

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

/** A hash, checked, to write straight into SQL (D1 binds at most 100 values a query). */
const sha = (h: string) => { if (!/^[0-9a-f]{40}$/.test(h)) throw new Error(`not a git hash: ${h}`); return h; };

const isFull = (r: any) => !!r && ((r.git_bytes ?? 0) >= REPO_CAP * NEARLY_FULL || (!!r.git_error && FULL.test(r.git_error)));

/** After a push that didn't land: if git looks full, start fresh without being asked. */
export async function startIfFull(env: Env, owner: string, repo: string) {
  const r = await env.DB.prepare("SELECT git_bytes, git_error FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!isFull(r) || running(await row(env, owner, repo))) return null;
  const f = await start(env, owner, repo);
  return "status" in f ? null : advance(env, owner, repo);
}

async function start(env: Env, owner: string, repo: string): Promise<Fresh | { error: string; status: number }> {
  // A mirror's git builds on upstream's history (mirror.ts); one root commit would cut it off.
  if (await env.DB.prepare("SELECT 1 FROM repos WHERE owner = ? AND name = ? AND mirror_url IS NOT NULL").bind(owner, repo).first())
    return { error: "a mirror's git shares upstream's history, so it doesn't start fresh", status: 409 };
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
  await env.DB.batch([
    env.DB.prepare(`INSERT OR REPLACE INTO fresh_starts (owner, repo, state, artifact, remote, previous, tip, tree, queue, seq, started_at)
      VALUES (?, ?, 'walking', ?, ?, ?, ?, ?, ?, 1, ?)`).bind(owner, repo, art.name, art.remote, previous, tip.hash, tip.treeHash, JSON.stringify([[tip.treeHash, TREES]]), Date.now()),
    env.DB.prepare("DELETE FROM fresh_objects WHERE owner = ? AND repo = ?").bind(owner, repo),
    env.DB.prepare("INSERT INTO fresh_objects (owner, repo, hash, type, seq) VALUES (?, ?, ?, 'tree', ?)").bind(owner, repo, tip.treeHash, TREES),
  ]);
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

/**
 * The hourly cron: steps for every fresh start under way, round after round
 * until `until` (ms), so a big repo moves with nobody watching. A round whose
 * steps a page's poll is already taking just waits a moment for the next.
 */
export async function advanceAll(env: Env, until = 0) {
  for (;;) {
    const { results } = await env.DB.prepare("SELECT owner, repo FROM fresh_starts WHERE state IN ('walking', 'copying')").all();
    for (const { owner, repo } of results as { owner: string; repo: string }[]) await advance(env, owner, repo);
    if (!results.length || Date.now() >= until) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function step(env: Env, f: Fresh) {
  const old = await env.ARTIFACTS!.get(f.previous);
  const tree = async (hash: string) => {
    const t = await readTree(env, old, hash);
    if (!t) throw new Error(`tree ${hash} is missing from ${f.previous}`);
    return t;
  };

  if (f.state === "walking") {
    // Read each tree once (D1 keeps them, named by hash) and number what's in it as it turns
    // up: one query a tree, so no step's D1 work grows with the repo. A tree found later is
    // copied sooner. One found again under a parent that would be copied before it is
    // renumbered and read again, so a tree shared by two folders still lands before both.
    const queue: [string, number][] = JSON.parse(f.queue!);
    let seq = f.seq;
    for (let reads = 0; queue.length && reads < STEP.reads; reads++) {
      const [hash, at] = queue.pop()!;
      const rows = (await tree(hash)).filter((e) => e.type !== "gitlink")   // a submodule points elsewhere: nothing to copy
        .map((e) => `(?1, ?2, '${sha(e.hash)}', '${e.type === "tree" ? "tree" : "blob"}', ${e.type === "tree" ? TREES - seq++ : seq++})`);
      for (let i = 0; i < rows.length; i += 1000) {
        const { results } = await env.DB.prepare(`INSERT INTO fresh_objects (owner, repo, hash, type, seq) VALUES ${rows.slice(i, i + 1000).join(", ")}
          ON CONFLICT (owner, repo, hash) DO UPDATE SET seq = excluded.seq WHERE fresh_objects.type = 'tree' AND fresh_objects.seq >= ?3
          RETURNING hash, type, seq`).bind(f.owner, f.repo, at).all();
        for (const r of results as { hash: string; type: string; seq: number }[]) if (r.type === "tree") queue.push([r.hash, r.seq]);
      }
    }
    if (queue.length) {
      await env.DB.prepare("UPDATE fresh_starts SET queue = ?, seq = ? WHERE owner = ? AND repo = ?").bind(JSON.stringify(queue), seq, f.owner, f.repo).run();
      return;
    }
    await env.DB.prepare(`UPDATE fresh_starts SET state = 'copying', queue = NULL, seq = 0,
      total = (SELECT COUNT(*) FROM fresh_objects WHERE owner = ?1 AND repo = ?2) WHERE owner = ?1 AND repo = ?2`).bind(f.owner, f.repo).run();
    return;
  }

  // Copying: the next objects in order, as long as the step has room.
  const { results } = await env.DB.prepare("SELECT hash, type, seq FROM fresh_objects WHERE owner = ? AND repo = ? AND seq > ? ORDER BY seq LIMIT ?").bind(f.owner, f.repo, f.seq, STEP.reads).all();
  const objs: Obj[] = [];
  let size = 0, upTo = f.seq;
  for (const { hash, type, seq } of results as { hash: string; type: string; seq: number }[]) {
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
    upTo = seq;
  }
  const last = f.done + objs.length === f.total;
  const h = await env.ARTIFACTS!.get(f.artifact);
  const a = await access(h, f.remote, "write", 300);
  const branch = (await h.info().catch(() => null))?.defaultBranch ?? "main";
  const r = await copyObjects(a.remote, a.token, objs, { branch, parent: f.stage, author: "codesplitters" },
    last ? { tree: f.tree, message: `Fresh start from ${f.tip.slice(0, 7)}: the same files, in a new Artifact. Every line's history is kept in codeSplitters.` } : undefined);
  await env.DB.prepare("UPDATE fresh_starts SET done = done + ?, bytes = bytes + ?, stage = ?, seq = ? WHERE owner = ? AND repo = ?").bind(objs.length, r.bytes, r.stage, upTo, f.owner, f.repo).run();
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
