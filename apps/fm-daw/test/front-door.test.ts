// Qollab Studio's front door (#5860), the way a newcomer meets it, in headless Chrome over CDP (scripts/chrome.ts): at
// phone and desktop sizes the door names every card under LEARN, BUILD and PLAY on one line each with nothing off the side,
// and its live field (#6019) darkens at the back when the air dries out and again behind a bank. Walking each path is
// front-door-paths.test.ts, so CI's lanes can run the two side by side (#5922).
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { DOOR, PATHS, SECTORS } from "../src/paths.ts";

setDefaultTimeout(240_000); // loads the front door at two sizes in headless Chrome's software GL
useBrowser();

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 60_000);
interface Door { paths: { id: string; sector: string; name: string; href: string; oneLine: boolean }[]; overflowX: boolean }
interface Hero { air: { tempC: number; humidity: number; bank: boolean }; map: { near: number; far: number }; back: { dull: number; ms: number }; playing: boolean; draws: number }

test.skipIf(!hasChrome)("the door names every card under its word, each on one line, and its field answers the air and the bank, at phone and desktop sizes", async () => {
  for (const [w, h, mobile] of [[375, 740, true], [1440, 900, false]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    try {
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await until(tab, "!!window.qdoor");
      const door = await tab.eval<Door>("qdoor.state()");
      expect(door.paths.map((p) => [p.sector, p.id, p.href])).toEqual(SECTORS.flatMap((s) => PATHS.filter((p) => p.sector === s.id).map((p) => [s.id, p.id, p.href])));
      expect(door.paths.filter((p) => !p.oneLine).map((p) => p.name)).toEqual([]);
      expect(door.overflowX).toBe(false);
      // the field, as someone moves the humidity slider down and presses the mountain button: the far half of the map darkens each time
      const hero = () => tab.eval<Hero>("qdoor.hero.state()");
      const mild = await hero();
      await tab.eval(`(() => { const i = document.querySelector('input[name="humidity"]'); i.value = "15"; i.dispatchEvent(new Event("input")); })()`);
      const dry = await hero();
      expect(dry.air.humidity).toBe(15);
      expect(dry.map.far).toBeGreaterThan(mild.map.far + 1);
      expect(dry.back.dull).toBeGreaterThan(mild.back.dull);
      expect(dry.draws).toBeGreaterThan(mild.draws);
      await tab.eval(`document.querySelector('button[name="bank"]').click()`);
      const banked = await hero();
      expect(banked.air.bank).toBe(true);
      expect(banked.map.far).toBeGreaterThan(dry.map.far + 3);
      expect(banked.map.near).toBeCloseTo(dry.map.near, 0);
      await tab.eval(`document.querySelector('button[name="play"]').click()`);
      expect((await hero()).playing).toBe(true);
    } finally { await tab.close(); }
  }
});
