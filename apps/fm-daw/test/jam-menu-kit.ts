// The jam room's menu (Esc in a room), in headless Chrome over CDP (scripts/chrome.ts): every group in it is a sideways
// row of cards, as the studios are. With five people in the room, Who's here is one row; a mouse wheel turns it and a
// real mouse drag slides it back, on a laptop and on a phone either way up, and the page itself never scrolls sideways.
// The menu uses the screen (nearly its whole width) and sits under the row of rooms, which folds to one pill once you play.
// One screen size a file (jam-menu-*.test.ts), so CI's lanes can run them side by side (#5922).
import { expect, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

/** The menu's journey on a `w` x `h` screen, as this file's one test. */
export function menuOn(screen: string, w: number, h: number) {
  useBrowser();
  test.skipIf(!hasChrome)(`the room's menu on ${screen}: every group a sideways row`, async () => {
    const tab = await openTab(chrome.cdp, { w, h });
    try { await rows(tab, w); } finally { await tab.close(); }
  });
}

async function rows(tab: Awaited<ReturnType<typeof openTab>>, w: number) {
  await load(chrome.cdp, tab, `${vite.url}jam.html?room=menu-rows&studio=desert-gathering&quality=low`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  await until(tab, `!!window.qjam && document.getElementById("studios").clientWidth > 0`, "the room and its row of rooms", 60_000);
  // the menu: most of the screen's width, under the row of rooms
  const box = await page<{ wide: number; gap: number }>(`(() => {
    const m = document.getElementById("menu").getBoundingClientRect(), way = document.getElementById("qs-way").getBoundingClientRect();
    return { wide: m.width / innerWidth, gap: m.top - way.bottom };
  })()`);
  expect(box.wide).toBeGreaterThan(0.9);
  expect(box.gap).toBeGreaterThanOrEqual(0);

  // nine people here: their cards are one row, and the wheel turns it sideways
  await page(`(() => {
    const ul = document.getElementById("people");
    for (const n of ["Sam", "Ari", "Jo", "Kit", "Lee", "Max", "Ivy", "Rue", "Oz"]) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
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

  // in the room the row of rooms folds to the one you're in; pressing it opens the row again
  const shown = () => page<number>(`[...document.getElementById("qs-way").children].filter((e) => e.getClientRects().length).length`);
  // the place you are in and a door to each of the six others (Paths first, #5880)
  expect(await shown()).toBe(7);
  await page(`window.qjam.start()`);
  expect(await shown()).toBe(1);
  await page(`document.querySelector("#qs-way [aria-current]").click()`);
  expect(await shown()).toBe(7);
}
