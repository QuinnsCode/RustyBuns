// Qollab Studio's front door (#5860), the way a newcomer meets it, in headless Chrome over CDP (scripts/chrome.ts): at
// phone and desktop sizes the field is the menu. LEARN, STUDIO and EVENT are lanes on it, each listing its apps, and under it each
// lane's shelf follows the last, every card's name on one line with nothing off the side. A lane's button scrolls to its shelf, the
// buttons slide into the tabs up top, the tabs scroll between shelves, and the lane being read lights on the field. The
// live field (#6019) darkens at the back when the air dries out and again behind a bank. Walking each path is
// front-door-paths.test.ts, so CI's lanes can run the two side by side (#5922).
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { DOOR, PATHS, SECTORS } from "../src/paths.ts";

setDefaultTimeout(240_000); // loads the front door at two sizes in headless Chrome's software GL
useBrowser();

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 60_000);
interface Chip { at: string; shown: boolean; text: string; left: number; right: number; top: number }
interface Door { lanes: { id: string; apps: { id: string; href: string; onScreen: boolean }[] }[]; paths: { id: string; sector: string; name: string; href: string; shown: boolean; oneLine: boolean }[]; lane: string | null; overflowX: boolean; account: Chip[] }
/** The chip at `at`, which must be the only one on the screen. */
const chipAt = (d: Door, at: string) => { expect(d.account.filter((c) => c.shown).map((c) => c.at)).toEqual([at]); return d.account.find((c) => c.at === at)!; };
interface Hero { air: { tempC: number; humidity: number; bank: boolean }; map: { near: number; far: number }; back: { dull: number; ms: number }; playing: boolean; draws: number }

test.skipIf(!hasChrome)("each lane on the field scrolls to its shelf and becomes a tab, every card on one line, and the field answers the air and the bank, at phone and desktop sizes", async () => {
  for (const [w, h, mobile] of [[375, 740, true], [1440, 900, false]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    try {
      // a local eqosys, so this 127.0.0.1 page may sign in: signed out, the chip says Sign in
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await tab.eval(`localStorage.setItem("qollab-studio.eqosys", "http://127.0.0.1:9")`);
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await until(tab, "!!window.qdoor && qdoor.state().account.some((c) => c.shown && c.text.includes('Sign in'))");
      const door = await tab.eval<Door>("qdoor.state()");
      // top right over the sky
      const sky = chipAt(door, "field");
      expect(sky.text).toContain("Sign in");
      expect(sky.right).toBeGreaterThan(w - 40);
      expect(sky.top).toBeLessThan(80);
      expect(door.paths.map((p) => [p.sector, p.id, p.href])).toEqual(SECTORS.flatMap((s) => PATHS.filter((p) => p.sector === s.id).map((p) => [s.id, p.id, p.href])));
      // each lane's card on the field lists its apps as links, all of them on the screen at once
      expect(door.lanes.map((l) => [l.id, l.apps.map((a) => [a.id, a.href])])).toEqual(SECTORS.map((s) => [s.id, PATHS.filter((p) => p.sector === s.id).map((p) => [p.id, p.href])]));
      expect(door.lanes.flatMap((l) => l.apps).filter((a) => !a.onScreen).map((a) => a.id)).toEqual([]);
      expect(door.lane).toBe(null);
      expect(door.paths.filter((p) => !p.shown || !p.oneLine).map((p) => p.name)).toEqual([]);
      expect(door.overflowX).toBe(false);
      // the first lane from its button on the field, the others from the tabs the buttons slid into: each scrolls to its
      // shelf, lights on the field, and draws its things
      for (const [i, s] of SECTORS.entries()) {
        await tab.eval(i === 0 ? `document.querySelector('.lane[data-lane="${s.id}"] button').click()` : `document.querySelector('#tabs [data-tab="${s.id}"]').click()`);
        await until(tab, `qdoor.state().lane === ${JSON.stringify(s.id)}`);
        await until(tab, `document.body.classList.contains("scrolled") && qdoor.shelf().items.some((t) => t.seen && t.drawn)`);
        expect(await tab.eval<string | null>(`document.querySelector('#tabs [aria-selected="true"]')?.dataset.tab ?? null`)).toBe(s.id);
        // the chip has moved to the right end of the tabs
        const tabsChip = chipAt(await tab.eval<Door>("qdoor.state()"), "tabs");
        expect(tabsChip.text).toContain("Sign in");
        expect(tabsChip.right).toBeGreaterThan(w - 40);
        expect(tabsChip.right).toBeLessThanOrEqual(w);
      }
      await tab.eval(`document.getElementById('field-back').click()`);
      await until(tab, "qdoor.state().lane === null && scrollY < 2");
      // the night's air hides behind the small button in the corner
      expect(await tab.eval<boolean>(`document.getElementById('air').hidden`)).toBe(true);
      await tab.eval(`document.getElementById('air-egg').click()`);
      expect(await tab.eval<boolean>(`document.getElementById('air').hidden`)).toBe(false);
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
