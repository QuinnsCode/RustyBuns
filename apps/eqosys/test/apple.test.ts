// Sign in with Apple's server notifications (src/apple.ts): Apple's RS256 JWT, checked against its JWKS (stubbed here
// with a local key), signs someone out on consent-revoked and deletes them on account-delete; anything else is a 401.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { b64url } from "@rustybuns/util/bytes";
import { APPLE_ISS, APPLE_KEYS } from "../src/apple.ts";
import { mintRefresh } from "../src/members.ts";
import { asks, boot, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const SERVICES_ID = "com.example.eqosys.web";
const { conf, call } = await boot({ APPLE_CLIENT_ID: SERVICES_ID });

const RS256 = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
const apple = await crypto.subtle.generateKey(RS256, true, ["sign", "verify"]);
const stranger = await crypto.subtle.generateKey(RS256, true, ["sign", "verify"]);
const { n, e } = await crypto.subtle.exportKey("jwk", apple.publicKey);

// Apple's JWKS, served from a local key: every other fetch goes out as it would.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
  String(url) === APPLE_KEYS ? Response.json({ keys: [{ kty: "RSA", kid: "apple-1", use: "sig", alg: "RS256", n, e }] }) : realFetch(url, init)) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

const part = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));
/** What Apple POSTs: its events as a JSON string inside a JWT, signed with `key`. */
async function notice(type: string, sub: string, o: { key?: CryptoKey; aud?: string; alg?: string } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const head = `${part({ alg: o.alg ?? "RS256", kid: "apple-1" })}.${part({ iss: APPLE_ISS, aud: o.aud ?? SERVICES_ID, iat, jti: crypto.randomUUID(), events: JSON.stringify({ type, sub, event_time: iat * 1000 }) })}`;
  const sig = o.alg === "none" ? "" : b64url(new Uint8Array(await crypto.subtle.sign(RS256, o.key ?? apple.privateKey, new TextEncoder().encode(head))));
  return { payload: `${head}.${sig}` };
}

/** Someone who signed up, has a session and a native app's refresh token, and an Apple sign-in linked as `sub`. */
async function person(name: string, sub: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  expect(up.cookie).toContain("session");
  const { id } = (await conf.DB.prepare(`SELECT id FROM "user" WHERE email = ?`).bind(`${name.toLowerCase()}@example.com`).first<{ id: string }>())!;
  await mintRefresh(conf, id, "park-hide-seek");
  const now = new Date().toISOString();
  await conf.DB.prepare(`INSERT INTO "account" (id, "accountId", "providerId", "userId", "createdAt", "updatedAt") VALUES (?, ?, 'apple', ?, ?, ?)`).bind(crypto.randomUUID(), sub, id, now, now).run();
  return id;
}
const count = async (sql: string, id: string) => (await conf.DB.prepare(sql).bind(id).first<{ n: number }>())!.n;
const sessions = (id: string) => count(`SELECT count(*) AS n FROM "session" WHERE "userId" = ?`, id);
const refreshes = (id: string) => count("SELECT count(*) AS n FROM refresh WHERE user_id = ?", id);
const users = (id: string) => count(`SELECT count(*) AS n FROM "user" WHERE id = ?`, id);

test("consent revoked signs them out everywhere; their Apple account deleted deletes ours", async () => {
  const ada = await person("Ada", "apple.ada");
  expect([await sessions(ada), await refreshes(ada)]).toEqual([1, 1]);
  const out = await call("/api/apple/events", { json: await notice("consent-revoked", "apple.ada") });
  expect(out.res.status).toBe(200);
  expect([await sessions(ada), await refreshes(ada), await users(ada)]).toEqual([0, 0, 1]);

  const bo = await person("Bo", "apple.bo");
  expect((await call("/api/apple/events", { json: await notice("account-delete", "apple.bo") })).res.status).toBe(200);
  expect(await users(bo)).toBe(0);
  // Someone we never saw, and an event we don't act on: both answered 200 so Apple stops sending them.
  expect((await call("/api/apple/events", { json: await notice("account-delete", "apple.nobody") })).res.status).toBe(200);
  expect((await call("/api/apple/events", { json: await notice("email-disabled", "apple.ada") })).res.status).toBe(200);
});

test("a captured notification sent again does nothing: the person who came back and linked Apple anew stays", async () => {
  const gus = await person("Gus", "apple.gus");
  const captured = await notice("account-delete", "apple.gus");
  expect((await call("/api/apple/events", { json: captured })).res.status).toBe(200);
  expect(await users(gus)).toBe(0);
  const again = await person("Gus", "apple.gus");
  const replay = await call("/api/apple/events", { json: captured });
  expect(replay.res.status).toBe(200);
  expect(await users(again)).toBe(1);
  // A fresh notification Apple signs still acts.
  expect((await call("/api/apple/events", { json: await notice("consent-revoked", "apple.gus") })).res.status).toBe(200);
  expect(await sessions(again)).toBe(0);
});

test.each([
  ["unsigned (alg none)", { alg: "none" }],
  ["signed by a key that isn't Apple's", { key: stranger.privateKey }],
  ["for another Services ID", { aud: "com.someone.else" }],
] as const)("a notification %s is a 401 and changes nothing", async (_, o) => {
  const cy = await person(`Cy${crypto.randomUUID().slice(0, 6)}`, `apple.${crypto.randomUUID()}`);
  const sub = (await conf.DB.prepare(`SELECT "accountId" AS s FROM "account" WHERE "userId" = ? AND "providerId" = 'apple'`).bind(cy).first<{ s: string }>())!.s;
  expect((await call("/api/apple/events", { json: await notice("account-delete", sub, o) })).res.status).toBe(401);
  expect([await users(cy), await sessions(cy)]).toEqual([1, 1]);
});

test("no body, or no Services ID configured, is turned away", async () => {
  expect((await call("/api/apple/events", { json: {} })).res.status).toBe(401);
  const off = await boot();
  expect((await off.call("/api/apple/events", { json: await notice("account-delete", "apple.ada") })).res.status).toBe(503);
});
