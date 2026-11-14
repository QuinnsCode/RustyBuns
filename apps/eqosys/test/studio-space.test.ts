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
  return { id: who.user.id, token: who.token, cookie: up.cookie };
}
const run = async (name: string, args: unknown, who: { cookie?: string; token?: string }) => {
  const { res } = await call(`/api/tools/${name}`, { json: args, ...(who.cookie ? { cookie: who.cookie } : {}), ...(who.token ? { bearer: who.token } : {}) });
  return { status: res.status, body: await res.json() as { result?: { id?: string }; error?: string } };
};
const hubState = async (token: string) => (await (await call("/api/hub", { json: { op: "state" }, bearer: token, origin: PARK })).res.json()) as HubState;
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!await f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A member's page in the space: what it heard, and the cap the space told it. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: string[] = [], refused: string[] = [];
  let channels: string[] = [], max = 0, gone = "", runs = false;
  const open = (id: string) => c.open(id, {
    space: (s) => { channels = s.channels; max = s.max ?? 0; runs = s.owner; },
    said: (_, m) => heard.push(m.text),
    refused: (w) => refused.push(w),
    gone: (w) => (gone = w),
  });
  return { c, open, heard, refused, channels: () => channels, max: () => max, gone: () => gone, runs: () => runs };
}

test("a studio's space: the studio's members are in, its admins run it, a new role at once, long messages, coworker presence, out with the studio", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo"), cy = await signUp("Cy");
  const studio = (await run("eq_studio_make", { name: "Acme", kind: "team" }, { token: ada.token })).body.result!.id!;
  for (const [email, role] of [["bo@example.com", "maker"], ["cy@example.com", "admin"]] as const)
    expect((await run("eq_studio_add", { studio, email, role }, { cookie: ada.cookie })).status).toBe(200);

  // A maker can't make it; the owner can, once, and it has no invite to hand out.
  const a = member(ada.token), b = member(bo.token), c = member(cy.token);
  expect(await b.c.makeForStudio(studio, "Acme")).toBeNull();
  const made = (await a.c.makeForStudio(studio, "Acme"))!;
  expect(await a.c.makeForStudio(studio, "Acme again")).toBeNull();
  expect(await b.c.mine()).toEqual([{ id: made.id, name: "Acme", owner: false, studio }]);
  expect(await c.c.mine()).toEqual([{ id: made.id, name: "Acme", owner: true, studio }]);

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
  await until(() => c.refused.includes("only the space's owner can do that"));
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
