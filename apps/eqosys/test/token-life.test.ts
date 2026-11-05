// A token eqosys signed is good for ten minutes on its signature alone; eqosys's own routes also ask whether it still stands.
// Deleting the account ends it at once, a native app signing out ends that app's, and signing out everywhere ends them all.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { mintRefresh, signOutEverywhere } from "../src/members.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

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
