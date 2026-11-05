// One journey through the running game: the credits played by name (@rustybuns/util/director's window.__scenes), the
// strips typed onto the file, the outtakes dropping in as photographs of the engine, and any key back to the menu.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

test.skipIf(!chromePath())("the credits roll to the outtakes, and a key goes back to the menu", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, tab, vite.url, 1500);
    const state = () => tab.eval<{ beat: { id: string; t: number } | null; cards: string[]; photos: { id: string; shot: boolean }[] }>("__scenes.state()");
    expect(await tab.eval<boolean>(`__scenes.list().includes("credits") && __scenes.play("credits")`)).toBe(true);
    // Wait for the first outtake to land: it drops at 7 s.
    const until = async (ok: (s: Awaited<ReturnType<typeof state>>) => boolean, ms = 15_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) { const s = await state(); if (ok(s)) return s; }
      return state();
    };
    const rolling = await until((s) => s.photos.length > 0);
    expect(rolling.beat?.id).toBe("credits");
    expect(rolling.cards).toEqual(expect.arrayContaining(["Thank you, Ryan Quinn", "with help from Fable, Opus and Sonnet"]));
    expect(rolling.photos[0]).toMatchObject({ id: "chute", shot: true });
    // The polaroid on the table is a photograph from the engine, and the file reads the thanks.
    const page = await tab.eval<{ src: string; text: string; menu: boolean }>(`({ src: document.querySelector("#credits .polaroid img").src,
      text: document.querySelector("#credits .lines").textContent, menu: !document.getElementById("menu").hidden })`);
    expect(page.src).toStartWith("data:image/jpeg");
    expect(page.text).toContain("Thank you, Ryan Quinn");
    expect(page.menu).toBe(false);
    // Any key cuts to the end, and the briefing is back.
    await tab.eval(`dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))`);
    const done = await until((s) => !s.beat, 5_000);
    expect(done.beat).toBeNull();
    expect(await tab.eval<boolean>(`!document.getElementById("menu").hidden && document.getElementById("credits").hidden`)).toBe(true);
    await tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
