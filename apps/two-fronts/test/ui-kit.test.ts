// One journey through the running app: the opening dialog is the kit's, a war starts from it and a fleet is chosen.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

test.skipIf(!chromePath())("open the game, pick a war from the kit dialog, start it and a fleet", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  try {
    for (const size of [{ w: 1280, h: 720 }, { w: 390, h: 844 }]) {
      const chrome = await launchChrome(); // a fresh profile each size: no saved war
      try {
      const tab = await openTab(chrome.cdp, size, size.w < 500);
      await load(chrome.cdp, tab, vite.url);
      const open = await tab.eval<{ hidden: boolean; fits: boolean; sheet: boolean }>(`(() => {
        const m = document.getElementById("modal"), card = m.firstElementChild, r = card.getBoundingClientRect();
        return { hidden: m.hidden, fits: r.left >= 0 && r.right <= innerWidth, sheet: Math.abs(r.bottom - innerHeight) < 2 };
      })()`);
      expect(open.hidden).toBe(false);
      expect(open.fits).toBe(true);
      if (size.w < 500) expect(open.sheet).toBe(true);
      const started = await tab.eval<{ fleet: string; hidden: boolean }>(`(async () => {
        document.querySelector("[data-start=ai]").click();
        await new Promise((r) => setTimeout(r, 500));
        const fleet = document.querySelector("#modal-body h2")?.textContent;
        document.querySelector("[data-preset]").click();
        await new Promise((r) => setTimeout(r, 1000));
        return { fleet, hidden: document.getElementById("modal").hidden };
      })()`);
      expect(started.fleet).toBe("Choose your fleet");
      expect(started.hidden).toBe(true);
      expect(tab.noise.filter((n) => !/favicon/.test(n))).toEqual([]);
      await tab.close();
      } finally { chrome.stop(); }
    }
  } finally { vite.stop(); }
});
