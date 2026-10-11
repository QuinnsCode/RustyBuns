// Stamps: react to a line, not a pull request. A stamp is keyed by the line's
// id, so it stays on its line through edits the way a share does, and goes when
// the line is deleted. People's lines and agents' lines take them alike.
//   POST   /api/repos/:o/:r/stamps {path, stamp, lines?, from?, to?}  stamp lines: ids, or line numbers now
//   DELETE /api/repos/:o/:r/stamps?path=&stamp=&line=                  take your stamp off a line
//   GET    /api/repos/:o/:r/stamps?path=                               the file's stamps, line by line, as it is now
// Who may stamp: anyone signed in who can read the repo. A private line is the crew's
// to stamp and see stamped, like its text.

import { materialize, toFile } from "./archive.ts";
import { json, readBody, type Env } from "./env.ts";

export const STAMPS = ["+1", "heart", "binoculars", "shovel", "gem", "skull", "lgtm"] as const;
/** How many lines one stamp may go on at once. */
const MAX_LINES = 100;

interface Line { id: string; by: string; private?: true }
const fileLines = async (env: Env, owner: string, repo: string, path: string, crew: boolean) =>
  ((await (await toFile(env, owner, repo, path, "stamp", "file", { headers: { "x-codesplitters-crew": crew ? "1" : "0" } })).json()) as { lines: Line[] }).lines;

/** Tell the pages that have the file open that its stamps changed (file-do.ts). */
const stamped = (env: Env, owner: string, repo: string, path: string) => toFile(env, owner, repo, path, "stamp", "stamped", { method: "POST" });

export async function stampRoutes(req: Request, env: Env, p: string[], url: URL, owner: string, repo: string, user: string | null, a: { read: boolean; write: boolean }): Promise<Response | null> {
  if (p[4] !== "stamps" || p[5]) return null;
  const q = req.method === "POST" ? await readBody<"path" | "line" | "lines" | "stamp" | "from" | "to">(req) : Object.fromEntries(url.searchParams);
  const path = String(q.path ?? "");
  if (!path) return json({ error: "path required" }, 400);
  const m = await materialize(env, owner, repo, path);
  if ("error" in m) return json({ error: m.error }, m.status);
  const lines = await fileLines(env, owner, repo, path, a.write);
  // Outside the crew a private line's stamps are hidden, as its text is.
  const shown = (l: Line) => a.write || !l.private;

  if (req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT line, stamp, by, created_at FROM stamps WHERE owner = ? AND repo = ? AND path = ? ORDER BY created_at, rowid")
      .bind(owner, repo, path).all();
    const at = new Map(lines.flatMap((l, i) => (shown(l) ? [[l.id, i] as const] : [])));
    const out = new Map<string, { line: string; n: number; stamps: Record<string, string[]> }>();
    for (const s of results as { line: string; stamp: string; by: string }[]) {
      const i = at.get(s.line);
      if (i === undefined) continue;   // the line was deleted, or it's private and you're not crew
      const o = out.get(s.line) ?? { line: s.line, n: i + 1, stamps: {} };
      (o.stamps[s.stamp] ??= []).push(s.by);
      out.set(s.line, o);
    }
    return json([...out.values()].sort((x, y) => x.n - y.n));
  }

  if (req.method !== "POST" && req.method !== "DELETE") return null;
  if (!user) return json({ error: "sign in first" }, 401);
  const stamp = String(q.stamp ?? "");
  if (!(STAMPS as readonly string[]).includes(stamp)) return json({ error: `stamp: ${STAMPS.join(", ")}` }, 400);

  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM stamps WHERE owner = ? AND repo = ? AND path = ? AND line = ? AND stamp = ? AND by = ?")
      .bind(owner, repo, path, String(q.line ?? ""), stamp, user).run();
    await stamped(env, owner, repo, path);
    return json({ ok: true });
  }

  let picked: Line[];
  if (Array.isArray(q.lines)) {
    const want = new Set(q.lines.map(String));
    picked = lines.filter((l) => shown(l) && want.has(l.id));
  } else {
    const from = Math.max(1, Math.floor(Number(q.from))), to = Math.min(lines.length, Math.max(from, Math.floor(Number(q.to ?? q.from))));
    picked = lines.slice(from - 1, to).filter(shown);
  }
  if (!picked.length) return json({ error: "no such lines" }, 400);
  if (picked.length > MAX_LINES) return json({ error: `stamp at most ${MAX_LINES} lines at once` }, 400);
  const now = Date.now();
  await env.DB.batch(picked.map((l) => env.DB.prepare("INSERT OR IGNORE INTO stamps (owner, repo, path, line, stamp, by, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(owner, repo, path, l.id, stamp, user, l.by, now)));
  await stamped(env, owner, repo, path);
  return json({ stamp, lines: picked.map((l) => l.id) }, 201);
}

/**
 * The latest stamps `who` gave, or got on lines they wrote, in repos `viewer` may read:
 * what a profile shows, and what a feed of line events takes.
 */
export async function recentStamps(env: Env, viewer: string | null, who: string, side: "by" | "author", limit = 20) {
  const { results } = await env.DB.prepare(`
    SELECT s.owner, s.repo, s.path, s.line, s.stamp, s.by, s.author, s.created_at
    FROM stamps s JOIN repos r ON r.owner = s.owner AND r.name = s.repo
    WHERE s.${side} = ? AND (r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR r.owner = ?
      OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))
    ORDER BY s.created_at DESC, s.rowid DESC LIMIT ?`).bind(who, Date.now(), viewer, viewer, limit).all();
  return results;
}
