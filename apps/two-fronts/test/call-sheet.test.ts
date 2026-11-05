// One journey through the running app: a turn called with the call sheet, as a player does it. Build
// a troop, send an armada at an enemy orbit, land troops on their ground, and see both fights with
// the units and odds before ending the turn, on a desk, an upright tablet and a phone. The map is drawn
// across most of its column at each size, clear of the overview list (#3563: 190 px wide at 820).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

const PLAY = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const next = async () => { $("#end-turn").click(); await wait(300); $("#close")?.click(); await wait(200); };
  $("[data-preset=line]").click(); await wait(300);
  const box = $(".galaxy").getBoundingClientRect(), [, , vw, vh] = $(".galaxy").getAttribute("viewBox").split(" ").map(Number);
  const drawn = Math.min(box.width, box.height * vw / vh), top = box.top + (box.height - drawn * vh / vw) / 2, left = box.left + (box.width - drawn) / 2;
  const ov = $(".overview").getBoundingClientRect(), column = $(".map").getBoundingClientRect().width || innerWidth;
  const map = { share: drawn / column, clear: top >= ov.bottom || left >= ov.right || ov.top >= top + drawn * vh / vw };
  await next(); // the fleet goes down; Muster
  const credits = +$(".bank .coins b").textContent;
  $(".buy-unit .more:not(:disabled)").click(); await wait(100);
  const spent = credits - +$(".bank .coins b").textContent;
  await next(); await next(); // Deploy, then Armada
  $$("[data-call-from]").find((b) => /Lumen/.test(b.textContent))?.click(); await wait(100);
  $$("[data-call-to]").find((b) => b.querySelector(".state.held"))?.click(); await wait(100);
  const armada = { steps: $$(".call-steps li.done").length, ships: +$(".howmany .u b").textContent };
  $("[data-call-n]").click(); await wait(100); // one fewer, to keep a transport home
  $("[data-call-go]").click(); await wait(100);
  await next(); // Invasion
  if (!$("[data-call-to]")) $("[data-call-from]")?.click();
  await wait(100);
  $("[data-call-to]").click(); await wait(100);
  const invasion = { vs: !!$(".call .vs"), confirm: $("[data-call-go]").textContent.trim() };
  $("[data-call-go]").click(); await wait(100);
  const declared = $$(".orders .o-head").map((h) => h.firstChild.nextSibling.textContent);
  const badges = $$(".phasebar em").length;
  await next(); // Battles
  return { map, spent, armada, invasion, declared, badges, fights: $$(".fight .vs").length, overflow: document.documentElement.scrollWidth > innerWidth };
})()`;

test.skipIf(!chromePath())("a turn called with the call sheet: build, armada, invasion, then the fights", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  try {
    for (const size of [{ w: 1280, h: 800 }, { w: 820, h: 1180 }, { w: 390, h: 844 }]) {
      const chrome = await launchChrome();
      try {
        const tab = await openTab(chrome.cdp, size, size.w < 500);
        await load(chrome.cdp, tab, `${vite.url}?war=short&side=marines&vs=ai`, 3000);
        const r = await tab.eval<{ map: { share: number; clear: boolean }; spent: number; armada: { steps: number; ships: number }; invasion: { vs: boolean; confirm: string }; declared: string[]; badges: number; fights: number; overflow: boolean }>(PLAY);
        expect(r.map.share).toBeGreaterThan(0.6);
        expect(r.map.clear).toBe(true);
        expect(r.spent).toBeGreaterThan(0);
        expect(r.armada.steps).toBe(2); // from and to picked, on to how many
        expect(r.armada.ships).toBeGreaterThan(1);
        expect(r.invasion.vs).toBe(true);
        expect(r.invasion.confirm).toMatch(/^Land \d+ troops? on /);
        expect(r.declared).toEqual(["Muster", "Armada", "Invasion"]);
        expect(r.badges).toBe(3);
        expect(r.fights).toBeGreaterThanOrEqual(1);
        expect(r.overflow).toBe(false);
        expect(tab.noise.filter((n) => !/favicon|fonts\.g/.test(n))).toEqual([]);
        await tab.close();
      } finally { chrome.stop(); }
    }
  } finally { vite.stop(); }
});
