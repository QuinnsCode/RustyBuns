// The signed token /api/exchange hands back beside the plain answer: an ES256 JWT an app's server or Durable
// Object checks against /.well-known/jwks.json, so it knows who someone is without calling eqosys again.
// The private key is one EC P-256 JWK in EQOSYS_SIGNING_KEY; without it there is no token and the JWKS is empty.
// Signing lives here; checking is `@rustybuns/util/token`, which every app that signs in through eqosys imports.
import { check, obj, oneOf, str } from "@rustybuns/util/guard";
import { Claims, EC, SIGN, type Jwks, type PublicJwk } from "@rustybuns/util/token";
import { b64url, digest, type Env } from "./env.ts";
import type { Handoff } from "./members.ts";

export { audOf, Claims, Jwks, verify, type PublicJwk } from "@rustybuns/util/token";

export const TOKEN_S = 600;

const Coord = str(64, { min: 43, re: /^[A-Za-z0-9_-]+$/ });
const PrivateJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, d: Coord });

const text = new TextEncoder();
const part = (v: unknown) => b64url(text.encode(JSON.stringify(v)));

/** The only binding signing reads, so a test or another app's harness can sign with just a key. */
export type Signer = Pick<Env, "EQOSYS_SIGNING_KEY">;

interface Key { kid: string; priv: CryptoKey; pub: PublicJwk }
const keys = new Map<string, Promise<Key | null>>();

/** The signing key from EQOSYS_SIGNING_KEY, or null when it is unset or isn't an EC P-256 private JWK. */
export function keyOf(conf: Signer): Promise<Key | null> {
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
export const jwksOf = async (conf: Signer): Promise<Jwks> => {
  const k = await keyOf(conf);
  return { keys: k ? [k.pub] : [] };
};

/** `who` as a token for their app, good for TOKEN_S seconds; null with no signing key. */
export async function sign(conf: Signer, iss: string, who: Handoff, now = Date.now()): Promise<string | null> {
  const k = await keyOf(conf);
  if (!k) return null;
  const iat = Math.floor(now / 1000);
  const claims: Claims = { iss, aud: who.app, sub: who.user.id, email: who.user.email, name: who.user.name, source: who.source, access: who.access, iat, exp: iat + TOKEN_S };
  const head = `${part({ alg: "ES256", typ: "JWT", kid: k.kid })}.${part(claims)}`;
  return `${head}.${b64url(new Uint8Array(await crypto.subtle.sign(SIGN, k.priv, text.encode(head))))}`;
}
