// Qollab for teams (#5543), the way a small office uses a space: two coworkers talk in a direct message nobody else sees (those
// who run the space neither), someone sets a status line, a business studio's space says "meeting", and whoever runs it reads
// the audit log, sets how long messages stay, exports the channels, and takes someone out of every space they run at once.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space, type SpaceAudit, type SpaceInfo, type SpaceMember } from "@rustybuns/util/eqosys";
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

/** A member's page: what the space last told it, what it heard and where, what it was refused, and the rest it was sent. */
function member(token: string) {
  const c = space({ url: () => base, token: () => token });
  const heard: string[] = [], refused: string[] = [], notes: string[] = [];
  let info: SpaceInfo | null = null, online: SpaceMember[] = [], audit: SpaceAudit[] | null = null, dm = "", gone = "";
  const open = (id: string) => c.open(id, {
    space: (s) => (info = s), online: (m) => (online = m), said: (ch, m) => heard.push(`${ch} ${m.text}`), refused: (w) => refused.push(w),
    dm: (ch) => (dm = ch), audit: (e) => (audit = e), note: (t) => notes.push(t), gone: (w) => (gone = w),
  });
  return { c, open, heard, refused, notes, info: () => info, online: () => online, audit: () => audit, dm: () => dm, gone: () => gone };
}

test("a direct message is for its two people only; it goes when one of them leaves; status lines; the audit log, retention and export", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo"), cy = await signUp("Cy");
  const a = member(ada.token), b = member(bo.token), c = member(cy.token);
  const made = (await a.c.make("Office"))!;
  for (const m of [b, c]) await m.c.join(made.invite);
  for (const m of [a, b, c]) m.open(made.id);
  await until(() => [a, b, c].every((m) => m.info()) && a.online().length === 3);

  // Bo messages Cy: both see it in `dms`; Ada, who owns the space, doesn't, and can't read or post in it by its name.
  b.c.dm(cy.id);
  await until(() => b.dm() && c.info()?.dms?.length === 1);
  const dm = b.dm();
  expect(b.info()!.dms).toEqual([{ channel: dm, id: cy.id, name: "Cy" }]);
  expect(c.info()!.dms).toEqual([{ channel: dm, id: bo.id, name: "Bo" }]);
  b.c.say(dm, "lunch?");
  await until(() => c.heard.includes(`${dm} lunch?`));
  a.c.say(dm, "me too");
  a.c.history(dm);
  await until(() => a.refused.includes(`no channel #${dm}`));
  expect(a.heard).not.toContain(`${dm} lunch?`);
  expect(a.info()!.dms).toBeUndefined();
  // Asking again finds the same one.
  c.c.dm(bo.id);
  await until(() => c.dm() === dm);

  // A status line, beside the name in everyone's online list.
  c.c.status("in the Q3 review");
  await until(() => a.online().find((m) => m.id === cy.id)?.status === "in the Q3 review");

  // Ada keeps messages 30 days and deletes a channel; the audit log says so. Bo, a member, gets no log.
  a.c.keep(30);
  await until(() => a.info()?.keep === 30);
  a.c.channel("random"); a.c.drop("random");
  b.c.audit();
  await until(() => b.refused.includes("only the space's owner or an admin can do that"));
  a.c.audit();
  await until(() => a.audit()?.length === 2);
  expect(a.audit()!.map((e) => [e.act, e.by.name, e.to ?? e.channel])).toEqual([["keep", "Ada", "30"], ["drop", "Ada", "random"]]);

  // The export holds #general, never the direct message; only those who run the space get one.
  a.c.say("general", "hello all");
  await until(() => b.heard.includes("general hello all"));
  const file = await a.c.exportSpace(made.id);
  const got = JSON.parse(await file!.text()) as { space: string; channels: Record<string, { text: string }[]> };
  expect([got.space, Object.keys(got.channels), got.channels.general!.map((m) => m.text)]).toEqual(["Office", ["general"], ["hello all"]]);
  expect(await b.c.exportSpace(made.id)).toBeNull();

  // Cy leaves: the direct message goes, for Bo too.
  c.c.leave();
  await until(() => b.info() && !b.info()!.dms);
  for (const m of [a, b]) m.c.close();
});

test("remove everywhere: out of every space the remover runs, by each one's rules, and in each audit log", async () => {
  const dee = await signUp("Dee"), eli = await signUp("Eli"), fox = await signUp("Fox");
  const d = member(dee.token), e = member(eli.token), f = member(fox.token);
  const one = (await d.c.make("One"))!, two = (await d.c.make("Two"))!, theirs = (await f.c.make("Fox's"))!;
  for (const s of [one, two, theirs]) await e.c.join(s.invite);
  d.open(one.id); e.open(one.id);
  await until(() => d.online().length === 2);
  d.c.kick(eli.id, true);
  await until(() => d.notes.length === 1);
  expect(d.notes[0]).toBe("Removed from 2 spaces.");
  // Eli is out of both of Dee's spaces, and still in Fox's, which Dee doesn't run.
  expect((await e.c.mine())!.map((s) => s.name)).toEqual(["Fox's"]);
  d.open(two.id);
  await until(() => d.info()?.name === "Two");
  d.c.audit();
  await until(() => d.audit()?.length === 1);
  expect(d.audit()![0]!.act).toBe("everywhere");
  d.c.close(); e.c.close(); f.c.close();
});

test("a business studio's space speaks office words; a team studio's doesn't", async () => {
  const gus = await signUp("Gus");
  const tool = async (name: string, args: unknown) => (await (await call(`/api/tools/${name}`, { json: args, bearer: gus.token })).res.json()) as { result?: { id?: string } };
  const g = member(gus.token);
  for (const [kind, office] of [["business", true], ["team", undefined]] as const) {
    const studio = (await tool("eq_studio_make", { name: `Gus ${kind}`, kind })).result!.id!;
    const made = (await g.c.makeForStudio(studio, `Gus ${kind}`))!;
    g.open(made.id);
    await until(() => g.info()?.name === `Gus ${kind}`);
    expect(g.info()!.office).toBe(office);
  }
  g.c.close();
});
