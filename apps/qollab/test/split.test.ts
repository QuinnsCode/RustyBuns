// Qollab in its own Worker (#3816): eqosys hands it every Qollab path over a service binding, and it checks an app's token against
// eqosys's public keys over a binding back, holding no signing key of its own. A game sees the same answers as before the split.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../../eqosys/src/handle.ts";
import type { Env } from "../../eqosys/src/env.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "../../eqosys/test/kit.ts";
import qollab from "../src/worker.ts";

setDefaultTimeout(30_000);
const handed: string[] = [];
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
// Qollab's env: eqosys's database, the binding back to eqosys, and no key.
const q: Env = { DB: conf.DB, BETTER_AUTH_URL: ORIGIN, EQOSYS: { fetch: async (url) => (await handle(new Request(url), conf))! } };
conf.QOLLAB = { fetch: async (req) => { const r = req instanceof Request ? req : new Request(req); handed.push(new URL(r.url).pathname); return qollab.fetch(r, q); } };

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const r = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  return await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(r.to), verifier: a.verifier } })).res.json() as { token: string };
}

test("a game's token opens Qollab's paths through eqosys, a bad or deleted one doesn't, and eqosys keeps its own /q/achieve", async () => {
  const ada = await signUp("Ada");
  const save = (bearer: string) => call("/q/save/run", { bearer, origin: PARK }).then((r) => r.res.status);
  // 404: the token stood (no save in that slot yet). The answer came from Qollab's Worker.
  expect(await save(ada.token)).toBe(404);
  expect(handed).toEqual(["/q/save/run"]);
  expect(await save(ada.token.slice(0, -4) + "AAAA")).toBe(401);
  expect((await call("/q/achieve", { bearer: ada.token, origin: PARK })).res.status).not.toBe(404);
  expect(handed).toEqual(["/q/save/run", "/q/save/run"]);
  // Deleting the account in eqosys ends the token in Qollab too: they read one database.
  expect((await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.status).toBe(200);
  expect(await save(ada.token)).toBe(401);
});
