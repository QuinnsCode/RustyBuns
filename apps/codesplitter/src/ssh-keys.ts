// SSH keys for git over ssh:// (#5504). A person adds a public key; the ssh gate's sshd (ssh/) asks the lookup
// who owns the key a client offers, and lets it in as them. A key belongs to one person: adding one someone else
// has added is a 409. Adding one is a person's, signed in on the site, never an API token's: a key outlives any token, so a
// token that could add one could give itself a way in that revoking it wouldn't end. Removing one, a token may.
//
//   GET    /api/me/ssh-keys                    [{id, fingerprint, type, title, added_at}]
//   POST   /api/me/ssh-keys                    {key, title?}: add one (201), up to 50
//   DELETE /api/me/ssh-keys/:id
//   GET    /api/ssh/key?fingerprint=SHA256:…   {user, key} (SshKeyOwner), or 404: the gate's lookup, open to anyone
//                                             (like a forge's public keys page, it says only whose a key is)

import { audit } from "./audit.ts";
import { fail, json, need, readBody, type Env } from "./env.ts";
import { fingerprint, parseKey, type SshKeyOwner, type SshKeyRow } from "./ssh-key.ts";
import { byToken } from "./tokens.ts";
import { obj, str } from "@rustybuns/util/guard";

export const MAX_SSH_KEYS = 50;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;

export async function sshKeyRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null): Promise<Response | null> {
  if (p[1] === "ssh" && p[2] === "key" && !p[3] && req.method === "GET") {
    const fp = url.searchParams.get("fingerprint") ?? "";
    if (!FINGERPRINT.test(fp)) return fail("BadInput", "fingerprint: SHA256: and 43 base64 characters, as sshd's %f gives it");
    const row = await env.DB.prepare("SELECT user, key FROM ssh_keys WHERE fingerprint = ?").bind(fp).first<SshKeyOwner>();
    return row ? json({ user: row.user, key: row.key } satisfies SshKeyOwner) : fail("NoSuchSshKey", "nobody here added that key");
  }
  if (p[1] !== "me" || p[2] !== "ssh-keys" || p[4]) return null;
  if (!user) return fail("SignInFirst", "sign in first");
  const id = p[3];
  if (!id) {
    if (req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, fingerprint, type, title, added_at FROM ssh_keys WHERE user = ? ORDER BY id").bind(user).all<SshKeyRow>();
      return json(results satisfies SshKeyRow[]);
    }
    if (req.method !== "POST") return null;
    if (byToken(req)) return fail("PersonOnly", "an SSH key is added on the site, signed in: an API token can't add one");
    const b = need(await readBody(req), obj({ key: str(16_384, { re: /\S/ }), title: str(100, { min: 0, dflt: "" }) }),
      "key is required: the line of your .pub file (ssh-ed25519 AAAA... you@laptop)");
    if (b instanceof Response) return b;
    const parsed = parseKey(b.key);
    if (typeof parsed === "string") return fail("BadInput", `key: ${parsed}`);
    const fp = await fingerprint(parsed.blob);
    const title = b.title.trim() || parsed.comment;
    const at = Date.now();
    // The cap is checked in the write itself, so two adds at once can't both take the last slot.
    const r = await env.DB.prepare(`INSERT INTO ssh_keys (user, fingerprint, type, key, title, added_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE (SELECT COUNT(*) FROM ssh_keys WHERE user = ?1) < ?7 ON CONFLICT (fingerprint) DO NOTHING`)
      .bind(user, fp, parsed.type, parsed.key, title, at, MAX_SSH_KEYS).run();
    if (!r.meta?.changes) {
      const taken = await env.DB.prepare("SELECT user FROM ssh_keys WHERE fingerprint = ?").bind(fp).first<{ user: string }>();
      if (taken) return fail("SshKeyTaken", taken.user === user ? "you have added that key already" : "that key is someone else's here: make a new one");
      return fail("TooManySshKeys", `at most ${MAX_SSH_KEYS} SSH keys: remove one first`);
    }
    const row = await env.DB.prepare("SELECT id, fingerprint, type, title, added_at FROM ssh_keys WHERE fingerprint = ?").bind(fp).first<SshKeyRow>();
    await audit(env, req, { actor: user, action: "ssh_key.add", target: fp, detail: title || null });
    return json(row satisfies SshKeyRow | null, 201);
  }
  if (req.method !== "DELETE") return null;
  const row = await env.DB.prepare("DELETE FROM ssh_keys WHERE user = ? AND id = ? RETURNING fingerprint").bind(user, Number(id) || 0).first<{ fingerprint: string }>();
  if (!row) return fail("NoSuchSshKey", "you have no SSH key by that id");
  await audit(env, req, { actor: user, action: "ssh_key.remove", target: row.fingerprint });
  return json({ ok: true });
}
