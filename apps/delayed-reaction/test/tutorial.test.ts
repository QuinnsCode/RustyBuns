// The first run through the running page, in headless Chrome over CDP (scripts/chrome.ts): pick preset 1 from the menu
// and the tutorial coach walks it (hear a call, step into a lane, answer it, on the beat, four in a row), answered by a
// player who steps into each door on its due beat. Then it never shows again in that browser, and a jump link never
// starts it. Any page error or console.error fails it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite, type Cdp } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => {
  [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, ".."))]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

interface Coach { learned: boolean; running: boolean; step: number; title: string | null }

async function open(cdp: Cdp, path: string, own = false) {
  const tab = await openTab(cdp, { w: 800, h: 560 }, false, own);
  await load(cdp, tab, new URL(path, vite.url).href, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.delayedReaction?.state()").catch(() => null))}`);
  };
  /** A real click (a user gesture, so the music may start) on the element `selector` finds. */
  const click = async (selector: string) => {
    const r = await page<{ x: number; y: number }>(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await tab.call("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  };
  const coach = () => page<Coach>("delayedReaction.state().tutorial");
  await until("the menu", `!!document.querySelector(".preset")`);
  return { page, until, click, coach, errors: () => tab.noise.filter((n) => !n.startsWith("HTTP ")), close: tab.close };
}

const CODES = ["KeyD", "KeyF", "KeyJ", "KeyK"];

test("the first preset is the tutorial; done once, it never shows again", async () => {
  const tab = await open(chrome.cdp, "/");
  expect(await tab.coach()).toMatchObject({ learned: false, running: false });

  // Preset 1 from the menu: the run starts and the coach waits on the first call.
  await tab.click(".preset");
  await tab.until("the run", `!delayedReaction.state().menu`);
  expect(await tab.coach()).toMatchObject({ running: true, step: 0, title: "Hear the call" });
  expect(await tab.page<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");
  await tab.until("the coach on the lanes", `delayedReaction.state().tutorial.title === "Step into a lane"`);

  // A player who steps into each door on its due beat (the run's next door, as the page says it).
  void tab.page(`new Promise((done) => {
    const codes = ${JSON.stringify(CODES)};
    let last = -1;
    const t = setInterval(() => {
      const s = delayedReaction.state();
      if (s.menu || s.tutorial.learned) { clearInterval(t); return done(true); }
      if (!s.next || s.next.due === last || s.beat < s.next.due - 0.02) return;
      last = s.next.due;
      const code = codes[s.next.lane];
      dispatchEvent(new KeyboardEvent("keydown", { code }));
      setTimeout(() => dispatchEvent(new KeyboardEvent("keyup", { code })), 40);
    }, 4);
  })`);
  await tab.until("the tutorial done", `delayedReaction.state().tutorial.learned && !delayedReaction.state().tutorial.running`, 60_000);
  await tab.until("the card gone", `!document.querySelector(".eq-coach")`, 5_000);

  // Back at the menu (Escape ends a run), preset 1 again runs with no coach.
  await tab.page(`dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }))`);
  await tab.until("the menu again", `!document.querySelector("#menu").hidden`);
  await tab.click(".preset");
  await tab.until("the second run", `!delayedReaction.state().menu`);
  expect(await tab.coach()).toMatchObject({ learned: true, running: false });
  expect(await tab.page<null>(`document.querySelector(".eq-coach")`)).toBeNull();
  expect(tab.errors()).toEqual([]);
  await tab.close();

  // Someone new on a jump link: its Go lands in that state, and the tutorial waits for a preset of their own.
  const linked = await open(chrome.cdp, "/?level=2&beat=8", true);
  await linked.click("#scenario");
  await linked.until("the linked run", `!delayedReaction.state().menu`);
  expect(await linked.coach()).toMatchObject({ learned: false, running: false });
  expect(linked.errors()).toEqual([]);
  await linked.close();
});
