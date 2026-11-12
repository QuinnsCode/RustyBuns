// The first fight's tutorial, through the running app: a fight from a link skips it, the picker's Fight starts it, each
// thing the coach asks for (move, jump, attack, guard, a special) moves it on, and once done it never shows again here.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

type Coach = { learned: boolean; running: boolean; step: number; of: number; title: string | null };

test.skipIf(!chromePath())("a first fight teaches move, jump, attack, guard and a special, once", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    const go = (path: string) => load(chrome.cdp, tab, new URL(path, vite.url).href, 1500);
    const coach = () => tab.eval<Coach | null>("mythicMasters.state()?.tutorial ?? null");
    const until = async (what: string, ok: (c: Coach | null) => boolean, ms = 20_000) => {
      const end = Date.now() + ms;
      for (let c = await coach(); !ok(c); c = await coach()) { if (Date.now() > end) throw new Error(`never saw ${what}: ${JSON.stringify(c)}`); await Bun.sleep(100); }
    };

    // A fight from a link is a look, not a first fight: no coach.
    await go("/?a=hodag&b=squonk");
    await until("the link's fight", (c) => c !== null);
    expect(await coach()).toMatchObject({ running: false, learned: false });

    // The picker's Fight: the coach asks for a move first.
    await go("/?versus");
    await tab.eval(`document.querySelector("#fight").click()`);
    await until("the coach", (c) => !!c?.running);
    expect(await coach()).toMatchObject({ step: 0, of: 5, title: "Move" });
    expect(await tab.eval<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");

    for (const [action, next] of [["forward", "Jump"], ["jump", "Attack"], ["light", "Guard"], ["guard", "A special"]] as const) {
      await tab.eval(`mythicMasters.hold(${JSON.stringify([action])})`);
      await until(next, (c) => c?.title === next);
      await tab.eval("mythicMasters.hold([])");
    }
    await tab.eval(`mythicMasters.hold(["special"])`);
    await until("the tutorial done", (c) => !!c?.learned && !c.running);
    await tab.eval("mythicMasters.hold(null)");

    // Another fight in the same browser: no coach.
    await go("/?versus");
    await tab.eval(`document.querySelector("#fight").click()`);
    await until("the second fight", (c) => c !== null);
    expect(await coach()).toMatchObject({ running: false, learned: true });
    expect(await tab.eval<boolean>(`!document.querySelector(".eq-coach")`)).toBe(true);
    expect(tab.noise.filter((n) => !/favicon|HTTP /.test(n))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop();
  }
});
