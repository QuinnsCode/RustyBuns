// Studios, the way the owner and a teammate meet them: the super admin finds QNTBR already holding every app, a teammate makes
// their own studio and is added to QNTBR, roles hold, and deleting an account takes the studio it owned alone with it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { APPS } from "../src/apps.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const { call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });

async function signUp(name: string, email = `${name.toLowerCase()}@example.com`) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string };
  return { cookie: up.cookie, token: who.token };
}
const run = async (name: string, args: unknown, who: { cookie?: string; token?: string }) => {
  const { res } = await call(`/api/tools/${name}`, { json: args, ...(who.cookie ? { cookie: who.cookie } : {}), ...(who.token ? { bearer: who.token } : {}) });
  return { status: res.status, body: await res.json() as { result?: { studios: Shelf[] }; error?: string } };
};
type Shelf = { id: string; name: string; kind: string; role: string; members: number; apps: { id: string; play: string | null; make: string | null; ship: string }[] };
const studios = async (who: { cookie?: string; token?: string }) => (await run("eq_studios", {}, who)).body.result?.studios ?? [];

test("QNTBR is the owner's business studio with every app; a teammate makes their own, joins QNTBR as a maker, and leaves with theirs", async () => {
  const boss = await signUp("Boss", "boss@example.com"), ada = await signUp("Ada");

  const [qntbr, ...rest] = await studios({ cookie: boss.cookie });
  expect(rest).toEqual([]);
  expect(qntbr).toMatchObject({ id: "qntbr", name: "QNTBR", kind: "business", role: "owner", members: 1 });
  expect(qntbr!.apps.map((a) => a.id).sort()).toEqual(APPS.map((a) => a.id).sort());
  expect(qntbr!.apps.find((a) => a.id === "codesplitter")).toMatchObject({ play: "https://codesplitter.notryanquinn.workers.dev", make: null, ship: "live" });
  expect(qntbr!.apps.find((a) => a.id === "at-lens")).toMatchObject({ play: null, ship: "not deployed" });
  expect((await studios({ cookie: boss.cookie })).length).toBe(1); // asking again makes nothing new

  expect(await studios({ cookie: ada.cookie })).toEqual([]);
  const made = await run("eq_studio_make", { name: "Ada Works", kind: "team" }, { token: ada.token });
  expect(made.status).toBe(200);
  expect((await run("eq_studio_make", { name: "x", kind: "guild" }, { token: ada.token })).status).toBe(400);

  // Adding by email is for the page; an app's token is refused, and so is a maker adding people.
  expect((await run("eq_studio_add", { studio: "qntbr", email: "ada@example.com", role: "maker" }, { token: boss.token })).status).toBe(403);
  expect((await run("eq_studio_add", { studio: "qntbr", email: "ada@example.com", role: "maker" }, { cookie: boss.cookie })).status).toBe(200);
  expect((await run("eq_studio_add", { studio: "qntbr", email: "boss@example.com", role: "maker" }, { cookie: ada.cookie })).status).toBe(403);
  expect((await run("eq_studio_add", { studio: "qntbr", email: "nobody@example.com", role: "maker" }, { cookie: boss.cookie })).status).toBe(404);

  const hers = await studios({ cookie: ada.cookie });
  expect(hers.map((s) => [s.name, s.kind, s.role])).toEqual([["Ada Works", "team", "owner"], ["QNTBR", "business", "maker"]]);
  expect(hers.find((s) => s.id === "qntbr")!.members).toBe(2);

  expect((await call("/api/account/delete", { json: {}, bearer: ada.token })).res.status).toBe(200);
  const after = await studios({ cookie: boss.cookie });
  expect(after.map((s) => [s.id, s.members, s.apps.length])).toEqual([["qntbr", 1, APPS.length]]);
});
