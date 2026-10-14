// Layout: small helpers every file may use: hex, base64url, SHA-256, HTML escaping, plurals, batching
// Imports nothing. Look here before writing a toHex, a digest, an esc or a plural again.

export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The 32 raw bytes of `text`'s SHA-256. */
export const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
/** `text`'s SHA-256 as 64 hex digits. */
export const sha256 = async (text: string) => hex(await digest(text));

/** `s` safe inside HTML text and attribute values. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** "1 line", "3 lines"; pass `many` for an irregular plural. */
export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** A number padded so keys sort in numeric order as text. */
export const pad10 = (n: number) => String(n).padStart(10, "0");
/** `fn` over `items`, `size` at a time, in order. */
export const inBatches = async <T, R>(items: T[], fn: (t: T) => Promise<R>, size = 8): Promise<R[]> => {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
};
