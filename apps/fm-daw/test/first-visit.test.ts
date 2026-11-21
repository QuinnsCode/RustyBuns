// Someone new on the desk, in headless Chrome over CDP (scripts/chrome.ts): the start card's one Start button turns the
// sound on, a card says what to try first, and its Play the groove starts the groove playing. Once tried, a later
// visit in that browser goes straight to the desk with no card.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => {
  // Chrome's stand-in speakers: real time with no sound card, as scripts/web-plugin-check.ts
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(join(import.meta.dir, ".."))]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

test("Start, then Play the groove: two taps from landing to a playing groove, and the hint only once", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  await load(chrome.cdp, tab, vite.url, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.fmdaw?.state()").catch(() => null))}`);
  };
  /** A real click (a user gesture, so the audio may start) on the element `selector` finds. */
  const click = async (selector: string) => {
    const r = await page<{ x: number; y: number }>(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await tab.call("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  };
  const hinting = () => page<boolean>(`!!document.querySelector(".first-try")`);

  await until("the start card", `!!window.fmdaw && !!document.querySelector(".gate .play")`);
  expect(await page<string | null>("fmdaw.state().audio")).toBeNull();

  await click(".gate .play");
  await until("the sound on", `fmdaw.state().audio === "running"`);
  expect(await page<boolean>("fmdaw.state().playing")).toBe(false);
  expect(await hinting()).toBe(true);

  await click(".first-try .play");
  await until("the groove playing", `fmdaw.state().playing`);
  expect(await hinting()).toBe(false);

  // Back another day: Start goes straight to the desk.
  await load(chrome.cdp, tab, vite.url, 0);
  await until("the start card again", `!!window.fmdaw && !!document.querySelector(".gate .play")`);
  await click(".gate .play");
  await until("the sound on again", `fmdaw.state().audio === "running"`);
  expect(await hinting()).toBe(false);
  // the desk's own requests to a desktop host that isn't there are the browser page working
  expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);
  await tab.close();
});
