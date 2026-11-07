// Bytes as text, and the one hash everything uses. The apps used to copy these four lines each.

/** Bytes as lowercase hex, two digits each. */
export const hex = (b: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Bytes as base64, any size: a few KB at a time, since spreading a megabyte into one call overflows the stack. */
export const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Bytes as URL-safe base64 with no padding: fits in a URL or a cookie as is. */
export const b64url = (b: Uint8Array): string => b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The 32 raw bytes of `text`'s SHA-256. */
export const digest = async (text: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** `text`'s SHA-256 as 64 hex digits. */
export const sha256 = async (text: string): Promise<string> => hex(await digest(text));

const hmacKey = (secret: string, use: "sign" | "verify") =>
  crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [use]);

/** The HMAC-SHA256 of `body` under `secret`, as 64 hex digits: what a signed webhook or report carries in a header. */
export const hmacHex = async (secret: string, body: string): Promise<string> =>
  hex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), new TextEncoder().encode(body)));

/** Whether `sig` (64 lowercase hex digits) is `hmacHex(secret, body)`. crypto.subtle.verify compares in constant time. */
export async function hmacSigned(secret: string, body: string, sig: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), Uint8Array.from(sig.match(/../g)!, (h) => parseInt(h, 16)), new TextEncoder().encode(body));
}

/** The bytes `b64url` wrote, back: a JWT's parts, a key's coordinates. Throws on text that isn't base64. */
export const unb64url = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
