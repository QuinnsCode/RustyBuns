// Qollab Studio's front door (#5860), signed out: through each card under LEARN, STUDIO and EVENT to its first step (only the
// Playground and The Event ask to sign in), and from there the way back home, in headless Chrome over CDP (scripts/chrome.ts). The door itself at phone
// and desktop sizes is front-door.test.ts.
import { setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { DOOR, PATHS, type PathId } from "../src/paths.ts";

// the gear room and the jam room are 3D scenes, drawn in software on CI's runners
setDefaultTimeout(300_000); // walks each of nine cards in headless Chrome
useBrowser();

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 60_000);

/** Each path's first step as its page shows it, signed out, and the way back home on that page. */
const FIRST: Record<PathId, { ready: string; back: string }> = {
  learn: { ready: "!!window.qstudio && !!document.getElementById('play')", back: "#qs-way a[data-to=paths]" },
  daw: { ready: "!!window.fmdaw && fmdaw.state().tracks.length > 0", back: "#qs-way a[data-to=paths]" },
  // the jam room is a room you share: its lobby asks you to sign in (live), or makes a room as a guest where eqosys
  // won't send anyone back (this test's 127.0.0.1)
  playground: { ready: "['door-out', 'door-lobby'].some((id) => document.getElementById(id)?.hidden === false)", back: "#qs-way a[data-to=paths]" },
  // the live show: the Event Planner, on its Party panel's Open as event
  event: { ready: "!!window.qrooms && !!document.getElementById('event-open')", back: "#qs-back" },
  instruments: { ready: "!!window.qdecks && qdecks.start().library.length >= 2", back: "#qs-back" },
  planner: { ready: "!!window.qrooms && !!qrooms.state()", back: "#qs-back" },
  amps: { ready: "!!window.qamp && !!qamp.state().amp", back: "#qs-way a[data-to=paths]" },
  speakers: { ready: "!!window.qspeakers", back: "#qs-way a[data-to=paths]" },
  builder: { ready: "!!window.qbuilder && !!qbuilder.state().probe", back: "#qs-way a[data-to=paths]" },
};

test.skipIf(!hasChrome)("Studio opens from its card on the field and a listed link opens that app", async () => {
  const tab = await openTab(chrome.cdp, { w: 375, h: 740 }, true);
  try {
    await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
    await until(tab, "!!window.qdoor");
    await tab.eval(`document.querySelector('.lane[data-lane="studio"] button').click()`);
    await until(tab, `qdoor.state().lane === "studio" && document.body.classList.contains("scrolled")`);
    await tab.eval(`document.querySelector('.sector[data-sector="studio"] .apps a[data-app="speakers"]').click()`);
    await until(tab, `location.pathname === "/speakers.html" && ${FIRST.speakers.ready}`);
  } finally { await tab.close(); }
});

test.skipIf(!hasChrome)("each card opens on its first step and leads back", async () => {
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
      await until(tab, `location.pathname + location.hash === ${JSON.stringify(p.href)}`);
      await until(tab, FIRST[p.id].ready);
      // the way back is on the page, and it goes home
      await until(tab, `!!document.querySelector(${JSON.stringify(FIRST[p.id].back)})`);
      await tab.eval(`document.querySelector(${JSON.stringify(FIRST[p.id].back)}).click()`);
      await until(tab, `location.pathname === ${JSON.stringify(DOOR)} && !!window.qdoor`);
    }
  } finally { await tab.close(); }
});
