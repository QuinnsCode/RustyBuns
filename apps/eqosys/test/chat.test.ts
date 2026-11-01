// Party chat: a party is friends-only unless opened; a muted member reaches nobody; a burst past five is dropped; a report reaches the host and files an issue.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { party } from "@rustybuns/util/eqosys";
import { newKey } from "@rustybuns/util/token";
import { handle } from "../src/handle.ts";
import { Hub } from "../src/hub.ts";
import { Party } from "../src/party.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(30_000);

const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), GITHUB_REPORT_TOKEN: "test" });
conf.HUB = durableObject(Hub as never, conf) as never;
conf.PARTY = durableObject(Party as never, conf) as never;
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => (await handle(req, conf)) ?? new Response("no", { status: 404 }) } as never, {});
afterAll(() => shell.stop());
const base = `http://127.0.0.1:${shell.port}`;

// GitHub is a stub: the report path files one issue.
const filed: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) =>
  String(url).startsWith("https://api.github.com/") ? (filed.push(String(init?.body)), Response.json({ number: 4242 })) : realFetch(url, init)) as typeof fetch;
afterAll(() => { globalThis.fetch = realFetch; });

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const email = `${name.toLowerCase()}@example.com`;
  const up = await call("/do/signup", { form: { ...a.form, name, email, password: PASSWORD } });
  const who = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json() as { user: { id: string }; token: string };
  return { name, email, id: who.user.id, token: who.token };
}
type Person = Awaited<ReturnType<typeof signUp>>;
const hub = async (p: Person, json: unknown) => (await call("/api/hub", { json, bearer: p.token, origin: PARK })).res.status;
const until = async (f: () => unknown) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
const mint = async (p: Person, ip: string, open = false) =>
  ((await (await fetch(`${base}/q/party${open ? "?open=1" : ""}`, { method: "POST", headers: { authorization: `Bearer ${p.token}`, "cf-connecting-ip": ip } })).json()) as { code: string }).code;

function seat(p: Person, code: string) {
  const c = party({ url: () => base, token: () => p.token });
  const heard: string[] = [], reported: string[] = [], refused: string[] = [];
  let gone = "";
  c.onSay((m) => heard.push(`${m.from.name}: ${m.text}`));
  c.onReported((m) => reported.push(`${m.by} -> ${m.name}`));
  c.onRefused((w) => refused.push(w));
  c.onGone((w) => (gone = w));
  c.join(code);
  return { c, heard, reported, refused, gone: () => gone };
}

test("friends only: a stranger is refused, a friend is in; an open party takes anyone", async () => {
  const ada = await signUp("Ada"), bo = await signUp("Bo"), cy = await signUp("Cy");
  await hub(bo, { op: "befriend", email: ada.email });
  await hub(ada, { op: "accept", id: bo.id });
  const code = await mint(ada, "10.0.0.1");

  const stranger = seat(cy, code);
  await until(() => stranger.gone());
  const friend = seat(bo, code);
  const host = seat(ada, code);
  friend.c.say("hi");
  await until(() => host.heard.includes("Bo: hi"));
  expect(stranger.heard).toEqual([]);

  const open = await mint(ada, "10.0.0.1", true);
  const guest = seat(cy, open);
  const hostOpen = seat(ada, open);
  guest.c.say("hello all");
  await until(() => hostOpen.heard.includes("Cy: hello all"));
  host.c.leave(); friend.c.leave(); guest.c.leave(); hostOpen.c.leave();
});

test("a muted member reaches nobody, the sixth message in a burst is dropped, a report reaches the host and files an issue", async () => {
  const ada = await signUp("Ada2"), bo = await signUp("Bo2");
  const code = await mint(ada, "10.0.0.2", true);
  const host = seat(ada, code), guest = seat(bo, code);
  await Bun.sleep(500); // both sockets open

  for (let i = 1; i <= 6; i++) guest.c.say(`m${i}`);
  await until(() => host.heard.length >= 5);
  await Bun.sleep(150);
  expect(host.heard).toEqual(["m1", "m2", "m3", "m4", "m5"].map((m) => `Bo2: ${m}`));

  guest.c.say("x".repeat(281)); // over the cap: nothing
  host.c.mute(bo.id);
  await Bun.sleep(100);
  const before = host.heard.length;
  await Bun.sleep(2600); // let the bucket refill
  guest.c.say("still here?");
  await Bun.sleep(300);
  expect(host.heard.length).toBe(before);

  host.c.mute(bo.id, false);
  await Bun.sleep(100);
  guest.c.say("thanks");
  await until(() => host.heard.includes("Bo2: thanks"));

  guest.c.report(ada.id);
  await until(() => host.reported.length === 1 && filed.length === 1);
  expect(host.reported[0]).toBe("Bo2 -> Ada2");
  host.c.leave(); guest.c.leave();
});
