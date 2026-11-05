// One journey through the running game: a signed-in player's account chip, report form and achievement toast wear the war
// warship's plates (src/eqosys.ts SKIN), its tokens resolved against the game's own stylesheet (--plate, --steel, --f-stencil).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

test.skipIf(!chromePath())("signed in, the chip, report form and toast wear the warship's plates", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, tab, vite.url, 500);
    // A local eqosys and a kept login, so the page shows the chip and the report button.
    await tab.eval(`localStorage.setItem("tf.eqosys", location.origin); localStorage.setItem("tf.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: "x" }))`);
    await load(chrome.cdp, tab, vite.url, 1500);
    const got = await tab.eval<{ who: string; font: string; plate: string; rim: string; edge: string; toast: string; steel: string }>(`(async () => {
      document.querySelector(".rb-report > .eq-btn").click();
      const util = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("util/src/eqosys.ts"));
      (await import(util)).celebrate({ id: "played", name: "First muster", blurb: "Played a battle", secret: false, at: 1 }, 0);
      const css = (sel) => getComputedStyle(document.querySelector(sel));
      return { who: document.querySelector(".eq-chip .eq-who").textContent, font: css(".eq-who").fontFamily, plate: css(".eq-chip").getPropertyValue("--ui-bg").trim(),
        rim: css(".rb-report .eq-form").borderImageSource, edge: getComputedStyle(document.documentElement).getPropertyValue("--edge").trim(), toast: css(".eq-toast").color, steel: css(".eq-toast").backgroundImage };
    })()`);
    expect(got.who).toBe("Ada");
    expect(got.font).toContain("Saira Stencil One"); // --f-stencil
    expect(got.plate).toBe("#171c23"); // --plate in styles.css
    expect(got.rim).toStartWith("url(");
    expect(got.rim).toBe(got.edge); // the menus' worn rim, --edge
    expect(got.toast).toBe("rgb(238, 241, 245)");
    expect(got.steel).toContain("/plates/steel.webp"); // the baked steel, --steel
    await tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
