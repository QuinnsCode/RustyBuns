// A new game with the keyboard only, through the running app, in the opening's order (#4671): the title says what the
// game is on the page, New game plays Tape 1, the Book opens and says the job, its five are the next page (the arrows
// walk the cards, Enter picks, Set out is one press down), and the world keeps the first goal on screen.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(300_000);

const KEYS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Enter: 13 } as const;

test.skipIf(!chromePath())("a new game from the title to the world on the arrows and Enter: tape, the Book, its five, the goal", async () => {
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
    // what the page was doing when a wait ran out: the scene and how far in, frames drawn, focus, visibility
    const where = () => tab.eval<string>(`JSON.stringify({ director: mythicMasters.director.state(), frames: window.__mmFrames?.() ?? null, focus: document.activeElement?.id || document.activeElement?.tagName, hidden: document.hidden, visibility: document.visibilityState, hasFocus: document.hasFocus() })`).catch((e) => String(e));
    const until = async (what: string, ok: () => Promise<boolean>, ms = 30_000) => {
      for (const end = Date.now() + ms; !(await ok()); await Bun.sleep(100)) if (Date.now() > end) throw new Error(`never saw ${what}: ${await where()}`);
    };
    await tab.eval(`(() => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); window.__mmFrames = () => n; })()`);
    const shown = (sel: string) => tab.eval<boolean>(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && !el.closest("[hidden]") && el.getBoundingClientRect().height > 0; })()`);
    const text = (sel: string) => tab.eval<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);

    // The title says the job on the page, not behind the (?).
    expect(await shown("#title .plain")).toBe(true);
    expect(await text("#title .plain")).toContain("every cryptid on Earth");

    // The first press lands on the big red one, New game; Enter plays Tape 1, and any key skips it.
    await press("ArrowDown");
    expect(await focused()).toBe("newGame");
    await press("Enter");
    await until("Tape 1", () => tab.eval<boolean>(`mythicMasters.director.state().beat?.id === "abduction"`));
    expect(await tab.eval<boolean>("mythicMasters.journey.state() === null")).toBe(true);
    // a key skips it once the tape listens, later on a slow runner: press while it still plays, not once after a timer.
    // Each poll keeps the scene's time and the frames drawn, so a wait that runs out says what the tape was doing.
    const polls: string[] = [];
    try {
      await until("Tape 1 skipped", async () => {
        const at = await tab.eval<{ id: string | null; t: number; frames: number | null }>(`({ id: mythicMasters.director.state().beat?.id ?? null, t: +(mythicMasters.director.state().beat?.t ?? 0).toFixed(2), frames: window.__mmFrames?.() ?? null })`);
        polls.push(`${at.id}@${at.t}s f${at.frames}`);
        if (at.id !== "abduction") return true;
        await press("Enter");
        await Bun.sleep(250);
        return false;
      });
    } catch (e) { throw new Error(`${(e as Error).message}\n  last polls: ${polls.slice(-8).join(", ")}`); }

    // The Book opens: page by page it says the job and offers its five, then asks. The arrows walk its buttons.
    await until("the Book", () => shown("#bookTalk .demand"));
    const said: string[] = [];
    for (let i = 0; i < 12 && (await tab.eval<boolean>(`!!document.querySelector("#bookTalk [data-next]")`)); i++) {
      said.push(await text("#bookTalk .demand"));
      await press("ArrowDown");
      await press("Enter");
    }
    expect(said.join(" ")).toContain("You find them. You beat them in a fight. I hold them.");
    expect(said.join(" ")).toContain("take three");
    await press("ArrowDown");
    expect(await tab.eval<string>("document.activeElement?.dataset.r ?? ''")).toBe("all");
    await press("Enter");
    expect(await text("#bookTalk .demand")).toContain("take three of my five");
    await press("ArrowDown");
    await press("Enter");

    // Its five: the Book's own words on the page; the first press is the first card, right walks along, Enter picks.
    await until("the Book's five", () => shown("#starters .spoken"));
    expect(await text("#starters h1")).toContain("Book");
    // the page swings in, longer on a slow runner (#5388): a press before it lands moves nothing, so press until one
    // lands; the one that does takes the first card, as a player's first press does
    await until("a card focused", async () => { await press("ArrowRight"); return (await focused()) !== ""; });
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

    // The world: your three, what you told the Book kept, and the first goal on screen until the first keeper falls.
    await until("the journey", () => tab.eval<boolean>("mythicMasters.journey.state() !== null"));
    expect(await tab.eval<string[]>("mythicMasters.journey.state().party.map((m) => m.id)")).toEqual(["hodag", "squonk", "agropelter"]);
    expect(await tab.eval<unknown>("mythicMasters.book.state().talk?.said")).toEqual({ open: "all" });
    await until("the first goal", () => shown("#worldHud .goal"));
    expect(await text("#worldHud .goal")).toContain("keeper");
    await tab.eval("mythicMasters.journey.clearTo(1, 0)");
    await until("the goal done", async () => !(await shown("#worldHud .goal")));
  } finally {
    chrome.stop(); vite.stop();
  }
});
