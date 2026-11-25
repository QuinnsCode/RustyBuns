// Qollab Studio's front door (#5860), the way a newcomer meets it, in headless Chrome over CDP (scripts/chrome.ts): at
// phone and desktop sizes the door names all six paths on one line each with nothing off the side; then, signed out,
// through each path's card to its first step (only the jam room asks to sign in), and from there the way back home.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite, until as pageUntil } from "../../../scripts/chrome.ts";
import { DOOR, PATHS, type PathId } from "../src/paths.ts";

// the gear room and the jam room are 3D scenes, drawn in software on CI's runners
setDefaultTimeout(240_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 60_000);
interface Door { paths: { id: string; name: string; href: string; oneLine: boolean }[]; overflowX: boolean }

/** Each path's first step as its page shows it, signed out, and the way back home on that page. */
const FIRST: Record<PathId, { ready: string; back: string }> = {
  learn: { ready: "!!window.qstudio && !!document.getElementById('play')", back: "#qs-way a[data-to=paths]" },
  track: { ready: "!!window.fmdaw && fmdaw.state().tracks.length > 0", back: "#qs-way a[data-to=paths]" },
  // the jam room is a room you share: its lobby asks you to sign in (live), or makes a room as a guest where eqosys
  // won't send anyone back (this test's 127.0.0.1)
  jam: { ready: "['door-out', 'door-lobby'].some((id) => document.getElementById(id)?.hidden === false)", back: "#qs-way a[data-to=paths]" },
  dj: { ready: "!!window.qdecks && qdecks.start().library.length >= 2", back: "#qs-back" },
  plan: { ready: "!!window.qrooms && !!qrooms.state()", back: "#qs-back" },
  circuit: { ready: "!!window.qamp && !!qamp.state().amp", back: "#qs-way a[data-to=paths]" },
};

test.skipIf(!hasChrome)("the door names six paths at phone and desktop sizes, and each opens on its first step and leads back", async () => {
  for (const [w, h, mobile] of [[375, 740, true], [1440, 900, false]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    try {
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await until(tab, "!!window.qdoor");
      const door = await tab.eval<Door>("qdoor.state()");
      expect(door.paths.map((p) => [p.id, p.href])).toEqual(PATHS.map((p) => [p.id, p.href]));
      expect(door.paths.filter((p) => !p.oneLine).map((p) => p.name)).toEqual([]);
      expect(door.overflowX).toBe(false);
    } finally { await tab.close(); }
  }

  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  try {
    // the paths are what's checked, not the picture: this browser keeps low quality, as Q would, so the jam room
    // isn't drawn on high in software GL (83 s to load on the builder, past the wait below)
    await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
    await tab.eval(`localStorage.setItem("qollab-studio:quality", "low")`);
    for (const p of PATHS) {
      await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
      await until(tab, "!!window.qdoor");
      await tab.eval(`qdoor.open(${JSON.stringify(p.id)})`);
      await until(tab, `location.pathname === ${JSON.stringify(p.href)}`);
      await until(tab, FIRST[p.id].ready);
      // the way back is on the page, and it goes home
      await until(tab, `!!document.querySelector(${JSON.stringify(FIRST[p.id].back)})`);
      await tab.eval(`document.querySelector(${JSON.stringify(FIRST[p.id].back)}).click()`);
      await until(tab, `location.pathname === ${JSON.stringify(DOOR)} && !!window.qdoor`);
    }
  } finally { await tab.close(); }
});
