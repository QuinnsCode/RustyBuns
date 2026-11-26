// Qollab Studio's front door (#5860), the way a newcomer meets it, in headless Chrome over CDP (scripts/chrome.ts): at
// phone and desktop sizes the door names every card under LEARN, BUILD and PLAY on one line each with nothing off the side. Walking each path is
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

test.skipIf(!hasChrome)("the door names every card under its word, each on one line, at phone and desktop sizes", async () => {
  for (const [w, h, mobile] of [[375, 740, true], [1440, 900, false]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    try {
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await until(tab, "!!window.qdoor");
      const door = await tab.eval<Door>("qdoor.state()");
      expect(door.paths.map((p) => [p.sector, p.id, p.href])).toEqual(SECTORS.flatMap((s) => PATHS.filter((p) => p.sector === s.id).map((p) => [s.id, p.id, p.href])));
      expect(door.paths.filter((p) => !p.oneLine).map((p) => p.name)).toEqual([]);
      expect(door.overflowX).toBe(false);
    } finally { await tab.close(); }
  }
});
