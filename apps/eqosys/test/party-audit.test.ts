// What a party member must not be able to do to the others (notes/SECURITY_AUDIT.md round 18c): a blocked or muted
// person reaching the rest through voice, mute or report, and a party past its lifetime still carrying their words.
import { afterAll, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { jwksOf, newKey, peek, verify } from "@rustybuns/util/token";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import type { PartyRules } from "@rustybuns/util/party-rules";
import { handle } from "../src/handle.ts";
import { Party } from "../src/qollab/party.ts";
import { asks, boot, codeIn, ORIGIN, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
/** Qlave, as far as eqosys can tell. */
const orders: { t: string; sub?: string; room?: string; prefix?: string }[] = [];
const qlave = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!await verify(token, await jwksOf(conf), { iss: ORIGIN, aud: "qlave-admin" })) return new Response("Unauthorized", { status: 401 });
  orders.push(await req.json() as never);
  return Response.json({ ok: true });
} });
conf.QLAVE_URL = `http://127.0.0.1:${qlave.port}`;
afterAll(() => { setSystemTime(); shell.stop(); qlave.stop(true); });
const base = `http://127.0.0.1:${shell.port}`;
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

async function player(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const token = ((await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json()) as { token: string }).token;
  const p = party({ url: () => base, token: () => token });
  const heard = { members: [] as PartyMember[], rules: null as PartyRules | null, gone: "", refused: "", said: [] as string[], tickets: 0, reported: [] as string[], started: false };
  p.onMembers((m) => (heard.members = m));
  p.onRules((m) => (heard.rules = m.rules));
  p.onGone((w) => (heard.gone = w));
  p.onRefused((w) => (heard.refused = w));
  p.onSay((m) => heard.said.push(`${m.from.name}: ${m.text}`));
  p.onTicket(() => heard.tickets++);
  p.onReported((m) => heard.reported.push(m.by));
  p.onStart(() => (heard.started = true));
  return { p, heard, token, id: peek(token)!.sub };
}
type Player = Awaited<ReturnType<typeof player>>;

/** A party of the first player's, with everyone in it. */
async function lobby(ip: string, ...all: Player[]) {
  const host = all[0]!;
  const { code } = (await (await fetch(`${base}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "cf-connecting-ip": ip } })).json()) as { code: string };
  for (const x of all) { x.p.join(code); await until(() => x.heard.rules); }
  await until(() => host.heard.members.length === all.length);
  return code;
}

test("someone blocked and let in hidden is out of voice, and can't mute, report or stall the host", async () => {
  const ada = await player("AdaH"), bo = await player("BoH"), cy = await player("CyH");
  await lobby("203.0.113.21", ada, bo, cy);
  ada.p.rules({ ...ada.heard.rules!, block: "hidden", mute: "everyone" });
  await until(() => bo.heard.rules?.block === "hidden");
  bo.p.talk();
  await until(() => bo.heard.tickets === 1);
  orders.length = 0;

  ada.p.block(bo.id);
  await until(() => orders.some((o) => o.t === "kick" && o.sub === bo.id));
  bo.p.talk();
  await until(() => bo.heard.refused);
  expect(bo.heard.tickets).toBe(1);

  bo.heard.refused = "";
  orders.length = 0;
  bo.p.mute(ada.id);
  bo.p.report(ada.id);
  await until(() => bo.heard.refused === "no such member");
  cy.p.ready(true);
  await until(() => cy.heard.members.find((m) => m.id === cy.id)?.ready);
  ada.p.start();
  await until(() => ada.heard.started);
  expect({ muted: orders.filter((o) => o.t === "mute"), reported: ada.heard.reported }).toEqual({ muted: [], reported: [] });
  for (const x of [ada, bo, cy]) x.p.leave();
});

test("a muted member can't unmute themself, narrowing who talks ends voice, and an expired party goes quiet", async () => {
  const ada = await player("AdaM"), bo = await player("BoM"), cy = await player("CyM");
  await lobby("203.0.113.22", ada, bo, cy);
  ada.p.rules({ ...ada.heard.rules!, mute: "everyone" });
  await until(() => cy.heard.rules?.mute === "everyone");
  cy.p.mute(bo.id);
  cy.p.say("done"); // a socket's frames are handled in order: heard means the mute landed
  await until(() => bo.heard.said.includes("CyM: done"));
  bo.p.mute(bo.id, false);
  await until(() => bo.heard.refused === "you can't mute or unmute yourself");
  bo.p.say("still muted");
  bo.p.ready(true);
  await until(() => bo.heard.members.find((m) => m.id === bo.id)?.ready);
  expect(ada.heard.said).toEqual(["CyM: done"]);

  cy.p.talk();
  await until(() => cy.heard.tickets === 1);
  orders.length = 0;
  ada.p.rules({ ...ada.heard.rules!, chat: "host" });
  await until(() => orders.some((o) => o.t === "end" && o.prefix?.startsWith("party:")));

  setSystemTime(new Date(Date.now() + 25 * 60 * 60 * 1000));
  ada.p.say("after hours");
  await until(() => ada.heard.gone && bo.heard.gone && cy.heard.gone);
  setSystemTime();
  expect(cy.heard.said).not.toContain("AdaM: after hours");
  for (const x of [ada, bo, cy]) x.p.leave();
});
