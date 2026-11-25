// YouTube links in the QDJs library (src/dj/youtube.ts, panel.ts): a DJ pastes links onto the decks page mid-set, and
// with both decks playing they wait in the library instead of knocking a deck off; they are still there next visit,
// once each, and × forgets one. No network needed: nothing here loads YouTube's player (both decks are busy).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output", "--autoplay-policy=no-user-gesture-required"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

type Shelf = { id: string; title: string }[];

test.skipIf(!hasChrome)("links pasted mid-set wait in the library, once each, and are there next visit", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}`);
  };
  // a paste on the page itself, not into a box, as Cmd+V over the decks does it
  const paste = (text: string) => page(`(() => { const d = new DataTransfer(); d.setData("text/plain", ${JSON.stringify(text)}); document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true })); return true; })()`);
  const shelf = () => page<Shelf>("qdecks.state().shelf");

  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  await until("the decks", "!!window.qdecks");
  await page("qdecks.start()");
  await until("the demo tracks on both decks", "qdecks.state().decks.every((d) => d.name)");
  const names = await page<string[]>("qdecks.state().decks.map((d) => d.name)");

  await paste("https://www.youtube.com/watch?v=M7lc1UVf-VE&t=42s");
  await paste("https://youtu.be/dQw4w9WgXcQ?si=share");
  await paste("https://youtu.be/M7lc1UVf-VE"); // the first again: it moves up, not in twice
  await paste("just some words"); // not a link: nothing happens
  expect((await shelf()).map((s) => s.id)).toEqual(["M7lc1UVf-VE", "dQw4w9WgXcQ"]);
  // both decks kept what they had
  expect(await page<string[]>("qdecks.state().decks.map((d) => d.name)")).toEqual(names);
  expect(await page<unknown[]>("qdecks.state().tubes")).toEqual([null, null]);

  // next visit: still in the library, and its row's x forgets one
  await load(chrome.cdp, tab, `${vite.url}/decks.html`, 0);
  await until("the decks again", "!!window.qdecks");
  await page("qdecks.start()");
  expect((await shelf()).map((s) => s.id)).toEqual(["M7lc1UVf-VE", "dQw4w9WgXcQ"]);
  await page(`document.querySelector(".dj-lib-open").click()`);
  await page(`[...document.querySelectorAll("li.tube")][1].querySelector(".dj-forget").click()`);
  expect((await shelf()).map((s) => s.id)).toEqual(["M7lc1UVf-VE"]);
});
