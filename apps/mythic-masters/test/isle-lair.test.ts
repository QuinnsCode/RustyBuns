// The Yule Isle's lair, through the running app: take the boat over, walk into the cave mouth on the fell, and its
// fight plays in Grýla's kitchen (pocket.json's walls, lights, fog and critters); back from it you stand on the island.
// Each step waits on game state, and that state moves in the frame loop: the boat lands you once the director has played
// the world's arrival scene and the boat's crossing. CI's runner draws the open world in software at about a frame a
// second, so the page plays with `?draw=0` (nothing drawn, everything else the same) and the waits cut each scene
// rather than skip it (a skip still plays a 0.4 s fade, a few frames at the loop's 0.1 s step), so a step takes a frame
// or two, not a dozen (#4618).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { PACKS } from "../src/packs.ts";

setDefaultTimeout(180_000);

type Isle = { id: string; places: { name: string; x: number; z: number }[] } | null;

test.skipIf(!chromePath())("off the boat, the cave mouth on the fell opens onto its lair fight in the pocket's look", async () => {
  const pack = PACKS.find((p) => p.id === "yule-isle")!;
  const [chrome, vite] = await Promise.all([launchChrome(), startVite(new URL("..", import.meta.url).pathname)]);
  try {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 }, false, true);
    /** Asks `get` until `ok`, cutting whatever scene plays in between; a hang says what the director and the boat were doing. */
    const until = async <T>(what: string, get: string, ok: (v: T) => boolean, ms = 60_000) => {
      const end = Date.now() + ms;
      for (let v = await tab.eval<T>(get); ; v = await tab.eval<T>(get)) {
        if (ok(v)) return v;
        if (Date.now() > end) {
          const at = await tab.eval("({ beat: mythicMasters.director.state().beat, sailing: mythicMasters.world.state()?.sailing })");
          throw new Error(`never saw ${what}: ${JSON.stringify(v)} (${JSON.stringify(at)})`);
        }
        await tab.eval("mythicMasters.director.cut()"); // the arrival, the boat's lines, an intro: over
        await Bun.sleep(100);
      }
    };
    await load(chrome.cdp, tab, new URL("/?world=1&a=hodag&draw=0&quality=low", vite.url).href, 3000);
    await until("the world", "!!mythicMasters.world.state()", Boolean);
    expect(await tab.eval<boolean>("mythicMasters.world.ferry()")).toBe(true);
    const isle = await until<Isle>("the island", "mythicMasters.world.state().isle", (s) => !!s);
    const fell = isle!.places.find((q) => q.name === pack.lair.place)!;

    // Into the cave mouth: the lair's fight, its foe from pack.json, in the pocket's look.
    expect(await tab.eval<boolean>(`mythicMasters.world.standIsle(${fell.x}, ${fell.z})`)).toBe(true);
    await until("the lair fight", "mythicMasters.state()?.arena ?? null", (a) => a === `${pack.id}-lair`);
    expect(await tab.eval("mythicMasters.journey.trip()?.foe")).toMatchObject({ id: pack.lair.foe, level: pack.lair.level });

    // Back to the world: still on the island, by the cave mouth, and it doesn't take you straight in again.
    await tab.eval("mythicMasters.world.enter()");
    await until<Isle>("the island again", "mythicMasters.world.state()?.isle ?? null", (s) => s?.id === pack.id);
    await Bun.sleep(1000);
    expect(await tab.eval("mythicMasters.state()")).toBeNull();
  } finally {
    chrome.stop(); vite.stop();
  }
});
