// The rev of each file you last saw (#779), kept per account so the file page catches you
// up on what landed since, on any device. Signed out, the page keeps it in the browser only.
//   GET /api/me/seen?key=        {rev}: the rev you last saw under that key, or null
//   PUT /api/me/seen {key, rev}  you've seen it at rev
// A key is the page's own name for a file (owner/repo:branch:path); the newest LAST_SEEN stay.

import { json, need, readBody, type Env } from "./env.ts";
import { int, obj, str } from "@rustybuns/util/guard";

export const LAST_SEEN = 500;

export async function seenRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null): Promise<Response | null> {
  if (p[1] !== "me" || p[2] !== "seen" || p[3] || (req.method !== "GET" && req.method !== "PUT")) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (req.method === "GET") {
    const key = url.searchParams.get("key") ?? "";
    const r = key ? await env.DB.prepare("SELECT rev FROM last_seen WHERE name = ? AND key = ?").bind(user, key).first() : null;
    return json({ rev: r ? Number(r.rev) : null });
  }
  const b = need(await readBody(req), obj({ key: str(1024), rev: int(0, Infinity) }));
  if (b instanceof Response) return b;
  const by = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  await env.DB.batch([
    by("INSERT INTO last_seen (name, key, rev, at) VALUES (?, ?, ?, ?) ON CONFLICT (name, key) DO UPDATE SET rev = excluded.rev, at = excluded.at", user, b.key, b.rev, Date.now()),
    by("DELETE FROM last_seen WHERE name = ? AND key NOT IN (SELECT key FROM last_seen WHERE name = ? ORDER BY at DESC, rowid DESC LIMIT ?)", user, user, LAST_SEEN),
  ]);
  return json({ ok: true });
}
