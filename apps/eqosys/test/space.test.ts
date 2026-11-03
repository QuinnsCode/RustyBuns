// Spaces: one person makes a space, a friend joins by invite from another app, they talk in #general, the owner adds a
// channel, history comes back on a fresh socket, a kicked member is out, and deleting the owner deletes the space.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space, type SpaceMessage } from "@rustybuns/util/eqosys";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { Space } from "../src/space.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.SPACE = durableObject(Space as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());
const base = `http://127.0.0.1:${shell.port}`;

async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string }; token: string };
  return { id: who.user.id, token: who.token };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A member's page: what it has heard, kept by channel. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: Record<string, string[]> = {}, refused: string[] = [];
  let channels: string[] = [], online: string[] = [], gone = "", history: SpaceMessage[] = [], more = false;
  const open = (id: string) => c.open(id, {
    space: (s) => (channels = s.channels),
    online: (m) => (online = m.map((x) => x.name).sort()),
    said: (ch, m) => (heard[ch] ??= []).push(`${m.from.name}: ${m.text}`),
    history: (_, m, mo) => { history = m; more = mo; },
    refused: (w) => refused.push(w),
    gone: (w) => (gone = w),
  });
  return { c, open, heard, refused, channels: () => channels, online: () => online, gone: () => gone, history: () => history, more: () => more };
}

test("make, invite, talk, add a channel, read history, kick; a member from another app is in too", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK), bo = await signUp("Bo", "qcrm", QCRM);
  const a = member(ada.token), b = member(bo.token);

  const made = (await a.c.make("Night owls"))!;
  expect(made.invite).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ]{6}$/);
  expect(await b.c.join("WRONG1")).toBeNull();
  expect(await b.c.join(made.invite.toLowerCase())).toEqual({ id: made.id, name: "Night owls" });
  expect(await a.c.mine()).toEqual([{ id: made.id, name: "Night owls", owner: true, invite: made.invite }]);
  expect(await b.c.mine()).toEqual([{ id: made.id, name: "Night owls", owner: false }]);

  a.open(made.id); b.open(made.id);
  await until(() => a.online().join() === "Ada,Bo" && b.channels().join() === "general");
  b.c.say("general", "evening");
  await until(() => a.heard.general?.includes("Bo: evening"));

  b.c.channel("games"); // not Bo's to add
  await until(() => b.refused.length === 1);
  a.c.channel("games");
  await until(() => b.channels().join() === "general,games");
  a.c.say("games", "party at nine");
  await until(() => b.heard.games?.includes("Ada: party at nine"));
  expect(a.heard.general).toEqual(["Bo: evening"]);

  // A fresh socket reads back what was said, oldest first, a page at a time.
  // Sixty lines: each tab has its own burst of five, so twelve tabs say them without waiting out the rate.
  for (let tab = 0; tab < 12; tab++) {
    const t = member(ada.token);
    t.open(made.id);
    await until(() => t.channels().length);
    for (let i = 1; i <= 5; i++) t.c.say("general", `n${tab * 5 + i}`);
    await until(() => b.heard.general?.length === 1 + (tab + 1) * 5);
    t.c.close();
  }
  const later = member(bo.token);
  later.open(made.id);
  later.c.history("general");
  await until(() => later.history().length === 50);
  expect(later.history().at(-1)!.text).toBe("n60");
  expect(later.more()).toBe(true);
  later.c.history("general", later.history()[0]!.id);
  await until(() => later.history()[0]?.text === "evening");
  expect(later.history().length).toBe(11);
  expect(later.more()).toBe(false);
  later.c.close();

  a.c.kick(bo.id);
  await until(() => b.gone() === "removed from the space");
  expect(await b.c.mine()).toEqual([]);
  b.open(made.id);
  await until(() => b.gone() === "Not a space you're in.");
  a.c.close();
});

test("deleting the owner's account deletes their space for everyone", async () => {
  const ada = await signUp("Ada2", "park-hide-seek", PARK), bo = await signUp("Bo2", "park-hide-seek", PARK);
  const a = member(ada.token), b = member(bo.token);
  const made = (await a.c.make("Short lived"))!;
  await b.c.join(made.invite);
  b.open(made.id);
  await until(() => b.online().join() === "Bo2");

  expect(await (await call("/api/account/delete", { json: {}, bearer: ada.token, origin: PARK })).res.json()).toEqual({ ok: true });
  await until(() => b.gone() === "the space was deleted");
  expect(await b.c.mine()).toEqual([]);
});
