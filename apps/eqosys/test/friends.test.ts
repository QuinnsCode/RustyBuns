// The friends page on /: signed in by cookie, no token. Bo asks for Ada from the page, she sees it in her game, says yes
// from her own page, and both sides' hubs agree; then a request withdrawn, a decline, and notifications cleared.
import { expect, setDefaultTimeout, test } from "bun:test";
import { durableObject } from "@rustybuns/shell-bun";
import { atHome } from "../src/handle.ts";
import { countsOf } from "../src/achievements.ts";
import { Hub, hubAsk } from "../src/hub.ts";
import { newKey } from "@rustybuns/util/token";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.HUB = durableObject(Hub as never, conf) as never;

/** Sign up through `app`: the cookie the page uses, the token the app's own pages use, and who they are. */
async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string; email: string }; token: string };
  return { cookie: up.cookie, token: who.token, me: { id: who.user.id, email: who.user.email, name } };
}
/** What the page shows on the way in: the same read worker.tsx does for /. */
const page = async (who: Awaited<ReturnType<typeof signUp>>) => {
  const r = await hubAsk(conf.HUB!, atHome(who.me), { op: "state" });
  if ("error" in r) throw new Error(r.error);
  return r;
};
/** What that person's app sees of the same hub, by token. */
const inApp = async (who: Awaited<ReturnType<typeof signUp>>, origin: string) => {
  const r = await call("/api/hub", { json: { op: "state" }, bearer: who.token, origin });
  const s = await r.res.json() as { friends: { name: string }[]; incoming: { name: string }[] };
  return s;
};

test("the friends page: ask by email, accept, withdraw, decline and clear, all by cookie", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK);
  const bo = await signUp("Bo", "qcrm", QCRM);
  const cy = await signUp("Cy", "qcrm", QCRM);

  // Nobody signed in can't use the forms; a cross-site post is refused.
  expect((await call("/do/befriend", { form: { email: ada.me.email } })).to).toBe("/login?e=in");
  expect((await call("/do/befriend", { form: { email: ada.me.email }, cookie: bo.cookie, origin: "https://evil.example" })).res.status).toBe(403);

  // Bo asks for Ada from his page. His page shows it waiting; her game and her page show the request.
  expect((await call("/do/befriend", { form: { email: " ADA@example.com " }, cookie: bo.cookie })).to).toBe("/?tab=friends");
  expect((await page(bo)).outgoing.map((p) => p.name)).toEqual(["Ada"]);
  expect((await inApp(ada, PARK)).incoming.map((p) => p.name)).toEqual(["Bo"]);
  const hers = await page(ada);
  expect(hers.incoming.map((p) => p.name)).toEqual(["Bo"]);
  expect(hers.notes[0]).toMatchObject({ kind: "ask", from: { name: "Bo" } });

  // She accepts from her page: friends both ways, and Bo's game sees her.
  expect((await call("/do/accept", { form: { id: bo.me.id }, cookie: ada.cookie })).to).toBe("/?tab=friends");
  expect((await page(ada)).friends.map((f) => f.name)).toEqual(["Bo"]);
  expect((await inApp(bo, QCRM)).friends.map((f) => f.name)).toEqual(["Ada"]);
  expect((await page(bo)).notes[0]).toMatchObject({ kind: "accept", from: { name: "Ada" } });

  // Accepting someone who never asked is an error the page can show; so is an unknown email, quietly, to nobody's loss.
  expect((await call("/do/accept", { form: { id: cy.me.id }, cookie: ada.cookie })).to).toBe("/?tab=friends&e=hub");
  expect((await call("/do/befriend", { form: { email: "nobody@example.com" }, cookie: ada.cookie })).to).toBe("/?tab=friends");

  // Ada asks Cy and thinks better of it; Cy asks Bo and Bo says no thanks. Nothing is left waiting anywhere.
  await call("/do/befriend", { form: { email: cy.me.email }, cookie: ada.cookie });
  expect((await page(cy)).incoming.map((p) => p.name)).toEqual(["Ada"]);
  await call("/do/drop", { form: { id: cy.me.id }, cookie: ada.cookie });
  expect((await page(ada)).outgoing).toEqual([]);
  expect((await page(cy)).incoming).toEqual([]);
  await call("/do/befriend", { form: { email: bo.me.email }, cookie: cy.cookie });
  await call("/do/drop", { form: { id: cy.me.id }, cookie: bo.cookie });
  expect((await page(bo)).incoming).toEqual([]);
  expect((await page(cy)).outgoing).toEqual([]);

  // Clearing notifications leaves friends alone.
  expect((await call("/do/clear", { form: {}, cookie: ada.cookie })).to).toBe("/?tab=friends");
  const after = await page(ada);
  expect(after.notes).toEqual([]);
  expect(after.friends.map((f) => f.name)).toEqual(["Bo"]);
});

test("a friend hears an unlock once, a stranger hears nothing, and the page counts a friend's unlocks", async () => {
  const dee = await signUp("Dee", "park-hide-seek", PARK);
  const eli = await signUp("Eli", "park-hide-seek", PARK);
  const fay = await signUp("Fay", "park-hide-seek", PARK);
  await call("/do/befriend", { form: { email: eli.me.email }, cookie: dee.cookie });
  await call("/do/accept", { form: { id: dee.me.id }, cookie: eli.cookie });

  const unlock = (who: typeof dee, id: string) => call("/q/achieve", { json: { id }, bearer: who.token, origin: PARK });
  await unlock(dee, "first-catch");
  await unlock(dee, "first-catch");
  await unlock(dee, "camped-out");

  const heard = (await page(eli)).notes.filter((n) => n.kind === "app");
  expect(heard.map((n) => n.text).sort()).toEqual(["unlocked Found you", "unlocked Nothing to see"]);
  expect(heard[0]).toMatchObject({ from: { name: "Dee" }, app: "park-hide-seek" });
  expect((await page(fay)).notes.filter((n) => n.kind === "app")).toEqual([]);
  expect((await page(dee)).notes.filter((n) => n.kind === "app")).toEqual([]);

  expect([...(await countsOf(conf, [dee.me.id, eli.me.id])).entries()]).toEqual([[dee.me.id, 2]]);
});
