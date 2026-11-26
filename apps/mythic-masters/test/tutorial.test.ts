// The first fight's tutorial, through the running app: a fight from a link skips it, the picker's Fight starts it, each
// thing the coach asks for (move, jump, attack, guard, a special) moves it on, and once done it never shows again here.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite, waitFor } from "../../../scripts/chrome.ts";

setDefaultTimeout(400_000); // every step of the fight tutorial in headless Chrome (about 143 s on CI)

type Coach = { learned: boolean; running: boolean; step: number; of: number; title: string | null };

test.skipIf(!chromePath())("a first fight teaches move, jump, attack, guard and a special, once", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    // The coach is the page's state and its card, not its pixels: `draw=0&quality=low` plays the fight without drawing it, so
    // software GL on a CI runner never holds the main thread a minute compiling and drawing the arena (#5930).
    const go = (path: string) => load(chrome.cdp, tab, new URL(`${path}&draw=0&quality=low`, vite.url).href, 1500);
    const coach = () => tab.eval<Coach | null>("mythicMasters.state()?.tutorial ?? null");
    /** Waits for `ok`, an expression over the page's coach `c`. */
    const until = (what: string, ok: string, ms = 60_000) =>
      waitFor(tab, what, `(() => { const c = mythicMasters.state()?.tutorial ?? null; return ${ok}; })()`, ms, "mythicMasters.state()?.tutorial ?? null");

    // A fight from a link is a look, not a first fight: no coach.
    await go("/?a=hodag&b=squonk");
    await until("the link's fight", "c !== null");
    expect(await coach()).toMatchObject({ running: false, learned: false });

    // The picker's Fight: the coach asks for a move first.
    await go("/?versus");
    await tab.eval(`document.querySelector("#fight").click()`);
    await until("the coach", "c?.running");
    expect(await coach()).toMatchObject({ step: 0, of: 5, title: "Move" });
    expect(await tab.eval<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");
    // Hands count once the face-off is over and the fight ticks (a CI runner draws a frame a second or so).
    await waitFor(tab, "the fight ticking", "(mythicMasters.state()?.tick ?? 0) > 5", 120_000, undefined, 250);

    for (const [action, next] of [["forward", "Jump"], ["jump", "Attack"], ["light", "Guard"], ["guard", "A special"]] as const) {
      await tab.eval(`mythicMasters.hold(${JSON.stringify([action])})`);
      await until(next, `c?.title === ${JSON.stringify(next)}`);
      await tab.eval("mythicMasters.hold([])");
    }
    await tab.eval(`mythicMasters.hold(["special"])`);
    await until("the tutorial done", "c?.learned && !c.running");
    await tab.eval("mythicMasters.hold(null)");

    // Another fight in the same browser: no coach.
    await go("/?versus");
    await tab.eval(`document.querySelector("#fight").click()`);
    await until("the second fight", "c !== null");
    expect(await coach()).toMatchObject({ running: false, learned: true });
    expect(await tab.eval<boolean>(`!document.querySelector(".eq-coach")`)).toBe(true);
    expect(tab.noise.filter((n) => !/favicon|HTTP /.test(n))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop();
  }
});
