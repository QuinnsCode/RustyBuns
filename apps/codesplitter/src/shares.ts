// Share a range of lines, not a whole repo. GitHub's permalink freezes a
// commit and needs the repo to be public; this link follows the lines (by id)
// as they're edited, and works from a private repo without opening the rest.
//   POST   /api/repos/:o/:r/shares {path, from, to, note}  from/to are line numbers now
//   GET    /api/repos/:o/:r/shares   every share of the repo, and whether each still serves (owner only)
//   GET    /api/shares/:id      the lines as they are now, for anyone with the link
//   DELETE /api/shares/:id      whoever shared it, or the repo's owner
//
// A share of a private repo serves only while its sharer can still read the repo: one who left the crew (or a reader of a
// public repo that went private) has handed out a link that stops, like a beam (#2321). The row stays, so the owner sees it
// in the list, and a sharer let back in gets their link back.

import { fileLines, materialize } from "./archive.ts";
import { fail, json, type Body, type Env, unread } from "./env.ts";
import { repoRow, liveRepo } from "./repos.ts";

/** Whether `who` may read owner/repo now (worker.ts's access). */
export type MayRead = (owner: string, repo: string, who: string) => Promise<boolean>;

interface ShareRow { id: string; owner: string; repo: string; path: string; ids: string; by: string; note: string; created_at: number }

/** GET /api/repos/:o/:r/shares: every share of the repo, newest first, and whether its sharer still holds it open. The owner's to see. */
export async function listShares(env: Env, owner: string, repo: string, user: string | null, mayRead: MayRead) {
  if (user !== owner) return fail("OwnerOnly", "only the repo's owner lists its shares");
  const { results } = await env.DB.prepare("SELECT id, path, by, note, created_at FROM shares WHERE owner = ? AND repo = ? ORDER BY created_at DESC LIMIT 500")
    .bind(owner, repo).all<Pick<ShareRow, "id" | "path" | "by" | "note" | "created_at">>();
  const can = new Map<string, boolean>();
  for (const r of results) if (!can.has(r.by)) can.set(r.by, await mayRead(owner, repo, r.by));
  return json(results.map((r) => ({ ...r, serving: can.get(r.by)! })));
}

/** Who may share from a repo: anyone who can read a public one; only its crew for a private one. */
export async function createShare(env: Env, owner: string, repo: string, user: string | null, access: { read: boolean; write: boolean }, private_: boolean, body: Body<"path" | "from" | "to" | "note">) {
  if (!user) return fail("SignInFirst", "sign in to share lines");
  if (private_ && !access.write) return fail("NoWriteAccess", "only the crew can share lines from a private repo");
  const path = String(body?.path ?? "");
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return unread(m);
  const lines = await fileLines(env, owner, repo, path, "share", false);
  const from = Math.max(1, Math.floor(Number(body.from))), to = Math.min(lines.length, Math.max(from, Math.floor(Number(body.to))));
  if (!lines[from - 1]) return fail("BadInput", "the file has no such lines");
  if (to - from >= 500) return fail("BadInput", "share at most 500 lines");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await env.DB.prepare("INSERT INTO shares (id, owner, repo, path, ids, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, owner, repo, path, JSON.stringify(lines.slice(from - 1, to).map((l) => l.id)), user, String(body.note ?? "").slice(0, 280), Date.now()).run();
  return json({ id, from, to }, 201);
}

export async function shareRoutes(req: Request, env: Env, p: string[], user: string | null, mayRead: MayRead): Promise<Response | null> {
  if (p[1] !== "shares" || !p[2]) return null;
  const s = await env.DB.prepare(`SELECT s.* FROM shares s ${liveRepo("s")} WHERE s.id = ?`).bind(Date.now(), p[2]).first<ShareRow>();
  const gone = fail("NoSuchShare", "this share was revoked, or never was");
  if (!s) return gone;
  if (req.method === "DELETE") {
    if (user !== s.by && user !== s.owner) return fail("NotYourShare", "only whoever shared it, or the repo's owner, revokes a share");
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(s.id).run();
    return json({ ok: true });
  }
  // A sharer who can't read the repo any more (it's private, and they're not crew) holds no link open: it answers as revoked.
  const repo = await repoRow(env, s.owner, s.repo, "visibility");
  if (repo?.visibility === "private" && !(await mayRead(s.owner, s.repo, s.by))) return gone;
  // The range is wherever its surviving lines are now, plus anything written between them.
  const wanted = new Set(JSON.parse(s.ids) as string[]);
  // Anyone with the link reads it, so private lines come as placeholders.
  const lines = await fileLines(env, s.owner, s.repo, s.path, "share", false);
  const hit = lines.flatMap((l, i) => (wanted.has(l.id) ? [i] : []));
  const out = { id: s.id, owner: s.owner, repo: s.repo, path: s.path, by: s.by, note: s.note, created_at: s.created_at, visibility: repo?.visibility ?? "public" };
  if (!hit.length) return json({ ...out, lines: [], gone: true });
  const a = hit[0]!, b = hit[hit.length - 1]!;
  return json({ ...out, from: a + 1, to: b + 1, lines: lines.slice(a, b + 1).map((l, k) => ({ id: l.id, n: a + k + 1, text: l.text, by: l.by, rev: l.rev, ...(l.private && { private: true }) })) });
}
