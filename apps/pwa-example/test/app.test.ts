// Pocket Dice as a phone gets it: `vite build`, the build served as Workers assets would serve it, opened in headless
// Chrome at phone size. Chrome must find nothing in the way of installing it (the check Android runs before it offers
// "Install app"), the service worker must take the page over, and a roll must be the Rust roller's. Then the server
// goes away and the page loads again, a shared roll's link included, from the phone's cache alone.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launchChrome, load, openTab, type Chrome, type Tab } from "../../../scripts/chrome.ts";
import { tsRoller, wasmRoller } from "../src/roller.ts";

setDefaultTimeout(180_000);
const app = join(import.meta.dir, "..");
const dist = join(app, "dist/ui");

type State = { engine: string; offlineReady: boolean; controlled: boolean; last: { seed: number; n: number; sides: number; dice: number[] } | null; link: string | null };

test("the Rust roller and the TS one roll the same dice", async () => {
  const wasm = await wasmRoller(await Bun.file(join(app, "src/dice.wasm")).arrayBuffer());
  for (const [seed, n, sides] of [[0, 6, 6], [42, 3, 20], [2 ** 32 - 1, 6, 4], [123_456_789, 1, 12]] as const)
    expect(wasm.roll(seed, n, sides)).toEqual(tsRoller.roll(seed, n, sides));
});

let chrome: Chrome, tab: Tab, server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  const build = Bun.spawnSync(["bun", "--bun", "x", "vite", "build"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(`vite build: ${build.stderr.toString().slice(-800)}`);
  server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname, file = join(dist, path === "/" ? "index.html" : path);
      // As Workers assets with single-page-application: a path with no file is the page.
      return new Response(Bun.file(existsSync(file) && !file.endsWith("/") ? file : join(dist, "index.html")));
    },
  });
  chrome = await launchChrome();
  tab = await openTab(chrome.cdp, { w: 412, h: 915 }, true);
});
afterAll(() => { server?.stop(true); chrome?.stop(); });

const state = () => tab.eval<State>("pocketDice.state()");
async function until(what: string, ok: (s: State) => boolean) {
  for (let i = 0; i < 60; i++) { const s = await state(); if (ok(s)) return s; await Bun.sleep(250); }
  throw new Error(`${what}: ${JSON.stringify(await state())}`);
}

test("installs, works offline, and opens a shared roll with no network", async () => {
  const url = `http://127.0.0.1:${server.port}/`;
  await load(chrome.cdp, tab, url, 500);
  const first = await until("worker takes over", (s) => s.offlineReady && s.controlled);
  expect(first.engine).toBe("wasm");

  const { installabilityErrors } = await tab.call("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);

  const r = await tab.eval<State["last"]>("pocketDice.roll(42)");
  expect(r?.dice).toEqual(tsRoller.roll(42, 2, 6));

  server.stop(true);
  await load(chrome.cdp, tab, `${url}?seed=7&n=3&d=20`, 500);
  const offline = await until("loads from the cache", (s) => s.last?.seed === 7);
  expect(offline).toMatchObject({ engine: "wasm", controlled: true, last: { seed: 7, n: 3, sides: 20, dice: tsRoller.roll(7, 3, 20) } });
  expect(tab.noise).toEqual([]);
});
