// Studios, the way the owner and a teammate meet them: the super admin finds QNTBR already holding every app, a teammate makes
// their own studio and is added to QNTBR from the Studio tab, roles hold, and deleting an account takes the studio it owned alone with it.
// Then a deploy tells eqosys what went out (the CLI's own reporter, packages/cli/src/report-deploy.ts), and the Ship door shows it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { APPS } from "../src/apps.ts";
import { reportDeploy } from "../../../packages/cli/src/report-deploy.ts";
import { handle } from "../src/handle.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);
const KEY = "test-deploy-report-key";
const { call, conf } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), DEPLOY_REPORT_KEY: KEY });

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
type Shelf = { id: string; name: string; kind: string; role: string; members: number; people: { name: string; role: string }[];
  apps: { id: string; play: string | null; make: string | null; ship: string; shipped: { stage: string; version: string; at: number } | null }[] };
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

  // Adding by email is for the page: the Studio tab's form (or the tool, signed in there); an app's token is refused, and so is a maker adding people.
  const add = (who: { cookie: string }, email: string, role = "maker") => call("/do/studio-add", { form: { studio: "qntbr", email, role }, cookie: who.cookie }).then((r) => r.to);
  expect((await run("eq_studio_add", { studio: "qntbr", email: "ada@example.com", role: "maker" }, { token: boss.token })).status).toBe(403);
  expect(await add(boss, "nobody@example.com")).toBe("/?tab=studio&e=nobody");
  expect(await add(boss, "ada@example.com")).toBe("/?tab=studio");
  expect(await add(ada, "boss@example.com")).toBe("/?tab=studio&e=studio");
  expect((await run("eq_studio_add", { studio: "qntbr", email: "boss@example.com", role: "maker" }, { cookie: ada.cookie })).status).toBe(403);
  expect((await studios({ cookie: boss.cookie }))[0]!.people.map((p) => [p.name, p.role])).toEqual([["Boss", "owner"], ["Ada", "maker"]]);

  const hers = await studios({ cookie: ada.cookie });
  expect(hers.map((s) => [s.name, s.kind, s.role])).toEqual([["Ada Works", "team", "owner"], ["QNTBR", "business", "maker"]]);
  expect(hers.find((s) => s.id === "qntbr")!.members).toBe(2);

  expect((await call("/api/account/delete", { json: {}, bearer: ada.token })).res.status).toBe(200);
  const after = await studios({ cookie: boss.cookie });
  expect(after.map((s) => [s.id, s.members, s.apps.length])).toEqual([["qntbr", 1, APPS.length]]);
});

test("a deploy reports what went out, and the Ship door shows its stage, version and time", async () => {
  // The owner from the test above, signed in again: QNTBR's shelf is theirs.
  const boss = { cookie: (await call("/do/signin", { form: { email: "boss@example.com", password: PASSWORD } })).cookie };
  // The CLI's reporter, sent straight into this eqosys.
  const send = ((url: string, init?: RequestInit) => handle(new Request(url, init), conf).then((r) => r!)) as typeof fetch;
  const report = (r: Partial<{ app: string; at: number; version: string }>, key: string | null = KEY) =>
    reportDeploy({ app: "git-recon", stage: "production", version: "0.0.1+abc1234", at: Date.now(), ...r }, { RB_DEPLOY_REPORT_KEY: key ?? undefined, RB_EQOSYS_URL: "http://eqosys.local" }, send);
  const ship = async (id: string) => (await studios({ cookie: boss.cookie }))[0]!.apps.find((a) => a.id === id)!;

  expect(await ship("at-lens")).toMatchObject({ ship: "not deployed", shipped: null });
  expect(await report({}, null)).toContain("no RB_DEPLOY_REPORT_KEY");
  for (const [r, key, said] of [
    [{}, "the wrong key", "401"], [{ at: Date.now() - 60 * 60_000 }, KEY, "400"], [{ app: "no-such-app" }, KEY, "isn't in its APPS"],
  ] as const) expect(await report(r, key)).toContain(said);
  expect((await ship("git-recon")).shipped).toBeNull();

  const at = Date.now();
  expect(await report({ at })).toBe("told eqosys: git-recon production 0.0.1+abc1234");
  expect(await report({ at: at - 1000, version: "0.0.0+older" })).toStartWith("told eqosys"); // late and older: kept out
  expect(await ship("git-recon")).toMatchObject({ ship: "live", shipped: { stage: "production", version: "0.0.1+abc1234", at } });
  // An app with no site yet is live once it ships.
  await report({ app: "at-lens", version: "0.2.0" });
  expect(await ship("at-lens")).toMatchObject({ ship: "live", shipped: { version: "0.2.0" } });
});
