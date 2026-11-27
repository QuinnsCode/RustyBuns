// The listen link (#5878), the way a DJ and a listener meet it: the decks go live on /decks.html, a second tab opens the
// link the decks give, presses Play and hears deck A's track; the DJ brings deck B in on the crossfader and the
// listener hears it and sees it on the track list; the DJ stops and the listener's page says the set is over.
// The real worker and Listen Durable Object run in-process on shell-bun (as on Cloudflare); the pages come from vite.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { durableObject, serve } from "@rustybuns/shell-bun";
import { chromePath, launchChrome, load, openTab, startVite, waitFor, type Tab } from "../../../scripts/chrome.ts";
import worker from "../src/worker.ts";
import Listen, { CLOSE_FULL, CLOSE_NOT_YOURS } from "../src/listen.ts";
import Lobby, { monthOf } from "../src/lobby.ts";

setDefaultTimeout(120_000);
const app = join(import.meta.dir, "..");
const nothing = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("", { status: 404 }) }) };
let vite = "";
const TOKEN = "owner-only";
/** The worker with a Listen namespace (`ears` a set at most), its pages from the dev server; with `limits`, a real Lobby and those free limits. */
function site(ears = "200", limits?: { LISTEN_SET_HOURS: string; FREE_SET_HOURS: string }) {
  const shell = serve<Parameters<typeof worker.fetch>[1]>({ headers: {} });
  const ASSETS = { fetch: (r: Request) => { const u = new URL(r.url); return fetch(`${vite}${u.pathname}${u.search}`, { headers: { accept: r.headers.get("accept") ?? "*/*" } }); } };
  const LOBBY = limits ? durableObject(Lobby, { FREE_SET_HOURS: limits.FREE_SET_HOURS }) : nothing;
  const LISTEN = durableObject(Listen, limits ? { LISTEN_EARS: ears, LISTEN_SET_HOURS: limits.LISTEN_SET_HOURS, LOBBY } : { LISTEN_EARS: ears });
  shell.mount(worker, { ASSETS, WORLD: nothing, LOBBY, PROFILE: nothing, LISTEN, SIGNUPS_TOKEN: TOKEN });
  return shell;
}

test("a listen socket: the DJ's key holds the link, the cap turns a listener away, the DJ leaving ends the set", async () => {
  const shell = site("1");
  const ws = (path: string) => new Promise<{ s: WebSocket; got: string[]; closed: Promise<number> }>((res) => {
    const s = new WebSocket(`${shell.url.replace("http", "ws")}${path}`), got: string[] = [];
    const closed = new Promise<number>((c) => (s.onclose = (e) => c(e.code)));
    s.onmessage = (m) => got.push(typeof m.data === "string" ? m.data : "bytes");
    s.onopen = () => setTimeout(() => res({ s, got, closed }), 30);
  });
  const dj = await ws("/listen/abcdefghij/ws?dj=" + "a".repeat(32));
  const ear = await ws("/listen/abcdefghij/ws");
  expect(JSON.parse(ear.got[0]!)).toMatchObject({ t: "set", live: true });
  // someone else's key, and a second listener past the cap of one
  expect(await (await ws("/listen/abcdefghij/ws?dj=" + "b".repeat(32))).closed).toBe(CLOSE_NOT_YOURS);
  expect(await (await ws("/listen/abcdefghij/ws")).closed).toBe(CLOSE_FULL);
  dj.s.close();
  await ear.closed;
  expect(ear.got.map((m) => m === "bytes" ? m : JSON.parse(m).t)).toContain("end");
  await shell.stop();
});

const hasChrome = !!chromePath();
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let dev: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => {
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  if (!hasChrome) { dev = await startVite(app); vite = dev.url.replace(/\/$/, ""); return; }
  [chrome, dev] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required"]), startVite(app)]);
  vite = dev.url.replace(/\/$/, "");
});
afterAll(() => { chrome?.stop(); dev?.stop(); });

type Heard = { name: string; live: boolean; over: boolean; ears: number; cues: { name: string }[]; bytes: number; playing: boolean; time: number; level: number };

test.skipIf(!hasChrome)("go live on the decks: a second tab opens the link and hears both demo tracks, then the set ends", async () => {
  const shell = site();
  const on = (tab: Tab) => <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (tab: Tab, what: string, expr: string, ms = 30_000) => waitFor(tab, what, expr, ms, "window.qlisten?.state() ?? window.qdecks?.liveState()");
  const decksTab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, decksTab, `${shell.url}/decks.html`, 0);
  const decks = on(decksTab);
  await until(decksTab, "the decks", "!!window.qdecks");
  await decks("qdecks.start()");
  await until(decksTab, "the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  await decks("(qdecks.quantize(false), qdecks.cross(-1), qdecks.play(0))");
  expect(await decks<boolean>(`qdecks.live(true, "Sunday warm-up")`)).toBe(true);
  const link = (await decks<{ link: string; on: boolean }>("qdecks.liveState()"))!;
  expect(link.on).toBe(true);
  expect(link.link).toMatch(/\/listen\/[a-z0-9]{10}$/);
  await Bun.sleep(3000);                                         // the listener comes in late: the set has been on a while

  const earTab = await openTab(chrome.cdp, { w: 420, h: 800 }, true);
  await load(chrome.cdp, earTab, link.link, 0);
  const ear = on(earTab);
  await until(earTab, "the listen page", "!!window.qlisten");
  await ear("qlisten.play()");
  await until(earTab, "deck A heard", "(() => { const s = qlisten.state(); return s.playing && s.level > 0.01; })()");
  let heard = (await ear<Heard>("qlisten.state()"))!;
  expect(heard).toMatchObject({ name: "Sunday warm-up", live: true, over: false });
  expect(heard.cues.map((c) => c.name)).toEqual(["Night drive (124)"]);
  await until(decksTab, "the listener counted", "qdecks.liveState().ears === 1");

  // deck B in on the crossfader, A stopped: the listener still hears music, and B is on the list
  await decks("(qdecks.play(1), qdecks.cross(1), qdecks.play(0))");
  await until(earTab, "deck B on the list", `qlisten.state().cues.some((c) => c.name === "Dune runner (128)")`);
  const t0 = heard.time;
  await Bun.sleep(4000);
  heard = (await ear<Heard>("qlisten.state()"))!;
  expect(heard.time).toBeGreaterThan(t0 + 2);
  await until(earTab, "deck B heard", "qlisten.state().level > 0.01");

  await decks("qdecks.live(false)");
  await until(earTab, "the set over", "qlisten.state().over");
  expect(await decks<boolean>("qdecks.liveState().on")).toBe(false);
  await shell.stop();
});

test.skipIf(!hasChrome)("a free set hits its time: the decks say so, the DJ joins the paid waitlist, and /usage has the set", async () => {
  // a set's length of 0.001 hours (3.6 s) stands in for the 4 hours; the month's allowance stays far off
  const shell = site("16", { LISTEN_SET_HOURS: "0.001", FREE_SET_HOURS: "16" });
  const tab = await openTab(chrome.cdp, { w: 1280, h: 900 });
  await load(chrome.cdp, tab, `${shell.url}/decks.html`, 0);
  const decks = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string) => waitFor(tab, what, expr, 30_000, "window.qdecks?.liveState()");
  await until("the decks", "!!window.qdecks");
  await decks("qdecks.start()");
  await until("the demo tracks on", "qdecks.state().decks.every((d) => d.name)");
  await decks("(qdecks.cross(-1), qdecks.play(0))");
  expect(await decks<boolean>(`qdecks.live(true, "Short one")`)).toBe(true);

  await until("the set ended by its limit", `qdecks.liveState().limit === "hours" && !qdecks.liveState().on`);
  const card = (await decks<string>(`document.querySelector('.waitlist[data-limit="hours"]')?.innerText ?? ""`))!;
  expect(card).toContain("A free set runs up to");
  expect(card).toContain("Paid is coming: join the waitlist");
  await decks(`(() => { const f = document.querySelector(".waitlist form"); f.querySelector("input").value = "dj@example.com"; f.requestSubmit(); })()`);
  await until("on the waitlist", `document.querySelector(".waitlist")?.innerText.includes("on the waitlist, number 1")`);

  const owner = { headers: { Authorization: `Bearer ${TOKEN}` } };
  expect(await (await fetch(`${shell.url}/signups?list=paid`, owner)).json()).toMatchObject([{ email: "dj@example.com", list: "paid", place: 1 }]);
  expect(await (await fetch(`${shell.url}/signups`, owner)).json()).toEqual([]);
  expect((await fetch(`${shell.url}/usage`)).status).toBe(404);
  const use = await (await fetch(`${shell.url}/usage`, owner)).json();
  expect(use.records).toHaveLength(1);
  expect(use.records[0]).toMatchObject({ endedBy: "limit" });
  expect(use.records[0].hours).toBeGreaterThan(0.0009);
  expect(use.records[0].chunks).toBeGreaterThan(0);
  expect(use.totals[monthOf(Date.now())]).toMatchObject({ sets: 1, byLimit: 1 });
  await shell.stop();
});
