// The signed token /api/exchange hands back beside the plain answer: an ES256 JWT an app's server or Durable
// Object checks against /.well-known/jwks.json, so it knows who someone is without calling eqosys again.
// The private key is one EC P-256 JWK in EQOSYS_SIGNING_KEY; without it there is no token and the JWKS is empty.
import { arr, check, num, obj, oneOf, str, type Of } from "@rustybuns/util/guard";
import { b64url, digest, type Env } from "./env.ts";
import type { Handoff } from "./members.ts";

export const TOKEN_S = 600;

/** What a token says: the handoff, plus who signed it, for which app, and until when (seconds since the epoch). */
export const Claims = obj({
  iss: str(200), aud: str(64), sub: str(200), email: str(320), name: str(200), source: str(64),
  access: arr(str(32), 100), iat: num(0, 1e11), exp: num(0, 1e11),
});
export type Claims = Of<typeof Claims>;

const Coord = str(64, { min: 43, re: /^[A-Za-z0-9_-]+$/ });
const PrivateJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, d: Coord });
const PublicJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, kid: str(64), alg: oneOf(["ES256"]), use: oneOf(["sig"]) });
export const Jwks = obj({ keys: arr(PublicJwk, 8) });
export type Jwks = Of<typeof Jwks>;
export type PublicJwk = Of<typeof PublicJwk>;

const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const text = new TextEncoder();
const part = (v: unknown) => b64url(text.encode(JSON.stringify(v)));
const unpart = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

interface Key { kid: string; priv: CryptoKey; pub: PublicJwk }
const keys = new Map<string, Promise<Key | null>>();

/** The signing key from EQOSYS_SIGNING_KEY, or null when it is unset or isn't an EC P-256 private JWK. */
export function keyOf(conf: Env): Promise<Key | null> {
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

/** A fresh EC P-256 private JWK, as EQOSYS_SIGNING_KEY wants it (scripts/keygen.ts, and the dev server's throwaway). */
export async function newKey(): Promise<string> {
  const pair = await crypto.subtle.generateKey(EC, true, ["sign", "verify"]);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return JSON.stringify({ kty, crv, x, y, d });
}

/** The public half, for /.well-known/jwks.json. */
export const jwksOf = async (conf: Env): Promise<Jwks> => {
  const k = await keyOf(conf);
  return { keys: k ? [k.pub] : [] };
};

/** `who` as a token for their app, good for TOKEN_S seconds; null with no signing key. */
export async function sign(conf: Env, iss: string, who: Handoff, now = Date.now()): Promise<string | null> {
  const k = await keyOf(conf);
  if (!k) return null;
  const iat = Math.floor(now / 1000);
  const claims: Claims = { iss, aud: who.app, sub: who.user.id, email: who.user.email, name: who.user.name, source: who.source, access: who.access, iat, exp: iat + TOKEN_S };
  const head = `${part({ alg: "ES256", typ: "JWT", kid: k.kid })}.${part(claims)}`;
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign(SIGN, k.priv, text.encode(head))))}`;
}

/** The app a token says it is for, before anything is checked: which `aud` to verify it against. */
export function audOf(token: string): string | null {
  try { return check(obj({ aud: str(64) }), JSON.parse(new TextDecoder().decode(unpart(token.split(".")[1] ?? ""))))?.aud ?? null; } catch { return null; }
}

const Head = obj({ alg: oneOf(["ES256"]), kid: str(64) });

/**
 * What an app runs on a token: its claims when one of `jwks`' keys signed it, for `aud`, from `iss`, and not
 * yet expired; else null. Fetch the JWKS once and keep it a few minutes; a kid it doesn't know means fetch again.
 */
export async function verify(token: string, jwks: Jwks, want: { iss: string; aud: string }, now = Date.now()): Promise<Claims | null> {
  const [h, p, s, extra] = token.split(".");
  if (!h || !p || !s || extra !== undefined) return null;
  try {
    const head = check(Head, JSON.parse(new TextDecoder().decode(unpart(h))));
    const jwk = head && jwks.keys.find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const pub = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, EC, false, ["verify"]);
    if (!await crypto.subtle.verify(SIGN, pub, unpart(s), text.encode(`${h}.${p}`))) return null;
    const claims = check(Claims, JSON.parse(new TextDecoder().decode(unpart(p))));
    const at = now / 1000;
    return claims && claims.iss === want.iss && claims.aud === want.aud && claims.exp > at && claims.iat <= at + 60 ? claims : null;
  } catch { return null; }
}
