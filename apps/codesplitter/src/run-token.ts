// A hosted agent that runs commands gets its own Artifacts write token for its run (#2300):
// minted as it starts, kept on its agent_runs row, and revoked when it ends however it ends,
// the budget cap's cut (agent-run.ts `tripped`) included. Its TTL is the run's deadline, so a
// Worker that dies mid-run still loses it.

import { handleFor } from "./archive.ts";
import type { Env } from "./env.ts";

const withToken = (remote: string, token: string) => remote.replace("://", `://x:${token.split("?")[0]}@`);

/** A write token for `owner/repo`, stored on run `id`, and the remote it opens. Null when Artifacts can't make one. */
export async function grantRunToken(env: Env, id: number, owner: string, repo: string, ttl: number): Promise<string | null> {
  try {
    const h = await handleFor(env, owner, repo);
    if (!h) return null;
    const { handle, remote } = h;
    const info = await handle.info().catch(() => null);
    const { plaintext } = await handle.createToken("write", Math.max(60, Math.ceil(ttl)));
    await env.DB.prepare("UPDATE agent_runs SET token = ? WHERE id = ?").bind(plaintext, id).run();
    return withToken(info?.remote ?? remote, plaintext);
  } catch { return null; }
}

/** Revokes run `id`'s token and forgets it. Safe to call twice; false when it held none or Artifacts refused. */
export async function revokeRunToken(env: Env, id: number): Promise<boolean> {
  const row = await env.DB.prepare("SELECT owner, repo, token FROM agent_runs WHERE id = ?").bind(id).first<{ owner: string; repo: string; token: string | null }>();
  if (!row?.token) return false;
  try {
    const h = await handleFor(env, row.owner, row.repo);
    if (!h) return false;
    const revoked = await h.handle.revokeToken(row.token);
    await env.DB.prepare("UPDATE agent_runs SET token = NULL WHERE id = ?").bind(id).run();
    return revoked;
  } catch { return false; }
}
