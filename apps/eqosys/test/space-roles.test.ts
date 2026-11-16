// Roles and private channels in a space (#4380), the way a small team uses one: the owner makes Bo an admin and Dee a guest,
// Bo adds a private channel only the people they let in see, a message there reaches them and nobody else, a guest has #general
// and no voice, an admin can't hand out roles or take out another admin, and a studio's space keeps the studio's roles.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space, type SpaceInfo } from "@rustybuns/util/eqosys";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { Space } from "../src/qollab/space.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.SPACE = durableObject(Space as never, conf) as never;
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
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A member's page: what the space last told it, what it heard, and what it was refused. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: string[] = [], refused: string[] = [];
  let info: SpaceInfo | null = null;
  const open = (id: string) => c.open(id, { space: (s) => (info = s), said: (ch, m) => heard.push(`#${ch} ${m.text}`), refused: (w) => refused.push(w) });
  return { c, open, heard, refused, info: () => info, channels: () => info?.channels.join() ?? "" };
}

test("an owner hands out admin and guest, an admin keeps a private channel for the people they let in", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo"), cy = await signUp("Cy"), dee = await signUp("Dee");
  const a = member(ada.token), b = member(bo.token), c = member(cy.token), d = member(dee.token);
  const made = (await a.c.make("Crew"))!;
  for (const m of [b, c, d]) expect((await m.c.join(made.invite))?.id).toBe(made.id);
  for (const m of [a, b, c, d]) m.open(made.id);
  await until(() => [a, b, c, d].every((m) => m.info()?.role));
  expect(a.info()!.role).toBe("owner");

  // Ada makes Bo an admin and Dee a guest: their open pages come back with the new role by themselves.
  a.c.role(bo.id, "admin"); a.c.role(dee.id, "guest");
  await until(() => b.info()?.role === "admin" && b.info()!.owner && d.info()?.role === "guest");
  expect((await b.c.mine())?.[0]?.invite).toBe(made.invite);

  // Bo adds a voice room, a public channel and a private one. Cy sees the public ones; Dee, a guest, has #general and no voice.
  b.c.channel("lounge", true); b.c.channel("random"); b.c.privateChannel("leads");
  await until(() => b.channels() === "general,random,leads" && c.channels() === "general,random" && c.info()!.voice.length === 1);
  expect(b.info()!.private).toEqual(["leads"]);
  expect(d.channels()).toBe("general");
  expect(d.info()!.voice).toEqual([]);
  d.c.say("random", "hi");
  await until(() => d.refused.includes("no channel #random"));

  // Bo lets Cy into #leads: Cy sees it, and a word there reaches Ada, Bo and Cy, never Dee.
  b.c.allow("leads", cy.id);
  await until(() => c.channels() === "general,random,leads" && b.info()!.allowed?.[0]?.ids.includes(cy.id));
  b.c.say("leads", "plans");
  b.c.say("general", "lunch");
  await until(() => d.heard.includes("#general lunch") && c.heard.includes("#leads plans") && a.heard.includes("#leads plans"));
  expect(d.heard).not.toContain("#leads plans");

  // Kept out again, Cy loses it. Bo is an admin, not the owner: no roles to hand out, and no kicking Ada.
  b.c.allow("leads", cy.id, false);
  await until(() => c.channels() === "general,random");
  b.c.role(cy.id, "admin");
  await until(() => b.refused.includes("only the space's owner hands out roles"));
  b.c.mute(ada.id);
  await until(() => b.refused.includes("only an owner mutes an owner or an admin"));
  for (const m of [a, b, c, d]) m.c.close();
});

test("a studio's space takes its roles from the studio, not from the role button", async () => {
  const eve = await signUp("Eve"), fin = await signUp("Fin");
  const tool = async (name: string, args: unknown, cookie?: string, bearer?: string) =>
    (await (await call(`/api/tools/${name}`, { json: args, ...(cookie ? { cookie } : {}), ...(bearer ? { bearer } : {}) })).res.json()) as { result?: { id?: string } };
  const studio = (await tool("eq_studio_make", { name: "Acme", kind: "team" }, undefined, eve.token)).result!.id!;
  await tool("eq_studio_add", { studio, email: "fin@example.com", role: "maker" }, eve.cookie);
  const e = member(eve.token), f = member(fin.token);
  const made = (await e.c.makeForStudio(studio, "Acme"))!;
  e.open(made.id); f.open(made.id);
  await until(() => e.info()?.role === "owner" && f.info()?.role === "member");
  e.c.role(fin.id, "guest");
  await until(() => e.refused.includes("a studio's space takes its roles from the studio: change them on the Studio tab"));
  e.c.close(); f.c.close();
});
