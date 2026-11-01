// A game that keeps account data registers an erase URL: deleting the account calls it with a 60-second `aud: "erase"` token
// and retries until it answers 200. If it never does, the account stays so deleting again is safe.
import { expect, setDefaultTimeout, test } from "bun:test";
import { jwksOf, newKey, verify } from "@rustybuns/util/token";
import { APPS } from "../src/apps.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const conf = { EQOSYS_SIGNING_KEY: await newKey() };
const { call } = await boot(conf);
const park = APPS.find((a) => a.id === "park-hide-seek")!;

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const r = await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } });
  const who = await r.res.json() as { token: string; user: { id: string } };
  return who;
}

test("an erase URL is called with a short erase token, retried, and holds the account until it answers 200", async () => {
  const realFetch = globalThis.fetch;
  const seen: { sub: string; life: number }[] = [];
  let answers = [500, 200];
  park.erase = "https://park.example/erase";
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) !== park.erase) return realFetch(url, init);
    const token = /^Bearer (\S+)$/.exec(new Headers(init?.headers).get("authorization") ?? "")![1]!;
    const claims = await verify(token, await jwksOf(conf), { iss: ORIGIN, aud: "erase" });
    if (!claims) return new Response("bad token", { status: 401 });
    seen.push({ sub: claims.sub, life: claims.exp - claims.iat });
    return new Response("", { status: answers.shift() ?? 200 });
  }) as typeof fetch;
  try {
    const ada = await signUp("Ada");
    // 500 then 200: one retry, then the account goes.
    expect((await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.status).toBe(200);
    expect(seen).toEqual([{ sub: ada.user.id, life: 60 }, { sub: ada.user.id, life: 60 }]);
    expect((await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.status).toBe(200);

    // Never 200: the account is kept, and the reply says it was not deleted.
    const bo = await signUp("Bo");
    answers = [500, 500, 500];
    const failed = await call("/api/account/delete", { json: {}, bearer: bo.token, origin: PARK });
    expect(await failed.res.json()).toEqual({ ok: false });
    answers = [200];
    expect(await (await call("/api/account/delete", { json: {}, bearer: bo.token, origin: PARK })).res.json()).toEqual({ ok: true });
  } finally { globalThis.fetch = realFetch; delete park.erase; }
});
