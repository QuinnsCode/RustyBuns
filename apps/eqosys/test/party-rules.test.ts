// A party's rules (#3881): the host sets them from the lobby and the party holds everyone to them at the door and in chat;
// the host takes people out, blocks them (kept out, or let in hidden), and hands the party over; who may mute and report,
// and how long the party lives, are the host's to set too (#3903); with only the host inviting, the door wants the host's link (#3908).
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { newKey } from "@rustybuns/util/token";
import { party, type PartyMember } from "@rustybuns/util/eqosys";
import { defaultRules, readyEnough, type PartyRules } from "@rustybuns/util/party-rules";
import { handle } from "../src/handle.ts";
import { Party } from "../src/qollab/party.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey() });
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());
const base = `http://127.0.0.1:${shell.port}`;

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  return ((await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json()) as { token: string }).token;
}
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A player's page: their party client and what it has heard. */
function player(token: string) {
  const p = party({ url: () => base, token: () => token });
  const heard = { members: [] as PartyMember[], rules: null as PartyRules | null, blocked: [] as { name: string }[], invite: "", gone: "", refused: "", said: [] as string[] };
  p.onMembers((m) => (heard.members = m));
  p.onRules((m) => { heard.rules = m.rules; heard.invite = m.invite ?? ""; if (m.blocked) heard.blocked = m.blocked; });
  p.onGone((w) => (heard.gone = w));
  p.onRefused((w) => (heard.refused = w));
  p.onSay((m) => heard.said.push(`${m.from.name}: ${m.text}`));
  return { p, heard, names: () => heard.members.map((m) => `${m.name}${m.host ? "*" : ""}`).sort().join() };
}

test("the host's rules hold at the door and in chat; block, unblock and a new host", async () => {
  const [adaToken, boToken, cyToken] = (await Promise.all(["Ada7", "Bo7", "Cy7"].map(signUp))) as [string, string, string];
  const ada = player(adaToken), bo = player(boToken), cy = player(cyToken);
  // An open party, minted from this file's own address: the mint limit is per address, and party.test.ts spends "local"'s.
  const code = ((await (await fetch(`${base}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${adaToken}`, "cf-connecting-ip": "203.0.113.7" } })).json()) as { code: string }).code;
  ada.p.join(code);
  await until(() => ada.heard.rules);
  expect(ada.heard.rules).toEqual(defaultRules(true));

  // Two at most, and only the host talks.
  ada.p.rules({ ...ada.heard.rules!, size: 2, chat: "host" });
  await until(() => ada.heard.rules?.size === 2);
  bo.p.join(code);
  await until(() => ada.names() === "Ada7*,Bo7" && bo.heard.rules?.chat === "host");
  const boId = ada.heard.members.find((m) => m.name === "Bo7")!.id;
  cy.p.join(code);
  await until(() => cy.heard.gone);
  expect(cy.heard.gone).toBe("This party is full.");
  bo.p.say("hello?");
  await until(() => bo.heard.refused);
  expect(bo.heard.refused).toBe("only the host talks in this party");
  bo.p.rules({ ...bo.heard.rules!, size: 50 }); // not Bo's to set
  await until(() => bo.heard.refused === "only the host can do that");

  // Blocked: out now, and refused at the door until the host lets them back.
  ada.p.block(boId);
  await until(() => bo.heard.gone && ada.heard.blocked.length === 1);
  expect(ada.heard.blocked.map((b) => b.name)).toEqual(["Bo7"]);
  bo.p.leave(); bo.heard.gone = "";
  bo.p.join(code);
  await until(() => bo.heard.gone);
  expect(bo.heard.gone).toBe("The host has blocked you from this party.");
  ada.p.block(boId, false);
  await until(() => ada.heard.blocked.length === 0);
  bo.p.leave(); bo.heard.gone = "";
  bo.p.join(code);
  await until(() => ada.names() === "Ada7*,Bo7");

  // The party is Bo's now: Bo sees the host's list, and Ada can't change the rules any more.
  ada.p.makeHost(boId);
  await until(() => ada.names() === "Ada7,Bo7*");
  ada.p.rules({ ...ada.heard.rules!, chat: "off" });
  await until(() => ada.heard.refused === "only the host can do that");
  ada.p.leave(); bo.p.leave(); cy.p.leave();
});

test("who may mute and report, a blocked guest let in hidden from the host, and how long the party lives", async () => {
  const [adaToken, boToken, cyToken] = (await Promise.all(["Ada8", "Bo8", "Cy8"].map(signUp))) as [string, string, string];
  const ada = player(adaToken), bo = player(boToken), cy = player(cyToken);
  const code = ((await (await fetch(`${base}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${adaToken}`, "cf-connecting-ip": "203.0.113.8" } })).json()) as { code: string }).code;
  ada.p.join(code);
  await until(() => ada.heard.rules);
  // Anyone may mute for all, and nobody may report.
  ada.p.rules({ ...ada.heard.rules!, mute: "everyone", report: "nobody", block: "hidden" });
  await until(() => ada.heard.rules?.mute === "everyone");
  bo.p.join(code); cy.p.join(code);
  await until(() => ada.names() === "Ada8*,Bo8,Cy8");
  const ids = new Map(ada.heard.members.map((m) => [m.name, m.id])), id = (n: string) => ids.get(n)!;
  bo.p.mute(id("Cy8"));
  bo.p.report(id("Cy8"));
  await until(() => bo.heard.refused);
  expect(bo.heard.refused).toBe("reports are off in this party");
  cy.p.say("am I quiet?");
  bo.p.say("Cy is quiet");
  await until(() => ada.heard.said.length);
  expect(ada.heard.said).toEqual(["Bo8: Cy is quiet"]);

  // Blocked, let in hidden: Cy stays, the host and Cy drop off each other's list and stop hearing each other; Bo sees both.
  ada.p.block(id("Cy8"));
  await until(() => ada.names() === "Ada8*,Bo8" && cy.names() === "Bo8,Cy8");
  expect(bo.names()).toBe("Ada8*,Bo8,Cy8");
  bo.p.mute(id("Cy8"), false);
  bo.p.say("Cy may talk");
  await until(() => bo.heard.said.length === 2); // Bo's own line back: the unmute went first
  cy.p.say("hidden from Ada");
  ada.p.say("hidden from Cy");
  await until(() => bo.heard.said.length === 4 && ada.heard.said.length === 3 && cy.heard.said.length === 3);
  expect(ada.heard.said).toEqual(["Bo8: Cy is quiet", "Bo8: Cy may talk", "Ada8: hidden from Cy"]);
  expect(cy.heard.said).toEqual(["Bo8: Cy is quiet", "Bo8: Cy may talk", "Cy8: hidden from Ada"]);
  // Kept out after all: Cy is closed now.
  ada.p.rules({ ...ada.heard.rules!, block: "out" });
  await until(() => cy.heard.gone);
  expect(cy.heard.gone).toBe("The host has blocked you from this party.");

  // A day's party shortened to an hour is younger than that, so it carries on.
  ada.p.rules({ ...ada.heard.rules!, hours: 1 });
  await until(() => ada.heard.rules?.hours === 1);
  ada.p.say("still here");
  await until(() => bo.heard.said.includes("Ada8: still here"));
  expect(ada.heard.gone).toBe("");
  // Two hours on, the same hour-long rule ends it for everyone.
  const now = Date.now;
  Date.now = () => now() + 2 * 60 * 60 * 1000;
  try {
    ada.p.rules({ ...ada.heard.rules!, size: 15 });
    await until(() => ada.heard.gone && bo.heard.gone);
  } finally { Date.now = now; }
  expect([ada.heard.gone, bo.heard.gone]).toEqual(["The host ended the party.", "The host ended the party."]);
  ada.p.leave(); bo.p.leave(); cy.p.leave();
});

test("only the host invites: a bare code is refused, the host's link gets in, and a new link retires the old one", async () => {
  const [adaToken, boToken, cyToken] = (await Promise.all(["Ada9", "Bo9", "Cy9"].map(signUp))) as [string, string, string];
  const ada = player(adaToken), bo = player(boToken), cy = player(cyToken);
  const code = ((await (await fetch(`${base}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${adaToken}`, "cf-connecting-ip": "203.0.113.9" } })).json()) as { code: string }).code;
  ada.p.join(code);
  await until(() => ada.heard.invite);
  const anyone = ada.heard.invite;
  // Turning inviting to the host's mints a fresh key: links anyone else handed out stop working.
  ada.p.rules({ ...ada.heard.rules!, invite: "host" });
  await until(() => ada.heard.rules?.invite === "host");
  const first = ada.heard.invite;
  expect(first).not.toBe(anyone);
  for (const key of [undefined, anyone]) {
    bo.heard.gone = "";
    bo.p.join(code, key);
    await until(() => bo.heard.gone);
    expect(bo.heard.gone).toBe("Only the host can invite people to this party: ask them for a fresh link.");
    bo.p.leave();
  }
  bo.p.join(code, first);
  await until(() => ada.names() === "Ada9*,Bo9");
  expect(bo.heard.invite).toBe(""); // not Bo's to hand out
  // In once, Bo comes back on the bare code (a reload, a game that dropped the key from its address).
  bo.p.leave();
  await until(() => ada.names() === "Ada9*");
  bo.p.join(code);
  await until(() => ada.names() === "Ada9*,Bo9");

  // A new link: the old one no longer lets anyone in, the new one does.
  ada.p.relink();
  await until(() => ada.heard.invite !== first);
  cy.p.join(code, first);
  await until(() => cy.heard.gone);
  cy.p.leave();
  cy.p.join(code, ada.heard.invite);
  await until(() => ada.names() === "Ada9*,Bo9,Cy9");
  ada.p.leave(); bo.p.leave(); cy.p.leave();
});

test("start needs: everyone, most, or just the host", () => {
  expect([readyEnough("everyone", 3, 2), readyEnough("everyone", 3, 3)]).toEqual([false, true]);
  expect([readyEnough("majority", 3, 1), readyEnough("majority", 3, 2), readyEnough("majority", 0, 0)]).toEqual([false, true, true]);
  expect(readyEnough("host", 5, 0)).toBe(true);
});
