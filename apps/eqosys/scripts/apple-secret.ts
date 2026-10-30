// The client secret Sign in with Apple wants: an ES256 JWT signed with your Apple key, good for at most six months.
// Usage: bun scripts/apple-secret.ts <teamId> <keyId> <servicesId> < AuthKey_XXXX.p8
// Paste the output into 1Password (op://eqosys/apple/client-secret) and redeploy; put a reminder in the calendar for five months on.
import { b64url } from "@rustybuns/util/bytes";

const [team, kid, sub] = process.argv.slice(2);
if (!team || !kid || !sub) throw new Error("usage: bun scripts/apple-secret.ts <teamId> <keyId> <servicesId> < AuthKey.p8");
const pem = (await Bun.stdin.text()).replace(/-----[^-]+-----|\s/g, "");
const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const now = Math.floor(Date.now() / 1000);
const body = `${enc({ alg: "ES256", kid })}.${enc({ iss: team, iat: now, exp: now + 15_777_000, aud: "https://appleid.apple.com", sub })}`;
const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(body)));
console.log(`${body}.${b64url(sig)}`);
