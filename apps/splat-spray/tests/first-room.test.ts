// A first visit through the running page, in headless Chrome over CDP (scripts/chrome.ts): Solo practice from the menu
// is the tutorial. Look round, light the room, switch to Pick, pick the target, on to the next mission. After that it is
// learned in this browser and the next room has no coach.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(180_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => { [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, ".."))]); });
afterAll(() => { chrome?.stop(); vite?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface State { mode: string; target: string | null; found: number; tutorial: { learned: boolean; running: boolean; step: number; title: string | null } }

async function open() {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  await load(chrome.cdp, tab, vite.url, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const state = () => page<State>("splatSpray.state()");
  const until = async (what: string, expr: string, ms = 20_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}; state: ${JSON.stringify(await state().catch(() => null))}`);
  };
  const mouse = (type: string, x: number, y: number, buttons = 2) =>
    tab.call("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "right", buttons });
  const key = (type: "keyDown" | "keyUp", k: string, code: string) => tab.call("Input.dispatchKeyEvent", { type, key: k, code });
  await until("the menu", `!!window.splatSpray && !!document.getElementById("menu-solo")`, 60_000);
  return { page, state, until, mouse, key, close: tab.close, noise: () => tab.noise.filter((n) => !n.startsWith("HTTP ")) };
}

test("the first solo room is the tutorial, and the next visit has none", async () => {
  const tab = await open();
  expect((await tab.state()).tutorial).toMatchObject({ learned: false, running: false });
  await tab.page(`document.getElementById("menu-solo").click()`);
  await tab.until("a target", `!!splatSpray.state().target`);
  expect((await tab.state()).tutorial).toMatchObject({ running: true, step: 0, title: "Look around" });
  expect(await tab.page<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");

  // A right-drag turns the room, and back again (so the target is about where it started).
  await tab.mouse("mousePressed", 640, 360);
  for (let x = 640; x <= 800; x += 10) await tab.mouse("mouseMoved", x, 360);
  for (let x = 800; x >= 640; x -= 10) await tab.mouse("mouseMoved", x, 360);
  await tab.mouse("mouseReleased", 640, 360, 0);
  await tab.until("the coach on lighting", `splatSpray.state().tutorial.title === "Light the room"`);

  await tab.page(`[0, 1, 2].forEach(() => __spy.fireAt(innerWidth / 2, innerHeight / 2, __spy.GUN.spreadDeg))`);
  await tab.until("the coach on Pick", `splatSpray.state().tutorial.title === "Switch to Pick"`);
  await tab.key("keyDown", "Shift", "ShiftLeft");
  await tab.until("the coach on picking", `splatSpray.state().tutorial.title === "Pick the target"`);
  await tab.key("keyUp", "Shift", "ShiftLeft");

  // At the target: the first spot on screen whose pick lands on it (it may be half behind something from here).
  const spot = await tab.page<[number, number] | null>(`(() => {
    const id = __spy.target.id;
    for (let y = 20; y < innerHeight; y += 20) for (let x = 20; x < innerWidth; x += 20) if (__spy.pickAt(x, y)?.id === id) return [x, y];
    return null;
  })()`);
  expect(spot).not.toBeNull();
  await tab.page(`__spy.tryPick(${spot![0]}, ${spot![1]})`);
  await tab.until("the find", `splatSpray.state().found === 1`);
  await tab.key("keyDown", " ", "Space");
  await tab.until("the tutorial done", `splatSpray.state().tutorial.learned && !splatSpray.state().tutorial.running`);
  expect(tab.noise()).toEqual([]);
  await tab.close();

  const again = await open();
  await again.page(`document.getElementById("menu-solo").click()`);
  await again.until("a target", `!!splatSpray.state().target`);
  expect((await again.state()).tutorial).toMatchObject({ learned: true, running: false });
  expect(await again.page("document.querySelector('.eq-coach')")).toBeNull();
  await again.close();
});
