// The light / dark pick for the whole app (#6431), in headless Chrome over CDP (scripts/chrome.ts): pick Light in the
// room pill on the remote, and the front door and the speaker plans open light too; pick Dark in the speaker plans'
// pill, and the remote opens dark again. Each page's own colours follow (its background), not just the attribute.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(180_000); // vite serves cold, then three pages load in headless Chrome
useBrowser();

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 30_000, 50);
const look = (tab: Tab) => tab.eval<{ theme: string; bg: string }>(`({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`);
const pick = (tab: Tab, theme: string) => tab.eval(`(() => { document.querySelector("#qs-way > button").click(); document.querySelector('#qs-way .look [data-theme="${theme}"]').click(); })()`);

test.skipIf(!hasChrome)("a pick in the room pill on one page is the look on every page after it", async () => {
  const tab = await openTab(chrome.cdp, { w: 1440, h: 900 });
  try {
    await load(chrome.cdp, tab, `${vite.url}remote.html`, 0);
    await until(tab, "!!document.querySelector('#qs-way .look')");
    await pick(tab, "dark");
    const dark = await look(tab);
    await pick(tab, "light");
    const light = await look(tab);
    expect([dark.theme, light.theme]).toEqual(["dark", "light"]);
    expect(light.bg).not.toBe(dark.bg);
    expect(await tab.eval<string>(`document.querySelector('#qs-way .look [aria-checked="true"]').dataset.theme`)).toBe("light");

    for (const page of ["door.html", "speakers.html"]) {
      await load(chrome.cdp, tab, `${vite.url}${page}`, 0);
      await until(tab, "document.documentElement.dataset.theme === 'light'");
    }
    await until(tab, "!!document.querySelector('#qs-way .look')");
    await pick(tab, "dark");
    await load(chrome.cdp, tab, `${vite.url}remote.html`, 0);
    await until(tab, "!!document.querySelector('#qs-way .look')");
    expect(await look(tab)).toEqual(dark);
  } finally {
    await tab.close();
  }
});
