// The token eqosys hands an app at sign-in, as the app checks it: an ES256 JWT against the JWKS at
// eqosys's /.well-known/jwks.json. Signing stays in apps/eqosys (src/token.ts); every app that lets
// people in through eqosys verifies here, so its server or Durable Object knows who someone is
// without calling eqosys per player.
import { unb64url } from "./bytes.ts";
import { arr, check, num, obj, oneOf, str, type Of } from "./guard.ts";

/** What a token says: who, for which app, from where they first came, what they may do, and until when (seconds since the epoch). */
export const Claims = obj({
  iss: str(200), aud: str(64), sub: str(200), email: str(320), name: str(200), source: str(64),
  access: arr(str(32), 100), iat: num(0, 1e11), exp: num(0, 1e11),
});
export type Claims = Of<typeof Claims>;

const Coord = str(64, { min: 43, re: /^[A-Za-z0-9_-]+$/ });
export const PublicJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, kid: str(64), alg: oneOf(["ES256"]), use: oneOf(["sig"]) });
export type PublicJwk = Of<typeof PublicJwk>;
export const Jwks = obj({ keys: arr(PublicJwk, 8) });
export type Jwks = Of<typeof Jwks>;

/** A token as it travels in a query: three base64url parts, never longer than a few KB. */
export const TOKEN = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,512}$/;

export const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
export const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const text = new TextEncoder();
const decode = (part: string): unknown => JSON.parse(new TextDecoder().decode(unb64url(part)));

/** What a token says, before anything is checked: for which app, who, until when. A page reads its own token this way. */
export function peek(token: string): Claims | null {
  try { return check(Claims, decode(token.split(".")[1] ?? "")); } catch { return null; }
}

/** The app a token says it is for, before anything is checked: which `aud` to verify it against. */
export const audOf = (token: string): string | null => peek(token)?.aud ?? null;

const Head = obj({ alg: oneOf(["ES256"]), kid: str(64) });

/**
 * What an app runs on a token: its claims when one of `jwks`' keys signed it, for `aud`, from `iss`, and not
 * yet expired; else null. Fetch the JWKS once and keep it a few minutes; a kid it doesn't know means fetch again.
 */
export async function verify(token: string, jwks: Jwks, want: { iss: string; aud: string }, now = Date.now()): Promise<Claims | null> {
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined) return null;
  try {
    const head = check(Head, decode(h));
    const jwk = head && jwks.keys.find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const pub = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, EC, false, ["verify"]);
    if (!await crypto.subtle.verify(SIGN, pub, unb64url(s), text.encode(`${h}.${p}`))) return null;
    const claims = check(Claims, decode(p));
    const at = now / 1000;
    return claims && claims.iss === want.iss && claims.aud === want.aud && claims.exp > at && claims.iat <= at + 60 ? claims : null;
  } catch { return null; }
}

/** How long a fetched JWKS is trusted before it is fetched again, and the least time between two fetches. */
export const JWKS_KEEP_MS = 5 * 60_000, JWKS_RETRY_MS = 30_000;

/**
 * An app's side of eqosys: `check(token)` answers who it says, with the JWKS fetched from eqosys once and kept a
 * few minutes. A key id it doesn't know fetches again (eqosys rotated its key), at most every JWKS_RETRY_MS, so a
 * flood of bad tokens is one request. One per Worker isolate or process; `eqosys` is its origin, `app` the id in APPS.
 */
export class TokenChecker {
  private jwks: Jwks = { keys: [] };
  private fetchedAt = -Infinity;
  private loading: Promise<Jwks> | null = null;

  constructor(readonly eqosys: string, readonly app: string, private readonly get: (url: string) => Promise<Response> = (u) => fetch(u)) {}

  /** The claims when eqosys signed `token` for this app and it hasn't expired; null for anything else. */
  async check(token: string, now = Date.now()): Promise<Claims | null> {
    if (!TOKEN.test(token)) return null;
    const want = { iss: this.eqosys, aud: this.app };
    const kid = (() => { try { return check(Head, decode(token.split(".")[0] ?? ""))?.kid ?? null; } catch { return null; } })();
    if (!kid) return null;
    const stale = now - this.fetchedAt > JWKS_KEEP_MS, unknown = !this.jwks.keys.some((k) => k.kid === kid);
    if ((stale || unknown) && now - this.fetchedAt > JWKS_RETRY_MS) await this.load(now);
    return verify(token, this.jwks, want, now);
  }

  private load(now: number): Promise<Jwks> {
    this.loading ??= (async () => {
      try {
        const res = await this.get(`${this.eqosys}/.well-known/jwks.json`);
        const got = res.ok ? check(Jwks, await res.json().catch(() => null)) : null;
        if (got) this.jwks = got;
      } catch { /* keep what we had: an eqosys that is down shouldn't log everyone out at once */ }
      this.fetchedAt = now;
      this.loading = null;
      return this.jwks;
    })();
    return this.loading;
  }
}
