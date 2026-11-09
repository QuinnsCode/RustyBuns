// One journey through the running game's end: Command's newsreel played by name (@rustybuns/util/director's
// window.__scenes), the engine's footage rolling under a poster and the announcer, a key into the credits, the strips
// typed onto the file, the outtakes dropping in as photographs of the engine, and a key back to the menu.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(120_000);

type State = { beat: { id: string; t: number } | null; line: string | null; cards: string[]; photos: { id: string; shot: boolean }[] };

test.skipIf(!chromePath())("the newsreel rolls into the credits, the credits to the outtakes, and a key goes back to the menu", async () => {
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
    await load(chrome.cdp, tab, vite.url, 1500);
    const state = () => tab.eval<State>("__scenes.state()");
    const until = async (ok: (s: State) => boolean, ms = 15_000) => {
      for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) { const s = await state(); if (ok(s)) return s; }
      return state();
    };
    const key = () => tab.eval(`dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }))`);
    expect(await tab.eval<boolean>(`__scenes.list().includes("newsreel") && __scenes.play("newsreel")`)).toBe(true);

    // The first slogan goes up over the footage at 3.4 s, the announcer talking under it as the soldier goes over.
    const reel = await until((s) => s.cards.includes("Every commit counts!"));
    expect(reel.beat?.id).toBe("newsreel");
    expect(reel.line).toStartWith("Our boys go over the top");
    const page = await tab.eval<{ poster: string; reeling: boolean; menu: boolean }>(`({ poster: document.querySelector("#newsreel .slate").textContent,
      reeling: document.body.classList.contains("reeling") && !document.getElementById("newsreel").hidden, menu: !document.getElementById("menu").hidden })`);
    expect(page).toEqual({ poster: "Every commit counts!", reeling: true, menu: false });

    // A key cuts the newsreel short, and the credits roll after it.
    await key();
    const rolling = await until((s) => s.beat?.id === "credits" && s.photos.length > 0);
    expect(rolling.cards).toEqual(expect.arrayContaining(["Thank you, Ryan Quinn", "with help from Fable, Opus and Sonnet"]));
    expect(rolling.photos[0]).toMatchObject({ id: "chute", shot: true });
    const file = await tab.eval<{ src: string; text: string; reel: boolean }>(`({ src: document.querySelector("#credits .polaroid img").src,
      text: document.querySelector("#credits .lines").textContent, reel: !document.getElementById("newsreel").hidden })`);
    expect(file.src).toStartWith("data:image/jpeg");
    expect(file.text).toContain("Thank you, Ryan Quinn");
    expect(file.reel).toBe(false);

    // Any key cuts to the end, and the briefing is back.
    await key();
    const done = await until((s) => !s.beat, 5_000);
    expect(done.beat).toBeNull();
    expect(await tab.eval<boolean>(`!document.getElementById("menu").hidden && document.getElementById("credits").hidden && !document.body.classList.contains("reeling")`)).toBe(true);
    await tab.close();
  } finally { chrome.stop(); vite.stop(); }
});
