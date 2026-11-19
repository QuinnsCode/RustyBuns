// An identity provider's RS256 keys (its JWKS) and the check of a JWT signed with one: Apple's server notifications (apple.ts)
// and a company's ID tokens (sso.ts) both come this way.
import { unb64url } from "@rustybuns/util/bytes";
import { arr, check, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { JWKS_KEEP_MS, JWKS_RETRY_MS } from "@rustybuns/util/token";

const RsaJwk = obj({ kty: oneOf(["RSA"]), kid: str(200), n: str(1024, { re: /^[A-Za-z0-9_-]+$/ }), e: str(16, { re: /^[A-Za-z0-9_-]+$/ }), alg: opt(oneOf(["RS256"])) });
// A key that is not RS256 (an EC key beside them, say) is dropped, not the whole set.
const Jwks = obj({ keys: arr(RsaJwk, 32, { drop: true }) });
type Jwks = Of<typeof Jwks>;
const Head = obj({ alg: oneOf(["RS256"]), kid: str(200) });

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const decode = (part: string): unknown => JSON.parse(new TextDecoder().decode(unb64url(part)));

/** One provider's keys, fetched once and kept JWKS_KEEP_MS; a kid we don't have fetches again, at most every JWKS_RETRY_MS. One per isolate. */
export class JwksKeyring {
  private keys: Jwks = { keys: [] };
  private fetchedAt = -Infinity;
  private loading: Promise<void> | null = null;
  constructor(readonly url: string, private readonly get: (url: string) => Promise<Response> = (u) => fetch(u, { signal: AbortSignal.timeout(10_000) })) {}

  async key(kid: string, now: number) {
    const has = () => this.keys.keys.find((k) => k.kid === kid);
    if ((now - this.fetchedAt > JWKS_KEEP_MS || !has()) && now - this.fetchedAt > JWKS_RETRY_MS) {
      this.loading ??= (async () => {
        try {
          const res = await this.get(this.url);
          const got = res.ok ? check(Jwks, await res.json().catch(() => null)) : null;
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

/** The claims of a JWT whose RS256 signature is one of `ring`'s keys, still unchecked (`unknown`: the caller's guard reads them); else null. */
export async function verifiedClaims(token: string, ring: JwksKeyring, now = Date.now()): Promise<unknown> {
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined || token.length > 8000) return null;
  try {
    const head = check(Head, decode(h));
    const jwk = head && await ring.key(head.kid, now);
    if (!jwk) return null;
    const pub = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, RS256, false, ["verify"]);
    return await crypto.subtle.verify(RS256, pub, unb64url(s), new TextEncoder().encode(`${h}.${p}`)) ? decode(p) : null;
  } catch { return null; }
}
