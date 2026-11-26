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

setDefaultTimeout(120_000);
const app = join(import.meta.dir, "..");
const nothing = { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("", { status: 404 }) }) };
let vite = "";
/** The worker with a Listen namespace (`ears` a set at most), its pages from the dev server. */
function site(ears = "200") {
  const shell = serve<Parameters<typeof worker.fetch>[1]>({ headers: {} });
  const ASSETS = { fetch: (r: Request) => { const u = new URL(r.url); return fetch(`${vite}${u.pathname}${u.search}`, { headers: { accept: r.headers.get("accept") ?? "*/*" } }); } };
  shell.mount(worker, { ASSETS, WORLD: nothing, LOBBY: nothing, PROFILE: nothing, LISTEN: durableObject(Listen, { LISTEN_EARS: ears }) });
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
