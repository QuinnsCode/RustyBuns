// A new game with the keyboard only, through the running app: the arrows walk the title's buttons and the Bog Witch's
// five, Enter presses, and Set out (big, at the bottom of a full-height sheet) is one press down from the cards.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(300_000);

const KEYS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13 } as const;

test.skipIf(!chromePath())("a new game from the title to the world on the arrows and Enter", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 }, false, true);
    await load(chrome.cdp, tab, vite.url, 1500);
    const press = async (key: keyof typeof KEYS) => {
      const k = { key, code: key, windowsVirtualKeyCode: KEYS[key], ...(key === "Enter" && { text: "\r" }) };
      await tab.call("Input.dispatchKeyEvent", { type: "keyDown", ...k });
      await tab.call("Input.dispatchKeyEvent", { type: "keyUp", ...k });
      await Bun.sleep(150);
    };
    const focused = () => tab.eval<string>("document.activeElement?.id || document.activeElement?.dataset.id || ''");
    const until = async (what: string, ok: () => Promise<boolean>, ms = 30_000) => {
      for (const end = Date.now() + ms; !(await ok()); await Bun.sleep(100)) if (Date.now() > end) throw new Error(`never saw ${what}`);
    };

    // The title: the first press lands on the big red one, New game; Enter opens the witch's sheet.
    await press("ArrowDown");
    expect(await focused()).toBe("newGame");
    await press("Enter");
    await until("the witch's sheet", () => tab.eval<boolean>(`!document.querySelector("#starters").hidden`));
    await Bun.sleep(800); // the page swings in

    // Her five: the first press is the first card (not the little ? by her name); right walks along, Enter picks.
    await press("ArrowRight");
    expect(await focused()).toBe("hodag");
    await press("Enter");
    await press("ArrowRight");
    await press("Enter");
    await press("ArrowRight");
    await press("Enter");
    expect(await tab.eval<string[]>(`[...document.querySelectorAll(".starter.on")].map((c) => c.dataset.id)`)).toEqual(["hodag", "squonk", "agropelter"]);

    // Set out fills the bottom of the sheet, and it is one press down.
    const box = await tab.eval<{ w: number; bottom: number }>(`(() => { const r = document.querySelector("#setOut").getBoundingClientRect(); return { w: r.width, bottom: r.bottom }; })()`);
    expect(box.w).toBeGreaterThan(400);
    expect(box.bottom).toBeGreaterThan(800 * 0.85);
    await press("ArrowDown");
    expect(await focused()).toBe("setOut");
    await press("Enter");
    await until("the journey", () => tab.eval<boolean>("mythicMasters.journey.state() !== null"));
    expect(await tab.eval<string[]>("mythicMasters.journey.state().party.map((m) => m.id)")).toEqual(["hodag", "squonk", "agropelter"]);
  } finally {
    chrome.stop(); vite.stop();
  }
});
