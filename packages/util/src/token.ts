// The token eqosys hands an app at sign-in: an ES256 JWT, signed by eqosys with the one EC P-256 private JWK
// in EQOSYS_SIGNING_KEY and checked by the app against the JWKS at eqosys's /.well-known/jwks.json, so its
// server or Durable Object knows who someone is without calling eqosys per player. Both halves live here:
// eqosys signs with `sign` and serves `jwksOf`; an app verifies with `TokenChecker`, and its test signs its
// own with `newKey` and `sign` instead of reaching into eqosys.
import { b64url, digest, unb64url } from "./bytes.ts";
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
const part = (v: unknown) => b64url(text.encode(JSON.stringify(v)));

/** How long a token is good for, in seconds. */
export const TOKEN_S = 600;

/** What an app learns about a person at handoff from eqosys: what `sign` puts in their token. */
export interface Handoff {
  user: { id: string; email: string; name: string };
  app: string;
  /** The app they first came in through, or "eqosys". */
  source: string;
  access: string[];
}

const PrivateJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, d: Coord });

/** The only binding signing reads, so a test or another app's harness can sign with just a key. */
export interface Signer { EQOSYS_SIGNING_KEY?: string }

interface Key { kid: string; priv: CryptoKey; pub: PublicJwk }
const keys = new Map<string, Promise<Key | null>>();

/** The signing key from EQOSYS_SIGNING_KEY, or null when it is unset or isn't an EC P-256 private JWK. */
function keyOf(conf: Signer): Promise<Key | null> {
  const raw = conf.EQOSYS_SIGNING_KEY;
  if (!raw) return Promise.resolve(null);
  let got = keys.get(raw);
  if (!got) {
    got = (async () => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return null; }
      const jwk = check(PrivateJwk, parsed);
      if (!jwk) return null;
      const priv = await crypto.subtle.importKey("jwk", jwk, EC, false, ["sign"]).catch(() => null);
      if (!priv) return null;
      // The kid is the public point's hash: a new key gets a new kid without anyone picking one.
      const kid = b64url(await digest(`${jwk.x}.${jwk.y}`)).slice(0, 16);
      return { kid, priv, pub: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" } };
    })();
    keys.set(raw, got);
  }
  return got;
}

/** A fresh EC P-256 private JWK, as EQOSYS_SIGNING_KEY wants it (eqosys's scripts/keygen.ts, its dev server's throwaway, and tests). */
export async function newKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(EC, true, ["sign", "verify"]);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return JSON.stringify({ kty, crv, x, y, d });
}

/** The public half, for /.well-known/jwks.json. */
export const jwksOf = async (conf: Signer): Promise<Jwks> => {
  const k = await keyOf(conf);
  return { keys: k ? [k.pub] : [] };
};

/** OpenID's extras an id_token adds to the claims: the client's nonce, and whether the email is known to be theirs. */
export interface IdExtras { nonce?: string; email_verified?: boolean }

/** `who` as a token for their app, good for TOKEN_S seconds; null with no signing key. `extras` make it an OpenID id_token; `life` is seconds. */
export async function sign(conf: Signer, iss: string, who: Handoff, now = Date.now(), extras: IdExtras = {}, life = TOKEN_S): Promise<string | null> {
  const k = await keyOf(conf);
  if (!k) return null;
  const iat = Math.floor(now / 1000);
  const claims: Claims & IdExtras = { iss, aud: who.app, sub: who.user.id, email: who.user.email, name: who.user.name, source: who.source, access: who.access, iat, exp: iat + life, ...extras };
  const head = `${part({ alg: "ES256", typ: "JWT", kid: k.kid })}.${part(claims)}`;
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign(SIGN, k.priv, text.encode(head))))}`;
}

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
