// Company sign-in (src/sso.ts, #4793): a studio's owner connects the company's OpenID provider, and someone with a work email
// on its domain signs in through it and lands in the studio. The provider is a fake one in-process: its discovery, JWKS and
// token endpoint answer from a local RS256 key, and its "sign-in page" is the test handing back a code.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { studiosOf } from "../src/studios.ts";
import { DOH, lapseSeats, proofOf, SSO_SEAT_DAYS } from "../src/sso.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const ISSUER = "https://idp.acme.dev", CLIENT = "eqosys-acme", SECRET = "s3cret-from-the-provider";
const { conf, call } = await boot();

const RS256 = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
const key = await crypto.subtle.generateKey(RS256, true, ["sign", "verify"]);
const { n, e } = await crypto.subtle.exportKey("jwk", key.publicKey);
const part = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
const s256 = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));

/** What the provider signs for a code: who signed in there, and anything a case changes about the ID token. */
type Person = { sub: string; email: string; name?: string; claims?: Record<string, unknown> };
const codes = new Map<string, { who: Person; nonce: string; challenge: string; redirect: string }>();

/** The TXT records each domain has, as DNS over HTTPS answers them (sso.ts hasTxt). */
const txt = new Map<string, string[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith(DOH)) {
    const name = new URL(req.url).searchParams.get("name") ?? "";
    return Response.json({ Status: 0, Answer: (txt.get(name) ?? []).map((v) => ({ name, type: 16, TTL: 300, data: `"${v}"` })) });
  }
  if (!req.url.startsWith(ISSUER)) return realFetch(req);
  const path = new URL(req.url).pathname;
  if (path === "/.well-known/openid-configuration")
    return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` });
  if (path === "/keys") return Response.json({ keys: [{ kty: "RSA", kid: "k1", alg: "RS256", use: "sig", n, e }] });
  if (path === "/token") {
    const f = new URLSearchParams(await req.text()), c = codes.get(f.get("code") ?? "");
    // The provider checks its own client, the secret and PKCE, as a real one does.
    if (!c || f.get("client_id") !== CLIENT || f.get("client_secret") !== SECRET || await s256(f.get("code_verifier") ?? "") !== c.challenge || f.get("redirect_uri") !== c.redirect)
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    codes.delete(f.get("code")!);
    const at = Math.floor(Date.now() / 1000);
    const head = `${part({ alg: "RS256", kid: "k1" })}.${part({ iss: ISSUER, aud: CLIENT, sub: c.who.sub, email: c.who.email, email_verified: true, name: c.who.name, nonce: c.nonce, iat: at, exp: at + 600, ...c.who.claims })}`;
    const sig = b64url(new Uint8Array(await crypto.subtle.sign(RS256, key.privateKey, new TextEncoder().encode(head))));
    return Response.json({ id_token: `${head}.${sig}`, access_token: "at", token_type: "Bearer" });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

/** "Sign in through your company" with `email`, the provider signing in `who`, and back. `browser` false: the callback opens elsewhere. */
async function company(email: string, who: Person, o: { ask?: Record<string, string>; browser?: boolean } = {}) {
  const start = await call("/do/sso", { form: { ...o.ask, email } });
  if (!start.to.startsWith(ISSUER)) return { start, back: null };
  const at = new URL(start.to), code = crypto.randomUUID();
  expect(at.searchParams.get("login_hint")).toBe(email);
  codes.set(code, { who, nonce: at.searchParams.get("nonce")!, challenge: at.searchParams.get("code_challenge")!, redirect: at.searchParams.get("redirect_uri")! });
  const cb = new URL(at.searchParams.get("redirect_uri")!);
  const back = await call(`${cb.pathname}?${new URLSearchParams({ code, state: at.searchParams.get("state")! })}`, o.browser === false ? {} : { cookie: start.cookie });
  return { start, back };
}
const userOf = (email: string) => conf.DB.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(email).first<string>("id");

// Ada owns Acme and connects its provider.
const ada = await call("/do/signup", { form: { name: "Ada", email: "ada@acme.dev", password: PASSWORD } });
await call("/do/studio-make", { form: { name: "Acme", kind: "business" }, cookie: ada.cookie });
const [acme] = await studiosOf(conf, (await userOf("ada@acme.dev"))!);
const connect = (cookie: string, f: Record<string, string>) =>
  call("/do/studio-sso", { cookie, form: { studio: acme!.id, issuer: ISSUER, clientId: CLIENT, secret: SECRET, domain: "acme.dev", role: "maker", ...f } });

test("an owner connects the provider; a coworker signs in through it and lands in the studio, then in an app", async () => {
  expect((await connect(ada.cookie, {})).to).toBe("/?tab=studio");
  // The secret is sealed in D1, never kept as it came; the Studio tab only says there is one.
  const kept = await conf.DB.prepare("SELECT secret FROM studio_sso WHERE studio_id = ?").bind(acme!.id).first<string>("secret");
  expect(kept).not.toContain(SECRET);
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!))[0]!.sso).toEqual({ issuer: ISSUER, clientId: CLIENT, domain: "acme.dev", role: "maker", secret: true, proved: false });
  // Saving again with the secret left blank keeps it.
  await connect(ada.cookie, { secret: "", role: "admin" });
  await connect(ada.cookie, { secret: "" });
  expect(await conf.DB.prepare("SELECT secret FROM studio_sso WHERE studio_id = ?").bind(acme!.id).first<string>("secret")).toBe(kept);

  // Bo has never been here: the company signs him in, and he is a maker in Acme, signed in to eqosys.
  const { back } = await company("bo@acme.dev", { sub: "okta|bo", email: "Bo@Acme.dev", name: "Bo" });
  expect(back!.to).toBe("/?tab=studio");
  const bo = (await userOf("bo@acme.dev"))!;
  expect((await studiosOf(conf, bo)).map((s) => [s.name, s.role])).toEqual([["Acme", "maker"]]);
  // Signed in: Continue goes home (signed out, it would go back to /login?e=in).
  expect((await call("/do/continue", { cookie: back!.cookie, form: {} })).to).toBe("/");

  // Next time, on his way to a game: the same account, and straight on to the game with a code.
  const a = await asks("park-hide-seek", PARK);
  const again = await company("bo@acme.dev", { sub: "okta|bo", email: "bo@acme.dev" }, { ask: a.form });
  expect(await userOf("bo@acme.dev")).toBe(bo);
  expect(again.back!.to.startsWith("/login?app=park-hide-seek")).toBe(true);
  const onward = await call(again.back!.to, { cookie: again.back!.cookie });
  expect(codeIn(onward.to)).toMatch(/^eq_/);
});

test.each([
  ["an ID token for another client", { claims: { aud: "someone-else" } }, "sso"],
  ["an ID token with another nonce", { claims: { nonce: "replayed" } }, "sso"],
  ["an ID token from another issuer", { claims: { iss: "https://evil.example" } }, "sso"],
  ["an email the provider hasn't verified", { claims: { email_verified: false } }, "ssomail"],
  ["an email off the company's domain", { email: "cy@elsewhere.dev" }, "ssodomain"],
] as const)("%s signs nobody in", async (_, change, error) => {
  const sub = `okta|${crypto.randomUUID()}`, email = ("email" in change ? change.email : undefined) ?? `${sub.slice(5, 13)}@acme.dev`;
  const { back } = await company(`${sub.slice(5, 13)}@acme.dev`, { sub, email, ...("claims" in change ? { claims: change.claims } : {}) });
  expect([back!.to, back!.cookie.includes("session_token=")]).toEqual([`/login?e=${error}`, false]);
  expect(await userOf(email)).toBeNull();
});

test("a callback opened in another browser, a domain nobody connected, and an account made another way are refused", async () => {
  expect((await company("dee@acme.dev", { sub: "okta|dee", email: "dee@acme.dev" }, { browser: false })).back!.to).toBe("/login?e=sso");
  expect((await company("eve@nowhere.dev", { sub: "x", email: "eve@nowhere.dev" })).start.to).toBe("/login?e=nosso");
  // Fay signed up with a password; her company can't take that account over by naming her email.
  await call("/do/signup", { form: { name: "Fay", email: "fay@acme.dev", password: PASSWORD } });
  const fay = await company("fay@acme.dev", { sub: "okta|fay", email: "fay@acme.dev" });
  expect(fay.back!.to).toBe("/login?e=ssotaken");
  expect(await studiosOf(conf, (await userOf("fay@acme.dev"))!)).toEqual([]);
});

test("only the owner connects it, and never for public mail or a domain another studio has", async () => {
  const maker = (await company("hal@acme.dev", { sub: "okta|hal", email: "hal@acme.dev" })).back!;
  expect((await connect(maker.cookie, { domain: "hal.dev" })).to).toBe("/?tab=studio&e=studio");
  expect((await connect(ada.cookie, { domain: "gmail.com" })).to).toBe("/?tab=studio&e=ssoform");
  const ivy = await call("/do/signup", { form: { name: "Ivy", email: "ivy@other.dev", password: PASSWORD } });
  await call("/do/studio-make", { form: { name: "Other", kind: "team" }, cookie: ivy.cookie });
  const [other] = await studiosOf(conf, (await userOf("ivy@other.dev"))!);
  expect((await call("/do/studio-sso", { cookie: ivy.cookie, form: { studio: other!.id, issuer: ISSUER, clientId: CLIENT, domain: "acme.dev", role: "maker" } })).to).toBe("/?tab=studio&e=ssoclash");
});

test("a proved domain links an account made another way, and outranks another studio's unproved claim", async () => {
  // Jo signed up with a password; Acme proves acme.dev with its TXT record, and Jo's company sign-in now links that account.
  await call("/do/signup", { form: { name: "Jo", email: "jo@acme.dev", password: PASSWORD } });
  const jo = (await userOf("jo@acme.dev"))!;
  expect((await call("/do/studio-sso", { cookie: ada.cookie, form: { studio: acme!.id, prove: "1" } })).to).toBe("/?tab=studio&e=ssoproof");
  txt.set("acme.dev", ["v=spf1 -all", proofOf(acme!.id)]);
  expect((await call("/do/studio-sso", { cookie: ada.cookie, form: { studio: acme!.id, prove: "1" } })).to).toBe("/?tab=studio");
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!))[0]!.sso?.proved).toBe(true);
  const { back } = await company("jo@acme.dev", { sub: "okta|jo", email: "jo@acme.dev" });
  expect(back!.to).toBe("/?tab=studio");
  expect(await userOf("jo@acme.dev")).toBe(jo);
  expect((await studiosOf(conf, jo)).map((x) => x.name)).toEqual(["Acme"]);

  // Kim's studio claimed kim.dev first, unproved; Lee's studio publishes its proof and takes the domain over.
  const kim = await call("/do/signup", { form: { name: "Kim", email: "kim@kim.dev", password: PASSWORD } });
  await call("/do/studio-make", { form: { name: "Kim Co", kind: "business" }, cookie: kim.cookie });
  const [kimCo] = await studiosOf(conf, (await userOf("kim@kim.dev"))!);
  const lee = await call("/do/signup", { form: { name: "Lee", email: "lee@lee.dev", password: PASSWORD } });
  await call("/do/studio-make", { form: { name: "Lee Co", kind: "business" }, cookie: lee.cookie });
  const [leeCo] = await studiosOf(conf, (await userOf("lee@lee.dev"))!);
  const claim = (cookie: string, studio: string) => call("/do/studio-sso", { cookie, form: { studio, issuer: ISSUER, clientId: CLIENT, secret: SECRET, domain: "kim.dev", role: "maker" } });
  expect((await claim(kim.cookie, kimCo!.id)).to).toBe("/?tab=studio");
  expect((await claim(lee.cookie, leeCo!.id)).to).toBe("/?tab=studio&e=ssoclash");
  txt.set("kim.dev", [proofOf(leeCo!.id)]);
  expect((await claim(lee.cookie, leeCo!.id)).to).toBe("/?tab=studio");
  expect((await studiosOf(conf, (await userOf("kim@kim.dev"))!))[0]!.sso).toBeUndefined();
  // Now proved, Kim's studio can't take it back.
  txt.set("kim.dev", [proofOf(kimCo!.id)]);
  expect((await claim(kim.cookie, kimCo!.id)).to).toBe("/?tab=studio&e=ssoclash");
});

test("a seat from company sign-in lapses without another one; a seat the owner handed out doesn't", async () => {
  const { back } = await company("max@acme.dev", { sub: "okta|max", email: "max@acme.dev" });
  const max = (await userOf("max@acme.dev"))!;
  expect((await studiosOf(conf, max)).map((x) => x.name)).toEqual(["Acme"]);
  const gone: string[] = [];
  const later = Date.now() + (SSO_SEAT_DAYS + 1) * 86_400_000;
  expect(await lapseSeats(conf, async (_, user) => gone.push(user), later)).toBeGreaterThan(0);
  expect(gone).toContain(max);
  expect(await studiosOf(conf, max)).toEqual([]);
  // The company's sign-in was Max's only way in, so Max is signed out too; Ada, the owner, stays.
  expect((await call("/do/continue", { cookie: back!.cookie, form: {} })).to).not.toBe("/");
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!)).map((x) => x.name)).toEqual(["Acme"]);
});
