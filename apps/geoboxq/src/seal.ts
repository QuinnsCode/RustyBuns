// The sealed engine: the wasm is AES-256-GCM encrypted at build time (scripts/seal.ts) and opens only
// with the key artstewengine hands to a paid license. Imports nothing from the app: engine.ts (browser)
// and the Worker both use it.

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const aes = (key: string, use: KeyUsage) => crypto.subtle.importKey("raw", b64(key), "AES-GCM", false, [use]);

/** `bytes` as 12 random IV bytes then the ciphertext. `key` is 32 bytes, base64. */
export async function seal(bytes: Uint8Array, key: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aes(key, "encrypt"), bytes as Uint8Array<ArrayBuffer>));
  return Uint8Array.from([...iv, ...out]);
}

/** The bytes `seal` wrapped; throws on the wrong key or a changed file. */
export async function unseal(sealed: Uint8Array, key: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12) }, await aes(key, "decrypt"), sealed.slice(12)));
}

/** `host` and `version` are only told to artstewengine, so the owner can see where a license is running. */
export interface LeaseEnv { ARTSTEW_URL?: string; GEOBOXQ_LICENSE?: string; host?: string; version?: string }

/** A lease is trusted this long past its end when artstewengine can't be reached. Being unpaid is never forgiven. */
export const OUTAGE_GRACE_MS = 24 * 3600_000;

let held: { key: string; until: number } | undefined;

/**
 * The engine key, or null when this deployment hasn't paid (or has no license set). Asks artstewengine
 * once per lease; a network failure rides the last lease for a day, a 402 ends it at once.
 */
export async function engineKey(conf: LeaseEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  if (!conf.ARTSTEW_URL || !conf.GEOBOXQ_LICENSE) return null;
  if (held && now < held.until) return held.key;
  try {
    const res = await fetcher(new URL("/lease", conf.ARTSTEW_URL), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ license: conf.GEOBOXQ_LICENSE, host: conf.host, version: conf.version }) });
    if (res.status === 402) { held = undefined; return null; }
    const body = await res.json() as { ok?: boolean; key?: string; seconds?: number };
    if (!res.ok || !body.ok || !body.key) throw new Error(`lease ${res.status}`);
    held = { key: body.key, until: now + (body.seconds ?? 3600) * 1000 };
    return body.key;
  } catch {
    return held && now < held.until + OUTAGE_GRACE_MS ? held.key : null;
  }
}

/** For tests: forget the lease. */
export const forgetLease = () => { held = undefined; };
