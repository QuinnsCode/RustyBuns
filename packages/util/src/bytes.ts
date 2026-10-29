// Bytes as text, and the one hash everything uses. The apps used to copy these four lines each.

/** Bytes as lowercase hex, two digits each. */
export const hex = (b: ArrayBuffer | Uint8Array): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Bytes as URL-safe base64 with no padding: fits in a URL or a cookie as is. */
export const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The 32 raw bytes of `text`'s SHA-256. */
export const digest = async (text: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** `text`'s SHA-256 as 64 hex digits. */
export const sha256 = async (text: string): Promise<string> => hex(await digest(text));
