// Company sign-in (src/sso.ts, #4793): a studio's owner connects the company's OpenID provider, and someone with a work email
// on its domain signs in through it and lands in the studio. The provider is a fake one in-process: its discovery, JWKS and
// token endpoint answer from a local RS256 key, and its "sign-in page" is the test handing back a code.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { arr, check, obj, str } from "@rustybuns/util/guard";
import { authFor } from "../src/auth.ts";
import { studiosOf } from "../src/studios.ts";
import { DOH, lapseSeats, proofOf, proveDomain, SSO_SEAT_DAYS } from "../src/sso.ts";
import { mintRefresh, spendRefresh } from "../src/members.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const ISSUER = "https://idp.acme.dev", CLIENT = "eqosys-acme", SECRET = "s3cret-from-the-provider";
const { conf, call } = await boot();
/** Whose hub tabs were told to close (members.ts closeMany): the hub an order reaches, and the others it passes it on to. */
const shut: string[] = [];
conf.HUB = { idFromName: (name: string) => name, get: (id: unknown) => ({ fetch: async (req: Request) => {
  if (new URL(req.url).pathname === "/out") shut.push(String(id), ...(check(obj({ more: arr(str(), 100) }), await req.json())?.more ?? []));
  return Response.json({ ok: true });
} }) };

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
/** A domain whose resolver doesn't answer until this settles. */
const slow = new Map<string, Promise<void>>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  if (req.url.startsWith(DOH)) {
    const name = new URL(req.url).searchParams.get("name") ?? "";
    await slow.get(name);
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

/** "Sign in through your company" with `email`, the provider signing in `who`, and back. `browser` false: the callback opens elsewhere;
 * `session`: the cookie of an eqosys sign-in that browser already holds. */
async function company(email: string, who: Person, o: { ask?: Record<string, string>; browser?: boolean; session?: string } = {}) {
  const start = await call("/do/sso", { form: { ...o.ask, email } });
  if (!start.to.startsWith(ISSUER)) return { start, back: null };
  const at = new URL(start.to), code = crypto.randomUUID();
  expect(at.searchParams.get("login_hint")).toBe(email);
  codes.set(code, { who, nonce: at.searchParams.get("nonce")!, challenge: at.searchParams.get("code_challenge")!, redirect: at.searchParams.get("redirect_uri")! });
  const cb = new URL(at.searchParams.get("redirect_uri")!);
  const back = await call(`${cb.pathname}?${new URLSearchParams({ code, state: at.searchParams.get("state")! })}`, o.browser === false ? {} : { cookie: [start.cookie, o.session].filter(Boolean).join("; ") });
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
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!))[0]!.sso).toEqual({ issuer: ISSUER, clientId: CLIENT, domain: "acme.dev", role: "maker", secret: true, proved: false, only: false });
  // Saving again with the secret left blank keeps it.
  await connect(ada.cookie, { secret: "", role: "admin" });
  await connect(ada.cookie, { secret: "" });
  expect(await conf.DB.prepare("SELECT secret FROM studio_sso WHERE studio_id = ?").bind(acme!.id).first<string>("secret")).toBe(kept);

  // Until the domain is proved nobody signs in this way: anyone could connect their own provider and name a company's domain.
  expect((await company("bo@acme.dev", { sub: "okta|bo", email: "bo@acme.dev" })).start.to).toBe("/login?e=nosso");
  const prove = () => call("/do/studio-sso", { cookie: ada.cookie, form: { studio: acme!.id, prove: "1" } });
  expect((await prove()).to).toBe("/?tab=studio&e=ssoproof");
  txt.set("acme.dev", ["v=spf1 -all", proofOf(acme!.id)]);
  expect((await prove()).to).toBe("/?tab=studio");
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!))[0]!.sso?.proved).toBe(true);

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

test("a callback opened in another browser and a domain nobody connected are refused; a first link takes away the ways in nobody proved", async () => {
  expect((await company("dee@acme.dev", { sub: "okta|dee", email: "dee@acme.dev" }, { browser: false })).back!.to).toBe("/login?e=sso");
  expect((await company("eve@nowhere.dev", { sub: "x", email: "eve@nowhere.dev" })).start.to).toBe("/login?e=nosso");
  // Someone else signed up with Fay's address, which nobody ever proved, and kept an app signed in to it.
  const squat = await call("/do/signup", { form: { name: "Fay", email: "fay@acme.dev", password: PASSWORD } });
  const fay = (await userOf("fay@acme.dev"))!, kept = await mintRefresh(conf, fay, "park-hide-seek");
  expect((await company("fay@acme.dev", { sub: "okta|fay", email: "fay@acme.dev" })).back!.to).toBe("/?tab=studio");
  expect(await userOf("fay@acme.dev")).toBe(fay);
  // Fay's company sign-in is the only way in now.
  expect((await call("/do/continue", { cookie: squat.cookie, form: {} })).to).not.toBe("/");
  expect(await spendRefresh(conf, "park-hide-seek", kept)).toBeNull();
  expect((await call("/do/signin", { form: { email: "fay@acme.dev", password: PASSWORD } })).cookie).not.toContain("session_token=");
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
  // Jo signed up with a password and is signed in here: Jo's company sign-in links that account, and both stay Jo's.
  const signedUp = await call("/do/signup", { form: { name: "Jo", email: "jo@acme.dev", password: PASSWORD } });
  const jo = (await userOf("jo@acme.dev"))!;
  const { back } = await company("jo@acme.dev", { sub: "okta|jo", email: "jo@acme.dev" }, { session: signedUp.cookie });
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

test("a proved domain's studio makes company sign-in the only way in for its emails", async () => {
  const only = (cookie: string, on: "1" | "0") => call("/do/studio-sso", { cookie, form: { studio: acme!.id, only: on } });
  // Ada, the owner, is on acme.dev with a password only: turning it on now would lock her out.
  expect((await only(ada.cookie, "1")).to).toBe("/?tab=studio&e=ssoonlyfirst");
  const adaCo = (await company("ada@acme.dev", { sub: "okta|ada", email: "ada@acme.dev" }, { session: ada.cookie })).back!;
  const appKept = await mintRefresh(conf, (await userOf("jo@acme.dev"))!, "park-hide-seek");
  expect((await only(adaCo.cookie, "1")).to).toBe("/?tab=studio");
  // An app a password sign-in left behind is signed out too, and the tabs already open close.
  expect(await spendRefresh(conf, "park-hide-seek", appKept)).toBeNull();
  expect(shut).toContain((await userOf("jo@acme.dev"))!);
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!))[0]!.sso?.only).toBe(true);
  // Everyone on acme.dev was signed out; a password sign-in or sign-up there is refused, and the company's own works.
  expect((await call("/do/continue", { cookie: adaCo.cookie, form: {} })).to).not.toBe("/");
  expect((await call("/do/signin", { form: { email: "jo@acme.dev", password: PASSWORD } })).to).toBe("/login?e=ssoonly");
  expect((await call("/do/signup", { form: { name: "Nan", email: "nan@acme.dev", password: PASSWORD } })).to).toBe("/login?e=ssoonly");
  expect(await userOf("nan@acme.dev")).toBeNull();
  // The Better Auth hooks hold too, for a way in that skips the form (GitHub, Google, Apple).
  const auth = authFor(new Request("http://localhost/"), conf);
  expect(await auth.api.signInEmail({ body: { email: "jo@acme.dev", password: PASSWORD } }).then(() => "in", () => "refused")).toBe("refused");
  expect(await auth.api.signUpEmail({ body: { name: "Nan", email: "nan@acme.dev", password: PASSWORD } }).then(() => "in", () => "refused")).toBe("refused");
  const jo = (await company("jo@acme.dev", { sub: "okta|jo", email: "jo@acme.dev" })).back!;
  expect([jo.to, jo.cookie.includes("session_token=")]).toEqual(["/?tab=studio", true]);
  // Another domain is untouched; turned off, a password works again.
  expect((await call("/do/signin", { form: { email: "kim@kim.dev", password: PASSWORD } })).to).not.toContain("e=");
  const back = (await company("ada@acme.dev", { sub: "okta|ada", email: "ada@acme.dev" })).back!;
  expect((await only(back.cookie, "0")).to).toBe("/?tab=studio");
  expect((await call("/do/signin", { form: { email: "jo@acme.dev", password: PASSWORD } })).to).not.toContain("e=");
});

test("a seat from company sign-in lapses without another one; a seat the owner handed out doesn't", async () => {
  const { back } = await company("max@acme.dev", { sub: "okta|max", email: "max@acme.dev" });
  const max = (await userOf("max@acme.dev"))!;
  expect((await studiosOf(conf, max)).map((x) => x.name)).toEqual(["Acme"]);
  const gone: string[] = [], appKept = await mintRefresh(conf, max, "park-hide-seek");
  const later = Date.now() + (SSO_SEAT_DAYS + 1) * 86_400_000;
  expect(await lapseSeats(conf, async (_, user) => gone.push(user), later)).toBeGreaterThan(0);
  expect(gone).toContain(max);
  expect(await studiosOf(conf, max)).toEqual([]);
  // The company's sign-in was Max's only way in, so Max is signed out too; Ada, the owner, stays.
  expect((await call("/do/continue", { cookie: back!.cookie, form: {} })).to).not.toBe("/");
  expect(await spendRefresh(conf, "park-hide-seek", appKept)).toBeNull();
  // And the tabs Max already had open close.
  expect(shut).toContain(max);
  expect((await studiosOf(conf, (await userOf("ada@acme.dev"))!)).map((x) => x.name)).toEqual(["Acme"]);
});

test("a proof counts only for the domain it read, and a link only for an email on the domain the studio holds now", async () => {
  const rex = await call("/do/signup", { form: { name: "Rex", email: "rex@rex.dev", password: PASSWORD } });
  await call("/do/studio-make", { form: { name: "Rex Co", kind: "business" }, cookie: rex.cookie });
  const rexId = (await userOf("rex@rex.dev"))!, [co] = await studiosOf(conf, rexId);
  const use = (domain: string) => call("/do/studio-sso", { cookie: rex.cookie, form: { studio: co!.id, issuer: ISSUER, clientId: CLIENT, secret: SECRET, domain, role: "maker" } });
  const proved = async () => (await studiosOf(conf, rexId))[0]!.sso!.proved;

  // The check of rex-own.dev is still waiting on its resolver when the domain is changed to somebody else's.
  await use("rex-own.dev");
  txt.set("rex-own.dev", [proofOf(co!.id)]);
  let answer!: () => void;
  slow.set("rex-own.dev", new Promise<void>((r) => { answer = r; }));
  const checking = proveDomain(conf, co!.id, rexId);
  await new Promise((r) => setTimeout(r, 20));
  await use("victim.dev");
  answer();
  expect((await checking).ok).toBe(false);
  expect(await proved()).toBe(false);

  // A coworker made while rex-own.dev was theirs doesn't come back under an email on another domain.
  slow.delete("rex-own.dev");
  await use("rex-own.dev");
  await proveDomain(conf, co!.id, rexId);
  expect((await company("pat@rex-own.dev", { sub: "okta|pat", email: "pat@rex-own.dev" })).back!.to).toBe("/?tab=studio");
  await use("rex-new.dev");
  txt.set("rex-new.dev", [proofOf(co!.id)]);
  await proveDomain(conf, co!.id, rexId);
  expect((await company("pat@rex-new.dev", { sub: "okta|pat", email: "pat@rex-new.dev" })).back!.to).toBe("/login?e=ssodomain");
});
