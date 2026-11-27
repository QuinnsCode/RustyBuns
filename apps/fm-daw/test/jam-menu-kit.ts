// The jam room's way in (#6420), in headless Chrome over CDP (scripts/chrome.ts): the entry panel is a gateway, the
// gathering's name, whose it is and who's here, then Settings, Leave, a big Enter and one row of share buttons, with
// nothing to choose (and no password field: this room has none). Wide along the bottom on a landscape screen, stacked on
// a phone (Enter on top, Settings and Leave side by side). A room made with no event is the desert gathering; alone in
// it with no live line you are its owner, so Settings > The gathering shows it, and an edit there goes on the sesh. You
// picks a font for this browser only. (The password's door is world.test.ts's: the World holds it.)
// (A guest's view, no gathering tab, rests on the World refusing their edits: door.test.ts.)
// One screen size a file (jam-menu-*.test.ts), so CI's lanes can run them side by side (#5922).
import { expect, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { PLACES } from "../src/way.ts";

/** The way in's journey on a `w` x `h` screen, as this file's one test. */
export function menuOn(screen: string, w: number, h: number) {
  useBrowser();
  test.skipIf(!hasChrome)(`the jam room's way in on ${screen}: the entry panel, then Settings`, async () => {
    const tab = await openTab(chrome.cdp, { w, h });
    try { await wayIn(tab, w, h); } finally { await tab.close(); }
  });
}

type Box = { x: number; y: number; w: number; h: number };
async function wayIn(tab: Awaited<ReturnType<typeof openTab>>, w: number, h: number) {
  await load(chrome.cdp, tab, `${vite.url}jam.html?room=way-in&studio=desert-gathering&quality=low`, 0);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  await until(tab, `!!window.qjam && !document.getElementById("door-room").hidden`, "the room's entry panel", 60_000);
  const box = (id: string) => page<Box>(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);

  // the panel: only its own buttons show, every one inside the screen
  const shown = await page<string[]>(`[...document.querySelectorAll("#menu button, #menu a")].filter((e) => e.getClientRects().length).map((e) => e.id)`);
  expect(shown.filter((id) => id !== "share").sort()).toEqual(["friends-open", "invite", "lobby", "play", "settings-open"]);
  expect(await page<string>(`document.getElementById("room-title").textContent`)).toBe("way-in");
  expect(await page<number>(`document.querySelectorAll("#menu input, #menu select").length - document.querySelectorAll("#menu [hidden] input, #menu [hidden] select, #menu input[hidden]").length`)).toBe(0);
  expect(await page<string>(`document.getElementById("here-line").textContent`)).toContain("1 here");
  const panel = await box("menu");
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.w).toBeLessThanOrEqual(w);
  expect(panel.y + panel.h).toBeLessThanOrEqual(h);
  const [enter, cog, leave] = await Promise.all([box("play"), box("settings-open"), box("lobby")]);
  if (w > 600) {
    // most of the width (about 72 px in from each side at 1440), and Settings, Leave and Enter in one row
    expect(panel.w / w).toBeGreaterThan(0.85);
    expect(Math.abs(cog.y + cog.h / 2 - (enter.y + enter.h / 2))).toBeLessThan(4);
    expect(cog.x).toBeLessThan(leave.x);
    expect(leave.x).toBeLessThan(enter.x);
  } else {
    // a phone: Enter on top, Settings and Leave side by side under it
    expect(enter.y + enter.h).toBeLessThanOrEqual(cog.y);
    expect(Math.abs(cog.y - leave.y)).toBeLessThan(2);
    expect(cog.x + cog.w).toBeLessThanOrEqual(leave.x);
  }
  expect(await page<number>("document.documentElement.scrollWidth")).toBe(w);

  // Settings: the owner's gathering tab, Desert Gathering picked, every list in its own box
  await page(`(document.getElementById("settings-open").click(), 1)`);
  const opened = await page<{ tab: string; tabs: string[]; setup: { studio: string; tops: string } }>(`qjam.settings()`);
  expect(opened).toMatchObject({ tab: "room", tabs: ["room", "you"], setup: { studio: "desert-gathering" } });
  expect(await page<boolean>(`document.getElementById("menu").hidden`)).toBe(true);
  expect(await page<string[]>(`[...document.querySelectorAll("#set-studios [aria-pressed=true] b")].map((b) => b.textContent)`)).toEqual(["Desert Gathering"]);
  const settings = await box("settings");
  expect(settings.x + settings.w).toBeLessThanOrEqual(w);
  // the tops go on their own stands: on the sesh, for everyone
  await page(`([...document.querySelectorAll("#set-tops button")].find((b) => b.textContent === "Their own stands").click(), 1)`);
  expect(await page<string | undefined>(`qjam.settings().setup.tops`)).toBe("stands");
  expect(await page<string[]>(`[...document.querySelectorAll("#set-tops [aria-pressed=true]")].map((b) => b.textContent)`)).toEqual(["Their own stands"]);
  // who can come in: anyone with the link, until the owner sets a password
  expect(await page<string | null>(`document.getElementById("set-open").getAttribute("aria-pressed")`)).toBe("true");

  // You: the 20 fonts, each in its own; a pick changes this page's headings and is kept
  await page(`(document.getElementById("tab-you").click(), 1)`);
  const fonts = await page<{ name: string; font: string }[]>(`[...document.querySelectorAll("#set-fonts b")].map((b) => ({ name: b.textContent, font: b.style.fontFamily }))`);
  expect(fonts).toHaveLength(20);
  expect(fonts[0]?.name).toBe("Saira Condensed");
  for (const f of fonts) expect(f.font).toContain(f.name);
  await page(`([...document.querySelectorAll("#set-fonts button")].find((b) => b.textContent === "Oswald").click(), 1)`);
  expect(await page<string>(`getComputedStyle(document.getElementById("room-title")).fontFamily`)).toContain("Oswald");
  expect(await page<string | null>(`localStorage.getItem("qollab-studio:font")`)).toBe("Oswald");
  // Character, Controls, Plug in and Sound live here now
  expect(await page<string[]>(`[...document.querySelectorAll("#set-mine b")].map((b) => b.textContent)`)).toEqual(["Character", "Controls", "Plug in", "Sound"]);

  // Done: back to the entry panel, and in the room the row of places folds to the one you're in
  await page(`(document.getElementById("settings-done").click(), 1)`);
  expect(await page<boolean>(`document.getElementById("menu").hidden`)).toBe(false);
  const places = () => page<number>(`[...document.getElementById("qs-way").children].filter((e) => e.getClientRects().length).length`);
  expect(await places()).toBe(Object.keys(PLACES).length);
  await page(`window.qjam.start()`);
  expect(await places()).toBe(1);
}
