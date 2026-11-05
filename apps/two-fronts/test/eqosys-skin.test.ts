// One journey through the running game: a signed-in player's account chip, report form and achievement toast wear the war
// room's eqosys skin (src/eqosys.ts SKIN), its tokens resolved against the game's own stylesheet (--plate, --imperial).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

test.skipIf(!chromePath())("signed in, the chip, report form and toast wear the war room's skin", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, tab, vite.url, 500);
    // A local eqosys and a kept login, so the page shows the chip and the report button.
    await tab.eval(`localStorage.setItem("tf.eqosys", location.origin); localStorage.setItem("tf.login", JSON.stringify({ name: "Ada", email: "ada@example.com", token: "x" }))`);
    await load(chrome.cdp, tab, vite.url, 1500);
    const got = await tab.eval<{ who: string; font: string; plate: string; border: string; toast: string; cut: string }>(`(async () => {
      document.querySelector(".rb-report > .eq-btn").click();
      const util = performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("util/src/eqosys.ts"));
      (await import(util)).celebrate({ id: "played", name: "First muster", blurb: "Played a battle", secret: false, at: 1 }, 0);
      const css = (sel) => getComputedStyle(document.querySelector(sel));
      return { who: document.querySelector(".eq-chip .eq-who").textContent, font: css(".eq-who").fontFamily, plate: css(".eq-chip").getPropertyValue("--ui-bg").trim(),
        border: css(".rb-report .eq-form").borderTopColor, toast: css(".eq-toast").color, cut: css(".eq-toast").clipPath };
    })()`);
    expect(got.who).toBe("Ada");
    expect(got.font).toContain("Cinzel");
    expect(got.plate).toBe("#171c23"); // --plate in styles.css
    expect(got.border).toBe("rgb(156, 122, 42)");
    expect(got.toast).toBe("rgb(236, 226, 198)");
    expect(got.cut).toStartWith("polygon(");
    await tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
