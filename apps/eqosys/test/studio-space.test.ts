// A studio's own space (#4464), the way a small team meets it: the owner makes it from the studio, everyone in the studio is in
// it with no invite, an admin runs it beside the owner, a long message goes through whole, coworkers see each other online in the
// hub without a friend request, and taking someone out of the studio closes their socket and drops them from everyone's list.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space } from "@rustybuns/util/eqosys";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { Hub, type HubState } from "../src/qollab/hub.ts";
import { Space } from "../src/qollab/space.ts";
import { joinStudio } from "../src/sso.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.SPACE = durableObject(Space as never, conf) as never;
conf.HUB = durableObject(Hub as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());
const base = `http://127.0.0.1:${shell.port}`;

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string }; token: string };
  return { id: who.user.id, token: who.token, cookie: up.cookie, email: `${name.toLowerCase()}@example.com` };
}
const run = async (name: string, args: unknown, who: { cookie?: string; token?: string }) => {
  const { res } = await call(`/api/tools/${name}`, { json: args, ...(who.cookie ? { cookie: who.cookie } : {}), ...(who.token ? { bearer: who.token } : {}) });
  return { status: res.status, body: await res.json() as { result?: { id?: string }; error?: string } };
};
/** Asked in by the studio's owner, and saying yes on their own Studio tab. */
const join = async (studio: string, by: { cookie: string }, who: { cookie: string; email: string }, role: string) => {
  expect((await run("eq_studio_add", { studio, email: who.email, role }, { cookie: by.cookie })).status).toBe(200);
  expect((await run("eq_studio_join", { studio, yes: true }, { cookie: who.cookie })).status).toBe(200);
};
const hubState = async (token: string) => (await (await call("/api/hub", { json: { op: "state" }, bearer: token, origin: PARK })).res.json()) as HubState;
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!await f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A member's page in the space: what it heard, and the cap the space told it. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: string[] = [], refused: string[] = [];
  let channels: string[] = [], max = 0, gone = "", runs = false, role = "", online: string[] = [];
  const open = (id: string) => c.open(id, {
    space: (s) => { channels = s.channels; max = s.max ?? 0; runs = s.owner; role = s.role ?? ""; },
    online: (ms) => (online = ms.map((m) => `${m.name}:${m.role}`).sort()),
    said: (_, m) => heard.push(m.text),
    refused: (w) => refused.push(w),
    gone: (w) => (gone = w),
  });
  return { c, open, heard, refused, channels: () => channels, max: () => max, gone: () => gone, runs: () => runs, role: () => role, online: () => online };
}

test("a studio's space: the studio's members are in, its admins run it, a new role at once, long messages, coworker presence, out with the studio", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo"), cy = await signUp("Cy");
  const studio = (await run("eq_studio_make", { name: "Acme", kind: "team" }, { token: ada.token })).body.result!.id!;
  await join(studio, ada, bo, "maker");
  await join(studio, ada, cy, "admin");

  // A maker can't make it; the owner can, once. Its invite is for those who run it to hand to guests (the test below).
  const a = member(ada.token), b = member(bo.token), c = member(cy.token);
  expect(await b.c.makeForStudio(studio, "Acme")).toBeNull();
  const made = (await a.c.makeForStudio(studio, "Acme"))!;
  expect(await a.c.makeForStudio(studio, "Acme again")).toBeNull();
  expect(await b.c.mine()).toEqual([{ id: made.id, name: "Acme", owner: false, studio }]);
  expect(await c.c.mine()).toEqual([{ id: made.id, name: "Acme", owner: true, invite: expect.any(String), studio }]);

  // Bo and Cy are in with no invite. A long message goes through whole; the space says how long one may be.
  b.open(made.id); c.open(made.id);
  await until(() => b.channels().join() === "general" && c.max() === 2000);
  const long = "ship it ".repeat(150).trim();
  b.c.say("general", long);
  await until(() => c.heard.includes(long));

  // Cy, an admin, runs it: a channel is theirs to add, not Bo's. Bo can't leave the space on its own, and Cy can't kick the owner.
  b.c.channel("standup");
  c.c.channel("standup");
  await until(() => b.channels().join() === "general,standup" && b.refused.length === 1);
  b.c.leave();
  await until(() => b.refused.length === 2);
  c.c.kick(ada.id);
  await until(() => c.refused.includes("only an owner takes out another owner"));

  // Ada makes Cy a maker: Cy's open page reconnects by itself and comes back without an admin's powers.
  expect(c.runs()).toBe(true);
  expect((await run("eq_studio_add", { studio, email: "cy@example.com", role: "maker" }, { cookie: ada.cookie })).status).toBe(200);
  await until(() => !c.runs());
  c.c.channel("cy-only");
  await until(() => c.refused.includes("only the space's owner or an admin can do that"));
  expect(c.gone()).toBe("");

  // Coworkers see each other online with no friend request: Bo has the game open, and Cy's hub says so.
  const tab = new WebSocket(`ws://127.0.0.1:${shell.port}/hub`, { headers: { origin: PARK }, protocols: ["eqosys", bo.token] } as never);
  await until(async () => (await hubState(cy.token)).coworkers?.find((p) => p.id === bo.id)?.presence[0]?.app === "park-hide-seek");
  expect((await hubState(cy.token)).friends).toEqual([]);

  // Out of the studio, out of the space at once, and off Cy's coworkers.
  expect((await run("eq_studio_remove", { studio, email: "bo@example.com" }, { cookie: ada.cookie })).status).toBe(200);
  await until(() => b.gone() === "removed from the studio");
  expect(await b.c.mine()).toEqual([]);
  expect((await hubState(cy.token)).coworkers?.map((p) => p.name)).toEqual(["Ada"]);
  // The last owner stays.
  expect((await run("eq_studio_remove", { studio, email: "ada@example.com" }, { cookie: ada.cookie })).status).toBe(409);
  tab.close(); c.c.close();
});

test("a guest in a studio's space: in by its invite, only #general, no powers, leaves or is kicked without the studio, and joining the studio makes them its own", async () => {
  const ann = await signUp("Ann"), gus = await signUp("Gus"), max = await signUp("Max");
  const studio = (await run("eq_studio_make", { name: "Bolt", kind: "team" }, { token: ann.token })).body.result!.id!;
  const a = member(ann.token), g = member(gus.token), m = member(max.token);
  const made = (await a.c.makeForStudio(studio, "Bolt"))!;
  const invite = (await a.c.mine())!.find((s) => s.id === made.id)!.invite!;
  a.open(made.id);
  await until(() => a.runs());
  a.c.channel("plans");
  await until(() => a.channels().join() === "general,plans");

  // Gus, outside the studio, comes in by the invite as a guest: #general only, no powers, and not in the studio.
  expect(await g.c.join(invite)).toEqual({ id: made.id, name: "Bolt" });
  expect(await g.c.mine()).toEqual([{ id: made.id, name: "Bolt", owner: false, studio }]);
  g.open(made.id);
  await until(() => g.role() === "guest" && a.online().join() === "Ann:owner,Gus:guest");
  expect(g.channels()).toEqual(["general"]);
  g.c.channel("gus-only");
  await until(() => g.refused.includes("only the space's owner or an admin can do that"));
  g.c.say("general", "hi from outside");
  await until(() => a.heard.includes("hi from outside"));
  expect((await hubState(ann.token)).coworkers ?? []).toEqual([]);

  // A guest can leave it on their own (the studio's people can't), and is out of the list.
  g.c.leave();
  await until(() => g.gone() !== "" && a.online().join() === "Ann:owner");
  expect(await g.c.mine()).toEqual([]);

  // Kicked, a guest is out of the space and the studio is untouched; the old invite stops working.
  expect(await m.c.join(invite)).not.toBeNull();
  m.open(made.id);
  await until(() => m.role() === "guest");
  a.c.kick(max.id);
  await until(() => m.gone() === "removed from the space");
  expect(await m.c.mine()).toEqual([]);
  expect(await m.c.join(invite)).toBeNull();

  // A guest who joins the studio sits there as the studio's from then on, and leaving the studio takes them out of the space.
  const fresh = (await a.c.mine())!.find((s) => s.id === made.id)!.invite!;
  expect(await g.c.join(fresh)).not.toBeNull();
  await join(studio, ann, gus, "maker");
  g.open(made.id);
  await until(() => g.role() === "member" && g.channels().join() === "general,plans");
  expect((await run("eq_studio_remove", { studio, email: "gus@example.com" }, { cookie: ann.cookie })).status).toBe(200);
  await until(() => g.gone() === "removed from the studio");
  expect(await g.c.mine()).toEqual([]);
  // One of the studio's own joining by the invite gets no guest row.
  const now = (await a.c.mine())!.find((s) => s.id === made.id)!.invite!;
  expect(await a.c.join(now)).toEqual({ id: made.id, name: "Bolt" });
  a.c.close();
});

test("out of the studio leaves no way back into its space: not the invite held, a private channel, or having made it", async () => {
  const dee = await signUp("Dee"), ed = await signUp("Ed"), fay = await signUp("Fay");
  const studio = (await run("eq_studio_make", { name: "Crate", kind: "team" }, { token: dee.token })).body.result!.id!;
  await join(studio, dee, ed, "admin");
  await join(studio, dee, fay, "maker");
  // Ed, an admin, makes the space.
  const d = member(dee.token), e = member(ed.token), f = member(fay.token);
  const made = (await e.c.makeForStudio(studio, "Crate"))!;
  const invite = async () => (await d.c.mine())!.find((s) => s.id === made.id)!.invite!;
  const held = (await e.c.mine())![0]!.invite!;
  d.open(made.id);
  await until(() => d.runs());
  d.c.privateChannel("pay");
  await until(() => d.channels().includes("pay"));
  d.c.allow("pay", fay.id);

  for (const email of ["ed@example.com", "fay@example.com"]) expect((await run("eq_studio_remove", { studio, email }, { cookie: dee.cookie })).status).toBe(200);
  expect(await e.c.join(held)).toBeNull();

  // Back as guests, by an invite handed to them since: no private channel, and a kick takes out even the one who made the space.
  expect(await f.c.join(await invite())).not.toBeNull();
  f.open(made.id);
  await until(() => f.role() === "guest" && f.channels().length > 0);
  expect(f.channels()).toEqual(["general"]);
  expect(await e.c.join(await invite())).not.toBeNull();
  e.open(made.id);
  await until(() => e.role() === "guest");
  d.c.kick(ed.id);
  await until(() => e.gone() === "removed from the space");
  expect(await e.c.mine()).toEqual([]);

  // A guest whose company sign-in seats them in the studio keeps no guest row behind the seat.
  await joinStudio(conf, { studio, role: "maker", sub: "x", email: "fay@example.com", name: "Fay", ask: null }, fay.id);
  expect(await conf.DB.prepare("SELECT 1 AS y FROM space_members WHERE space_id = ? AND user_id = ?").bind(made.id, fay.id).first("y")).toBeNull();
  d.c.close(); f.c.close();
});

test("a studio's game opens the space of the studio that made it, and none of the player's others", async () => {
  const GAME = "https://rocket-golf.example";
  const ida = await signUp("Ida"), a = member(ida.token);
  const studio = (await run("eq_studio_make", { name: "Rocket", kind: "team" }, { cookie: ida.cookie })).body.result!.id!;
  const theirs = (await a.c.makeForStudio(studio, "Rocket"))!, den = (await a.c.make("Ida's den"))!;
  const draft = { studio, id: "rocket-golf", name: "Rocket Golf", genre: "Games", origins: [GAME] };
  expect((await run("eq_listing_save", draft, { cookie: ida.cookie })).status).toBe(200);
  const asked = await asks("rocket-golf", GAME);
  const { to } = await call("/do/signin", { form: { ...asked.form, email: ida.email, password: PASSWORD } });
  const game = (await (await call("/api/exchange", { origin: GAME, json: { app: "rocket-golf", code: codeIn(to), verifier: asked.verifier } })).res.json() as { token: string }).token;

  expect((await member(game).c.mine())!.map((s) => s.name)).toEqual(["Rocket"]);
  const exported = (id: string) => call(`/q/space/${id}/export`, { bearer: game, origin: GAME }).then((r) => r.res.status);
  expect([await exported(theirs.id), await exported(den.id)]).toEqual([200, 404]);
  // Nor the den's files, either way, or its socket (messages and direct messages).
  const file = `/q/space/${den.id}/file`;
  for (const [path, json] of [[`${file}?channel=general&name=a.txt`, {}], [`${file}/${crypto.randomUUID()}`, undefined]] as const) {
    const { res } = await call(path, { json, bearer: game, origin: GAME });
    expect([res.status, await res.json()]).toEqual([404, { error: "not a space you're in" }]);
  }
  const socket = await handle(new Request(`${base}/q/space/${den.id}`, { headers: { upgrade: "websocket", origin: GAME, "sec-websocket-protocol": `eqosys, ${game}` } }), conf);
  expect(socket!.status).toBe(404);
  const invite = (await a.c.mine())!.find((s) => s.id === den.id)!.invite!;
  expect((await call("/q/space/join", { json: { invite }, bearer: game, origin: GAME })).res.status).toBe(404);
  expect((await call("/q/space", { json: { name: "Elsewhere" }, bearer: game, origin: GAME })).res.status).toBe(403);
  // The player's own apps still open every space they are in.
  expect((await a.c.mine())!.map((s) => s.name)).toEqual(["Ida's den", "Rocket"]);
});
