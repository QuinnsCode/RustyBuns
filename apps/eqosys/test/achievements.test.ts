// A game unlocks achievements with its token: kept the first time, only its own catalog's, a secret one hidden until
// it is earned, shown on the home page, and gone with the account.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { unlocksOf } from "../src/achievements.ts";
import { asks, boot, codeIn, ORIGIN, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);
const GOLF = "https://alien-disc-golf.notryanquinn.workers.dev";
type Reply = { achievement: { id: string; name: string; at: number }; new: boolean };
type List = { achievements: { id: string; name: string; secret: boolean; at: number | null }[] };

test("unlock, unlock again, someone else's, a secret one, and account delete", async () => {
  const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
  const tokenFor = async (app: string, origin: string, cookie?: string) => {
    const a = await asks(app, origin);
    const r = cookie ? await call("/do/continue", { form: a.form, cookie }) : await call("/do/signup", { form: { ...a.form, name: "Ada", email: "ada@example.com", password: PASSWORD } });
    const token = (await (await call("/api/exchange", { json: { app, code: codeIn(r.to), verifier: a.verifier } })).res.json() as { token: string }).token;
    return { token, cookie: cookie ?? r.cookie };
  };
  const ach = (token: string, id?: string) => handle(new Request(`${ORIGIN}/q/achieve`, {
    method: id === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, origin: GOLF, "content-type": "application/json" },
    ...(id === undefined ? {} : { body: JSON.stringify({ id }) }),
  }), conf).then((r) => r!);

  const golf = await tokenFor("alien-disc-golf", GOLF);
  const first = await (await ach(golf.token, "birdie")).json() as Reply;
  expect(first).toMatchObject({ new: true, achievement: { id: "birdie", name: "Birdie" } });
  // Again (a second tab, a replay): not new, same time.
  expect(await (await ach(golf.token, "birdie")).json()).toEqual({ ...first, new: false });
  expect((await ach(golf.token, "made-up")).status).toBe(404);
  expect((await ach("nonsense", "birdie")).status).toBe(401);
  // qCRM's token can't unlock the game's.
  const crm = await tokenFor("qcrm", QCRM, golf.cookie);
  expect((await ach(crm.token, "birdie")).status).toBe(404);

  // The list: the secret one says nothing until it is earned.
  const before = (await (await ach(golf.token)).json() as List).achievements;
  expect(before[0]).toMatchObject({ id: "birdie", at: first.achievement.at });
  expect(before.find((a) => a.id === "ace")).toMatchObject({ name: "Secret achievement", secret: true, at: null });
  await ach(golf.token, "ace");
  expect((await (await ach(golf.token)).json() as List).achievements.find((a) => a.id === "ace")?.name).toBe("Across the world in one");

  // What the home page's Achievements tab reads.
  const me = await conf.DB.prepare(`SELECT id FROM "user" WHERE email = ?`).bind("ada@example.com").first<string>("id");
  expect([...((await unlocksOf(conf, me!)).get("alien-disc-golf")?.keys() ?? [])].sort()).toEqual(["ace", "birdie"]);

  expect((await handle(new Request(`${ORIGIN}/api/account/delete`, { method: "POST", headers: { authorization: `Bearer ${golf.token}` } }), conf))!.status).toBe(200);
  expect((await unlocksOf(conf, me!)).size).toBe(0);
});
