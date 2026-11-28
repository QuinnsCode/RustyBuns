// Qollab Studio's front door (#5860), signed out: through each card under LEARN, STUDIO and EVENT to its first step (only the
// Playground and The Event ask to sign in), and from there the way back home, in headless Chrome over CDP (scripts/chrome.ts). The door itself at phone
// and desktop sizes is front-door.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { DEMOS, DOOR, PATHS, SECTORS, type PathId } from "../src/paths.ts";

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

test.skipIf(!hasChrome)("someone new: the demo picker offers four apps, an agent reads the door in words, and Studio's start sits them at the keys", async () => {
  const tab = await openTab(chrome.cdp, { w: 375, h: 740 }, true);
  try {
    await load(chrome.cdp, tab, `${vite.url}${DOOR.slice(1)}`, 0);
    await tab.eval(`localStorage.setItem("qollab-studio:quality", "low")`);
    await until(tab, "!!window.qdoor");
    // every lane's way in is on its card, on the screen
    const { starts } = await tab.eval<{ starts: { lane: string; href: string; shown: boolean }[] }>("qdoor.starts()");
    expect(starts).toEqual(SECTORS.map((s) => expect.objectContaining({ lane: s.id, href: s.start.href, shown: true })));
    // not sure: the pill under the title opens four demos, each an app's own first step
    await tab.eval("qdoor.demo()");
    const { demo } = await tab.eval<{ demo: { open: boolean; picks: { id: string; href: string }[] } }>("qdoor.starts()");
    expect(demo.open).toBe(true);
    expect(demo.picks.map((d) => [d.id, d.href])).toEqual(DEMOS.map((d) => [d.id, PATHS.find((p) => p.id === d.path)!.href]));
    await tab.eval("document.querySelector('#demo .no').click()");
    expect(await tab.eval<boolean>("qdoor.starts().demo.open")).toBe(false);
    // an agent's first read names the lanes and where each starts; an id nothing has is answered with the ids
    const offers = await tab.eval<{ lanes: { id: string; start: { href: string }; apps: { id: string }[] }[] }>("window.__commands.run('qdoor_offers')");
    expect(offers.lanes.map((l) => [l.id, l.start.href, l.apps.length])).toEqual(SECTORS.map((s) => [s.id, s.start.href, PATHS.filter((p) => p.sector === s.id).length]));
    expect(await tab.eval<{ ok: boolean; ids: string[] }>("window.__commands.run('qdoor_open', { id: 'tuba' })")).toMatchObject({ ok: false, ids: expect.arrayContaining(["studio", "daw", "mix"]) });
    // Studio's start: a room of your own with no form, and Enter sits you at the keys
    await tab.eval(`document.querySelector('.lane a[data-start="studio"]').click()`);
    await until(tab, `location.pathname === "/jam.html" && new URLSearchParams(location.search).get("sit") === "keys" && !!window.qjam && !!document.getElementById("play")`);
    await tab.eval("document.getElementById('play').click()");
    await until(tab, `qjam.state().phase === "play" && qjam.state().you.seat === "keys"`);
  } finally { await tab.close(); }
});
