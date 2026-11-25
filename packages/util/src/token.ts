// The token eqosys hands an app at sign-in: an ES256 JWT, signed by eqosys with the one EC P-256 private JWK
// in EQOSYS_SIGNING_KEY and checked by the app against the JWKS at eqosys's /.well-known/jwks.json, so its
// server or Durable Object knows who someone is without calling eqosys per player. Both halves live here:
// eqosys signs with `sign` and serves `jwksOf`; an app verifies with `TokenChecker`, and its test signs its
// own with `newKey` and `sign` instead of reaching into eqosys.
import { b64url, digest, unb64url } from "./bytes.ts";
import { arr, check, int, num, obj, oneOf, opt, str, type Of } from "./guard.ts";

/** The most studios a token names: a token travels in a query, so it stays a few KB (TOKEN). */
export const STUDIOS_MAX = 8;

/** What an app keeps of a sign-in: who, the token its Worker checks, and the one-use refresh token beside it. */
export const Login = obj({ name: str(200), email: str(320), token: str(8192), refresh: opt(str(100)) });
/** What is kept of a sign-in between visits (a page's vault, a desktop app's OS store): no access token, which lives in memory for its ten minutes. */
export const KeptLogin = obj({ name: str(200), email: str(320), refresh: opt(str(100)) });
export type KeptLogin = Of<typeof KeptLogin>;
/** The request a desktop host signs a DPoP proof for, with the key it keeps for its page (POST /__rb/login/proof). */
export const ProofAsk = obj({ htm: str(10), url: str(2000) });
export type Login = Of<typeof Login>;

/**
 * What a token says: who, for which app, from where they first came, what they may do, and until when (seconds since the epoch).
 * `email` is empty only on eqosys's own tickets and orders to Qlave (apps/eqosys/src/qollab/qlave.ts), which don't need it.
 * `studios` only on a token for an app that runs per studio (eqosys's APPS `studios`, QView3D's shops): the person's studios and role in each.
 */
export const Claims = obj({
  iss: str(200), aud: str(64), sub: str(200), email: str(320, { min: 0 }), name: str(200), source: str(64),
  access: arr(str(32), 100), iat: num(0, 1e11), exp: num(0, 1e11),
  studios: opt(arr(obj({ id: str(64), name: str(60), role: oneOf(["owner", "admin", "maker"]) }), STUDIOS_MAX)),
});
export type Claims = Of<typeof Claims>;
/** One studio a token names, with the person's role in it. */
export type StudioRole = NonNullable<Claims["studios"]>[number];

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
  /** For an app that runs per studio: the person's studios (at most STUDIOS_MAX) and their role in each. */
  studios?: StudioRole[];
}

const PrivateJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord, d: Coord });

/** The only binding signing reads, so a test or another app's harness can sign with just a key. */
export interface Signer {
  EQOSYS_SIGNING_KEY?: string;
  /** Rotation: a JSON array of the retired keys' JWKs (public or private), still served in the JWKS so tokens they signed verify until they expire. */
  EQOSYS_PREVIOUS_KEYS?: string;
}

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

const PublicPoint = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord });

/** A retired key's public half; its kid is the point's hash, so it matches what that key signed with. */
async function retired(raw: unknown): Promise<PublicJwk | null> {
  const p = check(PublicPoint, raw);
  if (!p) return null;
  const kid = b64url(await digest(`${p.x}.${p.y}`)).slice(0, 16);
  return { kty: "EC", crv: "P-256", x: p.x, y: p.y, kid, alg: "ES256", use: "sig" };
}

/** The public halves, for /.well-known/jwks.json: the signing key first, then the retired ones (at most 8 in all). */
export const jwksOf = async (conf: Signer): Promise<Jwks> => {
  const k = await keyOf(conf);
  const out: PublicJwk[] = k ? [k.pub] : [];
  let list: unknown = [];
  try { list = JSON.parse(conf.EQOSYS_PREVIOUS_KEYS ?? "[]"); } catch { /* not JSON: no retired keys */ }
  if (Array.isArray(list)) for (const raw of list) {
    const pub = await retired(raw);
    if (pub && !out.some((o) => o.kid === pub.kid) && out.length < 8) out.push(pub);
  }
  return { keys: out };
};

/**
 * Extras a token may carry beyond the claims: OpenID's (the client's nonce, whether the email is known to be theirs),
 * a one-use ticket's (a Qlave voice ticket's `room` and its `jti`, apps/eqosys/QLAVE.md), and a party's start ticket's `room` and `seat`.
 */
export interface IdExtras { nonce?: string; email_verified?: boolean; room?: string; jti?: string; seat?: number }

/** `who` as a token for their app, good for TOKEN_S seconds; null with no signing key. `extras` make it an OpenID id_token; `life` is seconds. */
export async function sign(conf: Signer, iss: string, who: Handoff, now = Date.now(), extras: IdExtras = {}, life = TOKEN_S): Promise<string | null> {
  const k = await keyOf(conf);
  if (!k) return null;
  const iat = Math.floor(now / 1000);
  const claims: Claims & IdExtras = { iss, aud: who.app, sub: who.user.id, email: who.user.email, name: who.user.name, source: who.source, access: who.access, iat, exp: iat + life, ...(who.studios ? { studios: who.studios } : {}), ...extras };
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

/** A guest's id: what their browser made, 8-64 safe characters and never a colon, so nobody can spell an eqosys id ("eq:..."). */
export const UID = /^[A-Za-z0-9_-]{8,64}$/;

/** Who a request is from, as the edge decides it: the id and name the game's World sees. */
export interface Who { uid: string; name: string }

const checkers = new Map<string, TokenChecker>();
/** One checker per isolate for each eqosys origin and app, so the JWKS is fetched once and shared by every request. `get` stands in for fetch in tests. */
export function checkerFor(eqosys: string, app: string, get?: (url: string) => Promise<Response>): TokenChecker {
  const origin = new URL(eqosys).origin, key = `${origin} ${app}`;
  let c = checkers.get(key);
  if (!c) { c = new TokenChecker(origin, app, get); checkers.set(key, c); }
  return c;
}

const clean = (s: string | null, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);

/** Where a game's edge checks who someone is: its id in eqosys's APPS, the eqosys origin (EQOSYS_URL, else the live one), and the name for someone who gave none. */
export interface Door { app: string; eqosys: string; fallbackName: string; get?: (url: string) => Promise<Response> }

/**
 * A game Worker's door: the player behind `url`'s query. A `token` eqosys signed for this app makes them
 * "eq:" + their eqosys id under the token's name (any name in the query doesn't count); anyone else is a guest
 * with the `uid` their browser made and the name they typed. A token that doesn't check out is a 401, a missing
 * or bad uid a 400. The Worker alone decides the id and name, so a client can't play as someone else.
 */
export async function whoIs(url: URL, door: Door): Promise<Who | Response> {
  const token = url.searchParams.get("token");
  if (token !== null) {
    const claims = await checkerFor(door.eqosys, door.app, door.get).check(token);
    if (!claims) return new Response("sign in again", { status: 401 });
    return { uid: `eq:${claims.sub}`, name: clean(claims.name, 24) || door.fallbackName };
  }
  const uid = url.searchParams.get("uid") ?? "";
  if (!UID.test(uid)) return new Response("bad player id", { status: 400 });
  return { uid, name: clean(url.searchParams.get("name"), 24) || door.fallbackName };
}

/**
 * A Qollab party's start ticket (apps/eqosys/src/qollab/party.ts): handed to each member on start, it says eqosys saw
 * this account in the party that started `room`, in `seat`. Its audience is `start:<app>`, never the app's own, so it is
 * no login for the game and a login is no ticket. A game's Worker checks one with `startTicket`.
 */
export const startAud = (app: string) => `start:${app}`;
/** How long a start ticket is good for, in seconds: the time to go from the lobby to the game's room, with room to spare. */
export const START_S = 600;

const StartExtras = obj({ room: str(64, { min: 1 }), seat: int(0, 1000) });
/** What a start ticket vouches for, once checked. */
export interface StartTicket { sub: string; room: string; seat: number }

/** `ticket`'s room and seat, when eqosys at `eqosys` signed it for a start in `app` and it hasn't run out; else null. */
export async function startTicket(eqosys: string, app: string, ticket: string, get?: (url: string) => Promise<Response>, now = Date.now()): Promise<StartTicket | null> {
  const claims = await checkerFor(eqosys, startAud(app), get).check(ticket, now);
  if (!claims) return null;
  try {
    const extras = check(StartExtras, decode(ticket.split(".")[1] ?? ""));
    return extras && { sub: claims.sub, room: extras.room, seat: extras.seat };
  } catch { return null; }
}

// DPoP (RFC 9449): a page proves it holds the key a refresh token was bound to. The key is made non-extractable, so a
// script that reads the page's storage gets a refresh token it can't spend anywhere else.

/** A DPoP proof's public key: an EC P-256 JWK with only the fields a thumbprint reads. */
const DpopJwk = obj({ kty: oneOf(["EC"]), crv: oneOf(["P-256"]), x: Coord, y: Coord });
const DpopHead = obj({ typ: oneOf(["dpop+jwt"]), alg: oneOf(["ES256"]), jwk: DpopJwk });
const DpopClaims = obj({ jti: str(64, { min: 16 }), htm: str(10), htu: str(2000), iat: num(0, 1e11) });
/** How far a proof's `iat` may sit from the server's clock, in seconds. */
export const DPOP_SKEW_S = 300;

/** The RFC 7638 thumbprint of a public key: what a bound refresh token remembers (`jkt`). */
export const thumbprint = async (jwk: { crv: string; kty: string; x: string; y: string }): Promise<string> =>
  b64url(await digest(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })));

/** The URL as a proof names it: no query, no fragment. */
const htuOf = (url: string): string => { const u = new URL(url); return `${u.origin}${u.pathname}`; };

/** A proof that the holder of `key` sends this request (`DPoP` header). The private key never needs to be extractable. */
export async function dpopProof(key: CryptoKeyPair, htm: string, url: string, now = Date.now()): Promise<string> {
  const pub = await crypto.subtle.exportKey("jwk", key.publicKey);
  const jwk = DpopJwk({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y });
  const enc = (v: unknown) => b64url(text.encode(JSON.stringify(v)));
  const body = `${enc({ typ: "dpop+jwt", alg: "ES256", jwk })}.${enc({ jti: b64url(crypto.getRandomValues(new Uint8Array(16))), htm, htu: htuOf(url), iat: Math.floor(now / 1000) })}`;
  return `${body}.${b64url(new Uint8Array(await crypto.subtle.sign(SIGN, key.privateKey, text.encode(body))))}`;
}

/** The thumbprint of the key that signed `proof` for this method and URL, or null for a proof that is missing, late, for another request or forged. */
export async function checkDpop(proof: string | null, htm: string, url: string, now = Date.now()): Promise<string | null> {
  const [h, p, s, extra] = (proof ?? "").split(".");
  if (!h || !p || !s || extra !== undefined) return null;
  try {
    const head = check(DpopHead, decode(h)), claims = check(DpopClaims, decode(p));
    if (!head || !claims || claims.htm !== htm || claims.htu !== htuOf(url) || Math.abs(claims.iat - now / 1000) > DPOP_SKEW_S) return null;
    const pub = await crypto.subtle.importKey("jwk", head.jwk, EC, false, ["verify"]);
    return await crypto.subtle.verify(SIGN, pub, unb64url(s), text.encode(`${h}.${p}`)) ? thumbprint(head.jwk) : null;
  } catch { return null; }
}
