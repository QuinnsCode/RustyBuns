// A first visit through the running page, in headless Chrome over CDP (scripts/chrome.ts): Play puts you camping in a
// solo round, and that round is the tutorial. Drop in, look round, walk into a bush, crouch, lie low till the hunt.
// After that the tutorial is learned in this browser and Play never shows it again. A ?role= jump never starts it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite, type Cdp } from "../../../scripts/chrome.ts";

setDefaultTimeout(180_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => { [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, ".."))]); });
afterAll(() => { chrome?.stop(); vite?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Coach { learned: boolean; running: boolean; step: number; title: string | null }
interface State { phase: string; role: string | null; zone: string; you: { x: number; y: number; yaw: number; crouch: boolean } | null; tutorial: Coach }

async function open(cdp: Cdp, path: string) {
  const tab = await openTab(cdp, { w: 1280, h: 720 });
  await load(cdp, tab, new URL(path, vite.url).href, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await page("window.parkHideSeek?.state()").catch(() => null))}`);
  };
  const key = (type: "keyDown" | "keyUp", code: string) => tab.call("Input.dispatchKeyEvent", { type, code, key: code.slice(3).toLowerCase() });
  const errors = () => tab.noise.filter((n) => !n.startsWith("HTTP "));
  await until("the menu", `!!window.parkHideSeek && !document.getElementById("play").disabled`, 60_000);
  return { page, until, key, errors, state: () => page<State>("parkHideSeek.state()"), close: tab.close };
}

/** A bush in the page's zone with a clear, droppable spot 9 m further out, so walking ahead from the drop (you land
 * facing the middle) goes straight into it. */
const BUSH_RUN = `(async () => {
  const { zoneById } = await import("/src/zones/zone.ts");
  const { dropOk } = await import("/src/hunt/game.ts");
  const z = zoneById(parkHideSeek.state().zone);
  const clear = (x, y) => z.reachable(x, y) && z.near(x, y, 2).every((p) => p.kind === "bush" || Math.hypot(p.x - x, p.y - y) > 1.6);
  for (let r = 60; r < z.R * 0.8; r += 5) for (let a = 0; a < 6.28; a += 0.05) {
    for (const b of z.near(Math.sin(a) * r, Math.cos(a) * r, 4)) {
      const d = Math.hypot(b.x, b.y);
      if (b.kind !== "bush" || d < 50) continue;
      const ux = b.x / d, uy = b.y / d, from = [b.x + ux * 9, b.y + uy * 9];
      if (!dropOk(z, from[0], from[1])) continue;
      let ok = true;
      for (let s = 0; s <= 9 - b.size && ok; s += 0.5) ok = clear(b.x + ux * (9 - s), b.y + uy * (9 - s));
      if (ok) return { from, bush: [b.x, b.y] };
    }
  }
  return null;
})()`;

test("a jump link lands in a round with no tutorial", async () => {
  const tab = await open(chrome.cdp, "/?role=hider&bots=2");
  await tab.until("the drop", `parkHideSeek.state()?.phase === "drop"`);
  expect((await tab.state()).tutorial).toMatchObject({ learned: false, running: false });
  expect(await tab.page("document.querySelector('.eq-coach')")).toBeNull();
  await tab.close();
});

test("the first Play is the tutorial: drop, look, walk, crouch in a bush, lie low; the next Play has none", async () => {
  const tab = await open(chrome.cdp, "/");
  await tab.page(`document.getElementById("play").click()`);
  await tab.until("the drop", `parkHideSeek.state()?.phase === "drop"`);
  expect(await tab.state()).toMatchObject({ role: "camper", tutorial: { running: true, step: 0, title: "Pick where to drop" } });
  expect(await tab.page<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");

  const run = await tab.page<{ from: [number, number]; bush: [number, number] } | null>(BUSH_RUN);
  expect(run).not.toBeNull();
  await tab.page(`parkHideSeek.drop(${run!.from[0]}, ${run!.from[1]})`);
  await tab.until("the coach on looking", `parkHideSeek.state().tutorial.title === "Look around"`);

  // Landed (the drop clock runs out): a full turn round, which leaves you facing the bush again.
  await tab.until("the hide", `parkHideSeek.state().phase === "hide" && !!parkHideSeek.state().you`, 30_000);
  await tab.page("parkHideSeek.turn(Math.PI)");
  await sleep(200);
  await tab.page("parkHideSeek.turn(Math.PI)");
  await tab.until("the coach on walking", `parkHideSeek.state().tutorial.title === "Walk"`);

  // W into the bush, then C. A frame moves you at most 0.1 s worth, and CI's software-drawn Chrome runs a few frames a
  // second, so the 9 m walk gets 30 s there (it takes about 3 on a Mac).
  const inBush = `(async () => { const { zoneById } = await import("/src/zones/zone.ts"); const s = parkHideSeek.state(); return !!s.you && !!zoneById(s.zone).bushAt(s.you.x, s.you.y); })()`;
  await tab.key("keyDown", "KeyW");
  await tab.until("in the bush", inBush, 30_000);
  await tab.key("keyUp", "KeyW");
  expect((await tab.state()).tutorial.title).toBe("Crouch in a bush");
  await tab.key("keyDown", "KeyC");
  await tab.key("keyUp", "KeyC");
  await tab.until("the coach on lying low", `parkHideSeek.state().tutorial.title === "Lie low"`, 5_000);

  // The hunt starts: done, for good in this browser.
  await tab.until("the tutorial done", `parkHideSeek.state().tutorial.learned && !parkHideSeek.state().tutorial.running`, 40_000);
  expect(tab.errors()).toEqual([]);
  await tab.close();

  const again = await open(chrome.cdp, "/");
  await again.page(`document.getElementById("play").click()`);
  await again.until("the drop", `parkHideSeek.state()?.phase === "drop"`);
  expect((await again.state()).tutorial.running).toBe(false);
  expect(await again.page("document.querySelector('.eq-coach')")).toBeNull();
  await again.close();
});
