// A token eqosys signed is good for ten minutes on its signature alone; eqosys's own routes also ask whether it still stands.
// Deleting the account ends it at once, a native app signing out ends that app's, and signing out everywhere ends them all.
import { expect, setDefaultTimeout, test } from "bun:test";
import { dpopProof, EC, newKey, thumbprint } from "@rustybuns/util/token";
import { mintRefresh, signOutEverywhere } from "../src/members.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

/** Signed up through Park Hide & Seek, then into qCRM too: a token for each, and who they are. */
async function signUp(name: string) {
  const token = async (app: string, origin: string, cookie?: string) => {
    const a = await asks(app, origin);
    const r = cookie ? await call("/do/continue", { form: a.form, cookie })
      : await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
    const who = await (await call("/api/exchange", { json: { app, code: codeIn(r.to), verifier: a.verifier } })).res.json() as { token: string; user: { id: string } };
    return { ...who, cookie: cookie ?? r.cookie };
  };
  const park = await token("park-hide-seek", PARK);
  const qcrm = await token("qcrm", QCRM, park.cookie);
  return { id: park.user.id, park: park.token, qcrm: qcrm.token };
}
const save = (token: string) => call("/q/save/run", { bearer: token, origin: PARK }).then((r) => r.res.status);
const whoami = (token: string) => call("/api/tools/eq_whoami", { json: {}, bearer: token }).then((r) => r.res.status);

test("a deleted account's token can't write a save or call a tool afterwards", async () => {
  const ada = await signUp("Ada");
  expect(await save(ada.park)).toBe(404);
  expect((await call("/api/account/delete", { json: {}, bearer: ada.park, origin: PARK })).res.status).toBe(200);
  expect([await save(ada.park), await whoami(ada.qcrm)]).toEqual([401, 401]);
  expect((await call("/api/account/delete", { json: {}, bearer: ada.park, origin: PARK })).res.status).toBe(401);
});

test("a native app signing out ends that app's tokens, not another app's; signing out everywhere ends them all", async () => {
  const bo = await signUp("Bo");
  const refresh = await mintRefresh(conf, bo.id, "park-hide-seek");
  expect((await call("/oauth/revoke", { form: { token: refresh } })).res.status).toBe(200);
  expect([await save(bo.park), await whoami(bo.qcrm)]).toEqual([401, 200]);
  expect((await call("/oauth/userinfo", { bearer: bo.park })).res.status).toBe(401);

  await signOutEverywhere(conf, bo.id);
  expect(await whoami(bo.qcrm)).toBe(401);
});

test("signing out on the eqosys page ends every app's tokens, not just the page's session", async () => {
  const cy = await signUp("Cy");
  expect([await save(cy.park), await whoami(cy.qcrm)]).toEqual([404, 200]);
  const a = await asks("park-hide-seek", PARK);
  const inAgain = await call("/do/signin", { form: { ...a.form, email: "cy@example.com", password: PASSWORD } });
  expect((await call("/do/logout", { form: {}, cookie: inAgain.cookie })).to).toBe("/login");
  expect([await save(cy.park), await whoami(cy.qcrm)]).toEqual([401, 401]);
});

test("a game page keeps a refresh token: it renews without a bounce, stays a page's, and signing out on eqosys ends it but not a native app's", async () => {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name: "Di", email: "di@example.com", password: PASSWORD } });
  const got = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier, keep: true } })).res.json() as { refresh: string; user: { id: string } };
  const renew = (refresh_token: string) => call("/oauth/token", { form: { grant_type: "refresh_token", client_id: "park-hide-seek", refresh_token }, origin: PARK });
  const next = await (await renew(got.refresh)).res.json() as { access_token: string; refresh_token: string };
  expect(await save(next.access_token)).toBe(404);
  expect((await renew(got.refresh)).res.status).toBe(400); // spent

  const native = await mintRefresh(conf, got.user.id, "park-hide-seek");
  expect((await call("/do/logout", { form: {}, cookie: up.cookie })).to).toBe("/login");
  expect([(await renew(next.refresh_token)).res.status, (await renew(native)).res.status]).toEqual([400, 200]);
});

test("a page's refresh token is bound to its key: copied out of the page it spends nowhere, and the page renews with its proof", async () => {
  const key = await crypto.subtle.generateKey(EC, false, ["sign", "verify"]), thief = await crypto.subtle.generateKey(EC, false, ["sign", "verify"]);
  const proof = (k: CryptoKeyPair, path: string) => dpopProof(k, "POST", ORIGIN + path);
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name: "Ed", email: "ed@example.com", password: PASSWORD } });
  const got = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier, keep: true }, dpop: await proof(key, "/api/exchange") })).res.json() as { refresh: string; user: { id: string } };
  const renew = async (refresh_token: string, k?: CryptoKeyPair) =>
    (await call("/oauth/token", { form: { grant_type: "refresh_token", client_id: "park-hide-seek", refresh_token }, origin: PARK, ...(k ? { dpop: await proof(k, "/oauth/token") } : {}) })).res;

  // the page renews with its own proof, and the next token is bound to the same key
  const mine = await renew(got.refresh, key);
  expect(mine.status).toBe(200);
  const next = (await mine.json() as { refresh_token: string }).refresh_token;
  expect((await renew(next, key)).status).toBe(200);
  // copied out of the page: with no proof, or with the copier's own key, it spends nowhere
  const jkt = await thumbprint(await crypto.subtle.exportKey("jwk", key.publicKey) as { crv: string; kty: string; x: string; y: string });
  const bound = async () => (await mintRefresh(conf, got.user.id, "park-hide-seek", Date.now(), true, jkt))!;
  expect([(await renew(await bound())).status, (await renew(await bound(), thief)).status]).toEqual([400, 400]);
});

test("a sign-out everywhere landing while a native app renews leaves it no refresh token", async () => {
  const fi = await signUp("Fi"), first = await mintRefresh(conf, fi.id, "park-hide-seek");
  const renew = (refresh_token: string) => call("/oauth/token", { form: { grant_type: "refresh_token", client_id: "park-hide-seek", refresh_token } });
  // The sign-out lands just after the old token is spent, while eqosys reads who it was for.
  const prepare = conf.DB.prepare.bind(conf.DB);
  let racing = true;
  conf.DB.prepare = (sql: string) => {
    const st = prepare(sql);
    if (!racing || !sql.startsWith("SELECT u.id, u.email")) return st;
    racing = false;
    const bind = st.bind.bind(st);
    st.bind = (...args: unknown[]) => {
      const bound = bind(...args), first = bound.first.bind(bound);
      bound.first = (async () => { await signOutEverywhere(conf, fi.id); return first(); }) as typeof bound.first;
      return bound;
    };
    return st;
  };
  try {
    const next = await (await renew(first)).res.json() as { refresh_token: string };
    expect((await renew(next.refresh_token)).res.status).toBe(400);
  } finally { conf.DB.prepare = prepare; }
});
