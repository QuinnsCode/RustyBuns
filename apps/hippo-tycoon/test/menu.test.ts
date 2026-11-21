// A newcomer on a phone, through the running page in headless Chrome (scripts/chrome.ts): the first card is the ways to
// play and Options, one tap on Solo starts a round, and the name, bots, players and round length wait under Options,
// where a returning player finds what they picked last time.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
beforeAll(async () => { [chrome, vite] = await Promise.all([launchChrome(), startVite(join(import.meta.dir, ".."))]); });
afterAll(() => { chrome?.stop(); vite?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("a newcomer's first card is the ways to play, Solo is one tap to a round, and the picks under Options stay picked", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = async (what: string, expr: string, ms = 30_000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await page(expr).catch(() => false)) return;
    throw new Error(`never saw ${what}`);
  };
  // What a person can see and press: each button's own words (its first line), and the controls on screen.
  const tap = (word: string) => page(`[...document.querySelectorAll("button")].find((b) => b.firstChild?.textContent?.trim() === ${JSON.stringify(word)}).click()`);
  /** The choices shown as picked in the row a screen reader names `label`. */
  const pressed = (label: string) => page<string[]>(`(() => { const id = [...document.querySelectorAll("label")].find((l) => l.textContent === ${JSON.stringify(label)}).id;
    return [...document.querySelectorAll('[aria-labelledby="' + id + '"] button[aria-pressed="true"]')].map((b) => b.textContent); })()`);
  const card = () => page<{ buttons: string[]; fields: number }>(`(() => { const c = document.querySelector(".menu .card .col");
    return { buttons: [...c.querySelectorAll("button")].map((b) => b.firstChild.textContent.trim()), fields: c.querySelectorAll("input, [role=group]").length }; })()`);

  await load(chrome.cdp, tab, vite.url, 0);
  await until("the menu", `!!document.querySelector(".menu .card .col button")`);
  const first = await card();
  expect(first.buttons[0]).toBe("Solo");
  expect(first.buttons.filter((b) => !["Solo", "Couch", "Join LAN", "Online", "Options"].includes(b))).toEqual([]);
  expect(first.fields).toBe(0);

  // Under Options: harder bots and a short round, then back out and in again later.
  await tap("Options");
  await until("the options", `!!document.querySelector('[role="dialog"]')`);
  await tap("hard");
  await tap("30s");
  expect(await pressed("Bots")).toEqual(["hard"]);
  await tap("Done");
  await load(chrome.cdp, tab, vite.url, 0);
  await until("the menu again", `!!document.querySelector(".menu .card .col button")`);
  await tap("Options");
  await until("the options again", `!!document.querySelector('[role="dialog"]')`);
  expect([await pressed("Bots"), await pressed("Round length")]).toEqual([["hard"], ["30s"]]);
  await tap("Done");

  // One tap from the menu to a round of your own.
  await tap("Solo");
  await until("a solo round", `window.hippoTycoon?.state().round?.mine.length === 1`, 60_000);
  expect(tab.noise.filter((n) => !n.startsWith("HTTP "))).toEqual([]);
  await tab.close();
});
