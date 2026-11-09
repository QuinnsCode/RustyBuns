// The home's side panel and the /spaces page, walked: Ada and Bo share a space and sit in one party (Bo ready). Ada's home
// shows the party's room code and who is ready, then her space with Bo on in it, desktop to phone, never wider than the
// window. Its link opens /spaces on that space in the same panel a game mounts, on a token for eqosys's own pages, which
// no other site and no other Qollab door takes. eqosys runs in-process with its Party and Space objects and serves the pages.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { space } from "@rustybuns/util/eqosys";
import type { SpacesState } from "@rustybuns/util/spaces";
import { newKey } from "@rustybuns/util/token";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { Home, SpacesPage } from "../src/app/pages.tsx";
import { handle } from "../src/handle.ts";
import { Party } from "../src/qollab/party.ts";
import { sideOf } from "../src/qollab/side.ts";
import { Space } from "../src/qollab/space.ts";
import { asks, boot, codeIn, PARK, PASSWORD } from "./kit.ts";

setDefaultTimeout(120_000);

const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/app/commands.client.ts")], target: "browser" });
const script = await built.outputs[0]!.text();
const { conf, call } = await boot({ EQOSYS_SIGNING_KEY: await newKey(), LOOPBACK_RETURNS: "1" });
conf.PARTY = durableObject(Party as never, conf) as never;
conf.SPACE = durableObject(Space as never, conf) as never;

let ada = { id: "", token: "", cookie: "" };
const me = () => ({ id: ada.id, email: "ada@example.com", name: "Ada" });
const html = (body: React.ReactNode) => new Response("<!doctype html>" + renderToStaticMarkup(<Document>{body}</Document>), { headers: { "content-type": "text/html" } });
const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
shell.mount({ fetch: async (req: Request) => {
  const path = new URL(req.url).pathname;
  // The home as the worker renders it (worker.tsx), with the side panel read the way it reads it.
  if (path === "/") return html(<Home counts={new Map()} t0={0} me={me()} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="library" side={await sideOf(conf, ada.id)} />);
  if (path === "/spaces") return html(<SpacesPage t0={0} />);
  if (path === "/src/app/commands.client.ts") return new Response(script, { headers: { "content-type": "text/javascript" } });
  if (path.startsWith("/cards/")) return new Response("", { status: 404 });
  return (await handle(req, conf)) ?? new Response("no", { status: 404 });
} } as never, {});
const base = `http://127.0.0.1:${shell.port}`;

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); shell.stop(); });

async function signUp(name: string) {
  const a = await asks("park-hide-seek", PARK);
  const up = await call("/do/signup", { form: { ...a.form, name, email: `${name.toLowerCase()}@example.com`, password: PASSWORD } });
  const got = await (await call("/api/exchange", { json: { app: "park-hide-seek", code: codeIn(up.to), verifier: a.verifier } })).res.json() as { token: string; user: { id: string } };
  return { id: got.user.id, token: got.token, cookie: up.cookie };
}
const until = async (what: string, f: () => Promise<unknown> | unknown, ms = 10_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await f()) return;
  throw new Error(`never saw ${what}`);
};
/** A step that names itself when it doesn't finish, so a hang says where. */
const step = <T,>(what: string, p: Promise<T>, ms = 15_000) => Promise.race([p, Bun.sleep(ms).then(() => { throw new Error(`stuck: ${what}`); })]);
const opened = (ws: WebSocket, what: string) => step(what, new Promise((ok, no) => { ws.onopen = ok; ws.onclose = (e) => no(new Error(`${what} closed ${e.code} ${e.reason}`)); }));
const sock = (path: string, token: string, origin: string) => new WebSocket(`ws://127.0.0.1:${shell.port}${path}`, { headers: { origin }, protocols: ["eqosys", token] } as never);

test("the home shows your party and your spaces beside your friends, and a space opens on /spaces", async () => {
  ada = await signUp("Ada");
  const bo = await signUp("Bo");

  // A space they share, with Bo in it now.
  const made = await (await step("making the space", fetch(`${base}/q/space`, { method: "POST", headers: { authorization: `Bearer ${ada.token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "game-night" }) }))).json() as { id: string; invite: string };
  expect((await space({ url: () => base, token: () => bo.token }).join(made.invite))?.name).toBe("game-night");
  const boInSpace = sock(`/q/space/${made.id}`, bo.token, PARK);
  // A party both sit in, Bo ready.
  const { code } = await (await fetch(`${base}/q/party?open=1`, { method: "POST", headers: { authorization: `Bearer ${ada.token}` } })).json() as { code: string };
  const adaInParty = sock(`/q/party/${code}`, ada.token, PARK), boInParty = sock(`/q/party/${code}`, bo.token, PARK);
  await opened(adaInParty, "Ada's party socket");
  await opened(boInParty, "Bo's party socket");
  boInParty.send(JSON.stringify({ t: "ready", ready: true }));
  await until("the side panel's party and space", async () => {
    const s = await sideOf(conf, ada.id);
    return s.party?.members.some((m) => m.name === "Bo" && m.ready) && s.spaces[0]?.on === 1;
  });
  // Bo's own home sees the same party; someone who never sat in it sees none.
  expect((await sideOf(conf, bo.id)).party?.code).toBe(code);

  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    await step(`the home at ${w}`, load(chrome.cdp, tab, `${base}/`, 300), 25_000);
    const side = await tab.eval<{ party: string; ready: string; spaces: string[]; wide: number }>(`({
      party: document.querySelector('[aria-label="Your party"] .code')?.textContent,
      ready: document.querySelector('[aria-label="Your party"] small')?.textContent,
      spaces: [...document.querySelectorAll('[aria-label="Your spaces"] li a')].map((a) => a.textContent + " " + a.getAttribute("href")),
      wide: document.documentElement.scrollWidth,
    })`);
    expect(side).toEqual({ party: code, ready: "Park Hide Seek. 1 of 2 ready.", spaces: [`game-night1 on /spaces?open=${made.id}`], wide: w });
    await tab.close();
  }

  // The space's link: /spaces, signed in, opens it in the shared panel with Bo online.
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await tab.call("Network.setCookies", { cookies: ada.cookie.split("; ").map((c) => ({ name: c.slice(0, c.indexOf("=")), value: c.slice(c.indexOf("=") + 1), url: base })) });
  await step("/spaces", load(chrome.cdp, tab, `${base}/spaces?open=${made.id}`, 0), 25_000);
  const state = () => tab.eval<SpacesState | null>("window.__spaces?.state() ?? null").catch(() => null);
  try { await until("game-night open with Bo on", async () => { const s = await state(); return s?.open === "game-night" && [...s.online].sort().join() === "Ada,Bo"; }); }
  catch (e) { throw new Error(`${(e as Error).message}: ${JSON.stringify(await state())} ${tab.noise.join(" | ")}`); }
  expect(await tab.eval<number>("document.documentElement.scrollWidth")).toBe(390);
  await tab.close();

  // That token is eqosys's own: another site can't mint one or open a space with it, and the party and hub doors don't take it.
  const home = await (await call("/api/home-token", { cookie: ada.cookie })).res.json() as { token: string };
  expect((await call("/api/home-token", { cookie: ada.cookie, origin: PARK })).res.status).toBe(403);
  expect((await call("/q/space", { bearer: home.token })).res.status).toBe(200);
  const elsewhere = await fetch(`${base}/q/space/${made.id}?token=${home.token}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", origin: PARK } });
  expect(elsewhere.status).toBe(403);
  expect((await fetch(`${base}/q/party`, { method: "POST", headers: { authorization: `Bearer ${home.token}` } })).status).toBe(401);
  for (const s of [boInSpace, adaInParty, boInParty]) s.close();
});
