// Sign in with Apple's server-to-server notifications: POST /api/apple/events. Apple sends `{ payload: <JWT> }` when
// someone stops using Sign in with Apple with us (consent-revoked), deletes their Apple account (account-delete), or
// turns their relay email on or off (email-enabled, email-disabled). The JWT is RS256, signed with a key from
// https://appleid.apple.com/auth/keys, for `aud` = our Services ID (APPLE_CLIENT_ID). Its `events` claim is itself a
// JSON string. The URL is registered with the Services ID in Apple's developer portal (#3306).
import { sha256, unb64url } from "@rustybuns/util/bytes";
import { arr, check, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { readBody } from "@rustybuns/util/http";
import { JWKS_KEEP_MS, JWKS_RETRY_MS } from "@rustybuns/util/token";
import { json, type Env } from "./env.ts";
import { deleteAccount, signOutEverywhere } from "./members.ts";

export const APPLE_ISS = "https://appleid.apple.com";
export const APPLE_KEYS = `${APPLE_ISS}/auth/keys`;

const RsaJwk = obj({ kty: oneOf(["RSA"]), kid: str(64), n: str(1024, { re: /^[A-Za-z0-9_-]+$/ }), e: str(16, { re: /^[A-Za-z0-9_-]+$/ }), alg: opt(oneOf(["RS256"])) });
// A key that is not RS256 (should Apple add one) is dropped, not the whole set.
const AppleKeys = obj({ keys: arr(RsaJwk, 16, { drop: true }) });
type AppleKeys = Of<typeof AppleKeys>;
const Head = obj({ alg: oneOf(["RS256"]), kid: str(64) });
const Claims = obj({ iss: str(200), aud: str(200), iat: num(0, 1e11), exp: opt(num(0, 1e11)), jti: opt(str(200)), events: str(4000) });
/** How long a handled notification's `jti` is kept, and so how old a notification may be. Apple retries a 500 for a while, not for a month. */
export const SEEN_DAYS = 30;
/** One event, out of the `events` string: what happened and to whom (Apple's `sub`, our `account.accountId`). Apple may add
 * types; one we don't act on (email-enabled, email-disabled, anything new) is answered 200 and let be. */
export const AppleEvent = obj({ type: str(64), sub: str(200) });
export type AppleEvent = Of<typeof AppleEvent>;

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const decode = (part: string): unknown => JSON.parse(new TextDecoder().decode(unb64url(part)));

/** Apple's keys, fetched once and kept JWKS_KEEP_MS; a kid we don't have fetches again, at most every JWKS_RETRY_MS. One per isolate. */
export class AppleKeyring {
  private keys: AppleKeys = { keys: [] };
  private fetchedAt = -Infinity;
  private loading: Promise<void> | null = null;
  constructor(private readonly get: (url: string) => Promise<Response> = (u) => fetch(u, { signal: AbortSignal.timeout(10_000) })) {}

  async key(kid: string, now: number) {
    const has = () => this.keys.keys.find((k) => k.kid === kid);
    if ((now - this.fetchedAt > JWKS_KEEP_MS || !has()) && now - this.fetchedAt > JWKS_RETRY_MS) {
      this.loading ??= (async () => {
        try {
          const res = await this.get(APPLE_KEYS);
          const got = res.ok ? check(AppleKeys, await res.json().catch(() => null)) : null;
          if (got) this.keys = got;
        } catch { /* keep what we had */ }
        this.fetchedAt = now;
        this.loading = null;
      })();
      await this.loading;
    }
    return has() ?? null;
  }
}

/** The event in Apple's JWT when Apple signed it for `aud` and it isn't from the future, expired or older than SEEN_DAYS; else null.
 * `jti` names this notification (its signature's hash when Apple left `jti` out), so a replay of it can be told apart. */
export async function verifyApple(token: string, aud: string, ring: AppleKeyring, now = Date.now()): Promise<(AppleEvent & { jti: string }) | null> {
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined || token.length > 8000) return null;
  try {
    const head = check(Head, decode(h));
    const jwk = head && await ring.key(head.kid, now);
    if (!jwk) return null;
    const pub = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RS256, false, ["verify"]);
    if (!await crypto.subtle.verify(RS256, pub, unb64url(s), new TextEncoder().encode(`${h}.${p}`))) return null;
    const claims = check(Claims, decode(p));
    const at = now / 1000;
    if (!claims || claims.iss !== APPLE_ISS || claims.aud !== aud || claims.iat > at + 60 || claims.iat < at - SEEN_DAYS * 86_400 || (claims.exp !== undefined && claims.exp <= at)) return null;
    const event = check(AppleEvent, JSON.parse(claims.events));
    return event && { ...event, jti: claims.jti ?? await sha256(s) };
  } catch { return null; }
}

const ring = new AppleKeyring();

/** POST /api/apple/events. 401 for anything Apple didn't sign for us; 200 once handled, so Apple stops retrying. */
export async function appleEvents(req: Request, conf: Env, iss: string, keys = ring): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST { payload: <Apple's JWT> }" }, 405);
  if (!conf.APPLE_CLIENT_ID) return json({ error: "Sign in with Apple is off here" }, 503);
  const { payload } = await readBody<"payload">(req);
  const event = typeof payload === "string" ? await verifyApple(payload, conf.APPLE_CLIENT_ID, keys) : null;
  if (!event) return json({ error: "not a notification Apple signed for this Services ID" }, 401);
  // Handled once: whoever captured one can't send it again to sign someone out, or delete an account they linked to Apple anew.
  const now = Date.now();
  if (await conf.DB.prepare("SELECT 1 FROM apple_seen WHERE jti = ?").bind(event.jti).first()) return json({ ok: true, type: event.type, seen: true });
  const who = await conf.DB.prepare(`SELECT "userId" AS id FROM "account" WHERE "providerId" = 'apple' AND "accountId" = ?`).bind(event.sub).first<{ id: string }>();
  // Someone we never saw, or already gone: nothing to do, and Apple is told so.
  if (!who) { await seen(conf, event.jti, now); return json({ ok: true, type: event.type, known: false }); }
  if (event.type === "consent-revoked") await signOutEverywhere(conf, who.id);
  // deleteAccount is false while an app's erase URL won't answer; a 500 has Apple send it again later.
  if (event.type === "account-delete" && !(await deleteAccount(conf, who.id, iss))) return json({ error: "an app has not erased them yet; send again" }, 500);
  await seen(conf, event.jti, now);
  return json({ ok: true, type: event.type, known: true });
}

/** Note a handled notification (only once handled: a 500 Apple sends again must still act), and forget those past SEEN_DAYS. */
const seen = (conf: Env, jti: string, now: number) => conf.DB.batch([
  conf.DB.prepare("DELETE FROM apple_seen WHERE at < ?").bind(now - SEEN_DAYS * 86_400_000),
  conf.DB.prepare("INSERT INTO apple_seen (jti, at) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(jti, now),
]);
