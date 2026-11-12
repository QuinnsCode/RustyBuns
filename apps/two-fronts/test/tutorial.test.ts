// The first visit's tutorial, through the running app: a war from a link skips it, the title of a first visit starts it,
// and picking a side, a fleet, placing a unit, deploying and calling a play with Confirm walk it to the end. A reload
// of the same browser shows it no more.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

type Coach = { learned: boolean; running: boolean; step: number; of: number; title: string | null };

const PLAY = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const coach = async () => (await twoFronts.state()).tutorial.title;
  const seen = [await coach()];
  $("[data-start=ai]").click(); await wait(300); seen.push(await coach());
  $("[data-preset=line]").click(); await wait(300); seen.push(await coach());
  for (const g of $$(".galaxy [data-system]")) { g.dispatchEvent(new MouseEvent("click", { bubbles: true })); await wait(100); if ($("[data-place]")) break; }
  $('[data-place$=":-1"]:not(:disabled)').click(); await wait(200); seen.push(await coach());
  $("#end-turn").click(); await wait(500); $("#close")?.click(); await wait(200); seen.push(await coach());
  for (let i = 0; i < 4 && !$("[data-call-from], [data-call-to]"); i++) { $("#end-turn").click(); await wait(300); $("#close")?.click(); await wait(200); }
  if (!$("[data-call-to]")) $("[data-call-from]").click();
  await wait(100);
  $("[data-call-to]").click(); await wait(100);
  $("[data-call-go]").click(); await wait(300);
  return seen;
})()`;

test.skipIf(!chromePath())("a first visit teaches a side, a fleet, a unit placed, the deploy and a confirmed call, once", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const coach = (t: Awaited<ReturnType<typeof openTab>>) => t.eval<Coach>("twoFronts.state().then((s) => s.tutorial)");

    // A war from a link is a jump: no coach, even on a first visit.
    const jumped = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    await load(chrome.cdp, jumped, `${vite.url}?war=short&side=marines&vs=ai&seed=1`, 2000);
    expect(await coach(jumped)).toMatchObject({ running: false, learned: false });
    await jumped.close();

    // A first visit's title: the coach asks for a side, and each step of the first turn moves it on.
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    await load(chrome.cdp, tab, vite.url, 2000);
    expect(await coach(tab)).toMatchObject({ running: true, step: 0, of: 5, title: "Pick a side" });
    expect(await tab.eval<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");
    expect(await tab.eval<(string | null)[]>(PLAY)).toEqual(["Pick a side", "Choose your fleet", "Place a unit", "Deploy your fleet", "Call a play"]);
    const end = Date.now() + 5000;
    while (!(await coach(tab)).learned && Date.now() < end) await Bun.sleep(100);
    expect(await coach(tab)).toMatchObject({ learned: true, running: false });

    // Back in the same browser: the war goes on, and no coach.
    await load(chrome.cdp, tab, vite.url, 2000);
    expect(await coach(tab)).toMatchObject({ running: false, learned: true });
    expect(await tab.eval<boolean>(`!document.querySelector(".eq-coach")`)).toBe(true);
    expect(tab.noise.filter((n) => !/favicon|fonts\.g/.test(n))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop();
  }
});
