// Read tokens handed to people other than a repo's owner: a share link's, or the clone line on the repo's page.
// Artifacts can take a token back, so each is kept until it lapses, and going private recalls those held by
// anyone outside the crew: a stranger's clone line stops working the moment the repo does.

import { access, handleFor } from "./archive.ts";
import type { Env } from "./env.ts";

type Handle = NonNullable<Awaited<ReturnType<typeof handleFor>>>;

/** A read token for `who` (null: signed out) on `owner/repo`, kept for `recall` unless it's the owner's own. */
export async function handOut(env: Env, owner: string, repo: string, who: string | null, h: Handle, ttl: number) {
  const art = await access(h.handle, h.remote, "read", ttl);
  if (who !== owner) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM handed_tokens WHERE expires_at <= ?").bind(now),
      env.DB.prepare("INSERT INTO handed_tokens (owner, repo, who, token, expires_at) VALUES (?, ?, ?, ?, ?)").bind(owner, repo, who ?? "", art.token, now + ttl * 1000),
    ]);
  }
  return art;
}

/** Revokes every live token handed out on `owner/repo` to someone not in `keep`. One Artifacts refuses stays, to lapse. */
export async function recall(env: Env, owner: string, repo: string, keep: string[]) {
  const { results } = await env.DB.prepare("SELECT rowid AS id, who, token FROM handed_tokens WHERE owner = ? AND repo = ? AND expires_at > ?")
    .bind(owner, repo, Date.now()).all<{ id: number; who: string; token: string }>();
  const gone = results.filter((t) => !keep.includes(t.who));
  if (!gone.length) return 0;
  const h = await handleFor(env, owner, repo).catch(() => null);
  let n = 0;
  for (const t of gone) {
    const revoked = h ? await h.handle.revokeToken(t.token).catch(() => false) : false;
    if (revoked) { n++; await env.DB.prepare("DELETE FROM handed_tokens WHERE rowid = ?").bind(t.id).run(); }
    else console.error(`${owner}/${repo}: Artifacts kept a handed-out read token; it lapses on its own`);
  }
  return n;
}
