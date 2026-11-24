// The jam room's menu (Esc in a room), in headless Chrome over CDP (scripts/chrome.ts): every group in it is a sideways
// row of cards, as the studios are. With five people in the room, Who's here is one row; a mouse wheel turns it and a
// real mouse drag slides it back, on a laptop and at phone width, and the page itself never scrolls sideways.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

// the room is a 3D scene, drawn in software on CI's runners: a case takes most of a minute there
setDefaultTimeout(240_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
// The linux-arm64 and Windows drop runners have no Chrome (#5553), so the check runs where one is, as the other Chrome tests do.
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

test.skipIf(!hasChrome).each([["a laptop", 1280, 720], ["a phone", 390, 844]] as const)("the room's menu on %s: every group a sideways row", async (_, w, h) => {
  const tab = await openTab(chrome.cdp, { w, h });
  // a tab left drawing its room starves the next one of CPU, so each case closes its own
  try { await rows(tab, w); } finally { await tab.close(); }
});

async function rows(tab: Awaited<ReturnType<typeof openTab>>, w: number) {
  await load(chrome.cdp, tab, `${vite.url}jam.html?room=menu-rows&studio=desert-gathering&quality=low`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  for (const end = Date.now() + 30_000; Date.now() < end; await Bun.sleep(50)) if (await page(`!!window.qjam && document.getElementById("studios").clientWidth > 0`)) break;


  // five people here: their cards are one row, and the wheel turns it sideways
  await page(`(() => {
    const ul = document.getElementById("people");
    for (const n of ["Sam", "Ari", "Jo", "Kit", "Lee"]) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
    ul.scrollIntoView({ block: "center" });
  })()`);
  const row = await page<{ x: number; y: number; over: number; tops: number }>(`(() => {
    const ul = document.getElementById("people"), r = ul.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, over: ul.scrollWidth - ul.clientWidth, tops: new Set([...ul.children].map((li) => li.offsetTop)).size };
  })()`);
  expect(row.tops).toBe(1);
  expect(row.over).toBeGreaterThan(0);
  await tab.call("Input.dispatchMouseEvent", { type: "mouseWheel", x: row.x, y: row.y, deltaX: 0, deltaY: 200 });
  await Bun.sleep(400);
  const wheeled = await page<number>(`document.getElementById("people").scrollLeft`);
  expect(wheeled).toBeGreaterThan(0);

  // a mouse drag to the right slides it back
  await tab.call("Input.dispatchMouseEvent", { type: "mousePressed", x: row.x, y: row.y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 10; i++) await tab.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x + i * 20, y: row.y, button: "left", buttons: 1 });
  await tab.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: row.x + 200, y: row.y, button: "left", clickCount: 1 });
  await Bun.sleep(400);
  expect(await page<number>(`document.getElementById("people").scrollLeft`)).toBeLessThan(wheeled);
  expect(await page<number>("document.documentElement.scrollWidth")).toBe(w);
}
