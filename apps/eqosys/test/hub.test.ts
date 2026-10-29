// Two people in two apps become friends, see each other come and go, and one nudges the other into their game,
// through real sockets on the Rusty Buns host and the same Hub class the edge runs.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { Hub, type HubOut, type HubState } from "../src/hub.ts";
import { handle } from "../src/handle.ts";
import { newKey } from "../src/token.ts";
import { asks, boot, codeIn, PARK, PASSWORD, QCRM } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
const hubs = durableObject(Hub as never, conf);
conf.HUB = hubs as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());

/** Sign up through `app` and trade the code in, as the app does: the token is what the hub wants. */
async function signUp(name: string, app: string, origin: string) {
  const a = await asks(app, origin);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app, code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string }; token: string };
  return { id: who.user.id, token: who.token };
}

/** An app's page holding its hub socket: every state it was sent, and the latest. */
function open(token: string, origin: string) {
  const got: HubOut[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/hub?token=${token}`, { headers: { origin } } as never);
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  const state = () => got.filter((m): m is { t: "state" } & HubState => m.t === "state").at(-1);
  return { ws, got, state, say: (m: unknown) => ws.send(JSON.stringify(m)) };
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
const op = async (token: string, body: unknown) => {
  const r = await call("/api/hub", { json: body, bearer: token, origin: QCRM });
  return { status: r.res.status, body: await r.res.json() as HubState & { error?: string } };
};

test("friends across apps: ask, accept, see who is on and where, nudge into a game", async () => {
  const ada = await signUp("Ada", "park-hide-seek", PARK);
  const bo = await signUp("Bo", "qcrm", QCRM);

  // Ada has the game open. Bo, in qCRM, asks for her by email from his server.
  const a = open(ada.token, PARK);
  await until(() => a.state()?.me?.name === "Ada");
  expect((await op(bo.token, { op: "befriend", email: "ADA@example.com" })).body.outgoing.map((p) => p.name)).toEqual(["Ada"]);
  await until(() => a.state()?.incoming.length === 1);
  expect(a.state()!.notes[0]).toMatchObject({ kind: "ask", from: { id: bo.id, name: "Bo" } });

  // She says yes from the game's page, and says what she's doing.
  a.say({ op: "accept", id: bo.id });
  a.say({ op: "status", doing: "hiding in the hedge" });
  await until(() => a.state()?.friends.length === 1);
  const bos = await op(bo.token, { op: "state" });
  expect(bos.body.friends).toMatchObject([{ id: ada.id, name: "Ada", presence: [{ app: "park-hide-seek", doing: "hiding in the hedge" }] }]);
  expect(bos.body.notes[0]).toMatchObject({ kind: "accept", from: { name: "Ada" } });

  // Bo comes online in qCRM; Ada sees it. He nudges her with a link on his app's own site.
  const b = open(bo.token, QCRM);
  await until(() => a.state()?.friends[0]?.presence[0]?.app === "qcrm");
  b.say({ op: "notify", id: ada.id, text: "come look at this deal", link: `${QCRM}/deals/7` });
  await until(() => a.state()?.notes[0]?.kind === "app");
  expect(a.state()!.notes[0]).toMatchObject({ app: "qcrm", text: "come look at this deal", link: `${QCRM}/deals/7`, from: { name: "Bo" } });

  // A link off his app's site, or a nudge to someone who isn't a friend, goes nowhere.
  b.say({ op: "notify", id: ada.id, text: "free prize", link: "https://evil.example/" });
  expect((await op(bo.token, { op: "notify", id: "someone-else", text: "hi" })).status).toBe(400);
  await until(() => b.got.some((m) => m.t === "error"));
  expect(a.state()!.notes.filter((n) => n.kind === "app")).toHaveLength(1);

  // He closes the tab: she sees him go. Her hub sleeping and waking keeps everything.
  b.ws.close();
  await until(() => a.state()?.friends[0]?.presence.length === 0);
  a.ws.close();
  await until(async () => (await op(bo.token, { op: "state" })).body.friends[0]?.presence.length === 0);
  hubs.evict(hubs.idFromName(ada.id));
  const woke = (await op(ada.token, { op: "state" })).body;
  expect(woke.friends).toMatchObject([{ name: "Bo", presence: [] }]);
  expect(woke.notes.map((n) => n.kind)).toEqual(["app", "ask"]);

  // Unfriending is both ways.
  expect((await op(ada.token, { op: "drop", id: bo.id })).body.friends).toEqual([]);
  expect((await op(bo.token, { op: "state" })).body.friends).toEqual([]);
});

test("the hub wants an eqosys token, and a socket from the token's own app", async () => {
  const eve = await signUp("Eve", "park-hide-seek", PARK);
  expect((await call("/api/hub", { json: { op: "state" } })).res.status).toBe(401);
  expect((await call("/api/hub", { json: { op: "state" }, bearer: eve.token.slice(0, -4) + "AAAA" })).res.status).toBe(401);
  // Asking for an email nobody has answers like any other request: no telling whether an account exists.
  expect((await op(eve.token, { op: "befriend", email: "nobody@example.com" })).status).toBe(200);
  // A page on another site can't open her socket with her token.
  const res = await fetch(`http://127.0.0.1:${shell.port}/hub?token=${eve.token}`, {
    headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", origin: "https://evil.example" },
  });
  expect(res.status).toBe(403);
});
