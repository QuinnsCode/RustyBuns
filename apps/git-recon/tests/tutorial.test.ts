// Boot camp's tutorial, through the running app: a level an agent starts skips it, Boot camp from the menu starts it,
// looking, moving, firing and swapping guns move it on (the scope step passes for a kit with no rebase), and once
// done it never shows again in this browser.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

type Coach = { learned: boolean; running: boolean; step: number; of: number; title: string | null };

test.skipIf(!chromePath())("Boot camp teaches look, move, scope, fire and swap, once", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    const go = () => load(chrome.cdp, tab, vite.url, 1500);
    const run = (name: string, args?: object) => tab.eval(`window.__commands.run(${JSON.stringify(name)}, ${JSON.stringify(args ?? {})})`);
    const coach = () => tab.eval<Coach>(`Promise.resolve(window.__commands.run("recon_state")).then((s) => s.tutorial)`);
    const until = async (what: string, ok: (c: Coach) => boolean, ms = 30_000) => {
      const end = Date.now() + ms;
      for (let c = await coach(); !ok(c); c = await coach()) { if (Date.now() > end) throw new Error(`never saw ${what}: ${JSON.stringify(c)}`); await Bun.sleep(100); }
    };
    const key = (type: "keydown" | "keyup", code: string) => tab.eval(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)}, { code: ${JSON.stringify(code)} }))`);

    // A level started by an agent's command is not a first-timer's: no coach.
    await go();
    await run("recon_start", { level: "kitchen" });
    expect(await coach()).toMatchObject({ running: false, learned: false });

    // Boot camp from the menu: the coach asks for a look first.
    await go();
    await tab.eval(`document.querySelector("#levels button.level").click()`);
    await until("the coach", (c) => c.running);
    expect(await coach()).toMatchObject({ step: 0, of: 5, title: "Look around" });
    expect(await tab.eval<string>(`document.querySelector(".eq-coach").textContent`)).toContain("1 of 5");

    await run("recon_look", { yaw: 1.2 });
    await until("Move", (c) => c.title === "Move");
    await key("keydown", "KeyW");
    // The committer's kit has no rebase, so the scope step passes straight to Fire.
    await until("Fire", (c) => c.title === "Fire");
    await key("keyup", "KeyW");
    await run("recon_fire");
    await until("Swap guns", (c) => c.title === "Swap guns");
    await run("recon_next_gun");
    await until("the tutorial done", (c) => c.learned && !c.running);

    // Boot camp again in the same browser: no coach.
    await go();
    await tab.eval(`document.querySelector("#levels button.level").click()`);
    await Bun.sleep(1000);
    expect(await coach()).toMatchObject({ running: false, learned: true });
    expect(await tab.eval<boolean>(`!document.querySelector(".eq-coach")`)).toBe(true);
  } finally {
    chrome.stop(); vite.stop();
  }
});
