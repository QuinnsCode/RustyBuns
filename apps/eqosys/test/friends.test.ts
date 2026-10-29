// The friends page on /: signed in by cookie, no token. Bo asks for Ada from the page, she sees it in her game, says yes
// from her own page, and both sides' hubs agree; then a request withdrawn, a decline, and notifications cleared.
import { expect, setDefaultTimeout, test } from "bun:test";
import { durableObject } from "@rustybuns/shell-bun";
import { atHome } from "../src/handle.ts";
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
  expect((await call("/do/befriend", { form: { email: " ADA@example.com " }, cookie: bo.cookie })).to).toBe("/");
  expect((await page(bo)).outgoing.map((p) => p.name)).toEqual(["Ada"]);
  expect((await inApp(ada, PARK)).incoming.map((p) => p.name)).toEqual(["Bo"]);
  const hers = await page(ada);
  expect(hers.incoming.map((p) => p.name)).toEqual(["Bo"]);
  expect(hers.notes[0]).toMatchObject({ kind: "ask", from: { name: "Bo" } });

  // She accepts from her page: friends both ways, and Bo's game sees her.
  expect((await call("/do/accept", { form: { id: bo.me.id }, cookie: ada.cookie })).to).toBe("/");
  expect((await page(ada)).friends.map((f) => f.name)).toEqual(["Bo"]);
  expect((await inApp(bo, QCRM)).friends.map((f) => f.name)).toEqual(["Ada"]);
  expect((await page(bo)).notes[0]).toMatchObject({ kind: "accept", from: { name: "Ada" } });

  // Accepting someone who never asked is an error the page can show; so is an unknown email, quietly, to nobody's loss.
  expect((await call("/do/accept", { form: { id: cy.me.id }, cookie: ada.cookie })).to).toBe("/?e=hub");
  expect((await call("/do/befriend", { form: { email: "nobody@example.com" }, cookie: ada.cookie })).to).toBe("/");

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
  expect((await call("/do/clear", { form: {}, cookie: ada.cookie })).to).toBe("/");
  const after = await page(ada);
  expect(after.notes).toEqual([]);
  expect(after.friends.map((f) => f.name)).toEqual(["Bo"]);
});
