// An SSH public key, and what the key lookup answers (#5504): shared by codeSplitter's routes (ssh-keys.ts) and the
// ssh gate (ssh-gate.ts), which asks the lookup who owns the key sshd was offered. Imports only the guards, so
// either side can take it.

import { int, obj, str, type Of } from "@rustybuns/util/guard";

/** The kinds of key sshd takes from codeSplitter users: ed25519, ECDSA and RSA, and their security-key forms. */
export const KEY_TYPES = [
  "ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa",
  "sk-ssh-ed25519@openssh.com", "sk-ecdsa-sha2-nistp256@openssh.com",
] as const;

/** A handle (env.ts's NAME), so it can go into the forced command as it is. */
const HANDLE = /^(?=.{1,39}$)[a-z0-9]+(-[a-z0-9]+)*$/;
/** `type base64`: a key as it goes on an authorized_keys line, with no comment and nothing a line could break on. */
const KEY = /^[a-z0-9@.-]+ [A-Za-z0-9+/]+={0,2}$/;

/** GET /api/ssh/key?fingerprint=: the key with that fingerprint, and whose it is. A 404 when nobody added it. */
export const SshKeyOwner = obj({ user: str(39, { re: HANDLE }), key: str(16_384, { re: KEY }) });
export type SshKeyOwner = Of<typeof SshKeyOwner>;

/** One of your keys, as GET and POST /api/me/ssh-keys answer it: never the key itself, only its fingerprint. */
export const SshKeyRow = obj({ id: int(1, Number.MAX_SAFE_INTEGER), fingerprint: str(60), type: str(60), title: str(100, { min: 0 }), added_at: int(0, Number.MAX_SAFE_INTEGER) });
export type SshKeyRow = Of<typeof SshKeyRow>;

/** A key as it was pasted (`ssh-ed25519 AAAA... me@laptop`), taken apart: its `type base64` and its comment. */
export interface ParsedKey { type: string; key: string; comment: string; blob: Uint8Array<ArrayBuffer> }

/**
 * Read a pasted public key, or say what's wrong with it. The blob must be base64 and name the same type the
 * line does (its first field), so a key can't claim to be another kind.
 */
export function parseKey(text: string): ParsedKey | string {
  const parts = text.trim().split(/\s+/);
  const [type = "", b64 = ""] = parts;
  if (!(KEY_TYPES as readonly string[]).includes(type)) return `an OpenSSH public key: ${KEY_TYPES.join(", ")}, then its base64 (the .pub file's line)`;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length > 16_000) return "the key's second field is its base64";
  let blob: Uint8Array<ArrayBuffer>;
  try { blob = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return "the key's second field is its base64"; }
  const n = blob.length >= 4 ? new DataView(blob.buffer).getUint32(0) : -1;
  if (n !== type.length || new TextDecoder().decode(blob.subarray(4, 4 + n)) !== type) return `the key's base64 isn't a ${type} key`;
  const comment = parts.slice(2).join(" ").slice(0, 100);
  return { type, key: `${type} ${b64}`, comment, blob };
}

/** The key's fingerprint as sshd and `ssh-keygen -lf` print it: `SHA256:` and the hash in base64 without padding. */
export async function fingerprint(blob: Uint8Array<ArrayBuffer>): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", blob));
  return `SHA256:${btoa(String.fromCharCode(...hash)).replace(/=+$/, "")}`;
}
