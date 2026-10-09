// Share a range of lines, not a whole repo. GitHub's permalink freezes a
// commit and needs the repo to be public; this link follows the lines (by id)
// as they're edited, and works from a private repo without opening the rest.
//   POST   /api/repos/:o/:r/shares {path, from, to, note}  from/to are line numbers now
//   GET    /api/shares/:id      the lines as they are now, for anyone with the link
//   DELETE /api/shares/:id      whoever shared it, or the repo's owner

import { materialize, toFile } from "./archive.ts";
import { json, type Env } from "./env.ts";

interface Line { id: string; text: string; by: string; rev: number }
const fileLines = async (env: Env, owner: string, repo: string, path: string) =>
  ((await (await toFile(env, owner, repo, path, "share", "file")).json()) as { lines: Line[] }).lines;

/** Who may share from a repo: anyone who can read a public one; only its crew for a private one. */
export async function createShare(env: Env, owner: string, repo: string, user: string | null, access: { read: boolean; write: boolean }, private_: boolean, body: any) {
  if (!user) return json({ error: "sign in first" }, 401);
  if (private_ && !access.write) return json({ error: "only the crew can share lines from a private repo" }, 403);
  const path = String(body?.path ?? "");
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return json({ error: m.error }, m.status);
  const lines = await fileLines(env, owner, repo, path);
  const from = Math.max(1, Math.floor(Number(body.from))), to = Math.min(lines.length, Math.max(from, Math.floor(Number(body.to))));
  if (!lines[from - 1]) return json({ error: "no such lines" }, 400);
  if (to - from >= 500) return json({ error: "share at most 500 lines" }, 400);
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await env.DB.prepare("INSERT INTO shares (id, owner, repo, path, ids, by, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, owner, repo, path, JSON.stringify(lines.slice(from - 1, to).map((l) => l.id)), user, String(body.note ?? "").slice(0, 280), Date.now()).run();
  return json({ id, from, to }, 201);
}

export async function shareRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "shares" || !p[2]) return null;
  const s = await env.DB.prepare("SELECT * FROM shares WHERE id = ?").bind(p[2]).first();
  if (!s) return json({ error: "this share was revoked, or never was" }, 404);
  if (req.method === "DELETE") {
    if (user !== s.by && user !== s.owner) return json({ error: "only whoever shared it, or the repo's owner" }, 403);
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(s.id).run();
    return json({ ok: true });
  }
  // The range is wherever its surviving lines are now, plus anything written between them.
  const wanted = new Set(JSON.parse(s.ids) as string[]);
  const lines = await fileLines(env, s.owner, s.repo, s.path);
  const hit = lines.flatMap((l, i) => (wanted.has(l.id) ? [i] : []));
  const repo = await env.DB.prepare("SELECT visibility FROM repos WHERE owner = ? AND name = ?").bind(s.owner, s.repo).first();
  const out = { id: s.id, owner: s.owner, repo: s.repo, path: s.path, by: s.by, note: s.note, created_at: s.created_at, visibility: repo?.visibility ?? "public" };
  if (!hit.length) return json({ ...out, lines: [], gone: true });
  const a = hit[0]!, b = hit[hit.length - 1]!;
  return json({ ...out, from: a + 1, to: b + 1, lines: lines.slice(a, b + 1).map((l, k) => ({ n: a + k + 1, text: l.text, by: l.by, rev: l.rev })) });
}
