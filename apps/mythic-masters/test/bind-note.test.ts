// A bind pressed too early, through the running app (#5386): in a wild fight the Book says the beast is too strong,
// and once it is worn under the line the prompt calls for the bind instead of keeping the old note.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

setDefaultTimeout(180_000);

type Prompt = { chance: number; ink: number; note: string } | null;

test.skipIf(!chromePath())("pressed early, the too-strong note gives way to the call to bind once the beast is worn down", async () => {
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    await load(chrome.cdp, tab, new URL("/?world=1&a=hodag&draw=0&quality=low", vite.url).href, 3000);
    const until = async <T>(get: string, ok: (v: T) => boolean, ms = 60_000) => {
      const end = Date.now() + ms;
      for (let v = await tab.eval<T>(get); ; v = await tab.eval<T>(get)) {
        if (ok(v)) return v;
        if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)} from ${get}`);
        await tab.eval("mythicMasters.director.cut()");
        await Bun.sleep(100);
      }
    };
    await until("!!mythicMasters.world.state()", Boolean);
    expect(await tab.eval<boolean>(`mythicMasters.journey.begin(["hodag", "squonk", "agropelter"])`)).toBe(true);
    expect(await tab.eval<string>(`mythicMasters.journey.fight("wild")?.kind`)).toBe("wild");
    await until<boolean>("!!mythicMasters.state() && !mythicMasters.state().over", Boolean);

    const prompt = "mythicMasters.journey.prompt()";
    await tab.eval("mythicMasters.journey.bind()");
    expect((await tab.eval<Prompt>(prompt))?.note).toStartWith("Too strong to bind yet");

    await tab.eval("mythicMasters.journey.wear(0.2)");
    const now = await tab.eval<Prompt>(prompt);
    expect(now?.chance).toBeGreaterThan(0);
    expect(now?.note).toBe("Bind it now, before it drops");
  } finally {
    chrome.stop(); vite.stop();
  }
});
