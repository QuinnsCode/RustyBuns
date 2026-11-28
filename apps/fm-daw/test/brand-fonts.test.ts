// Qollab's two faces on every page (src/brand.css): Russo One, the thick one, and Exo 2, the thin one. Each page is opened
// signed out in headless Chrome and asked which face each piece of text on screen is set in.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(300_000); // eleven pages, three of them 3D rooms drawn in software on CI's runners
useBrowser();

const PAGES = ["door.html", "index.html", "amp.html", "builder.html", "decks.html", "jam.html", "listen.html", "remote.html", "rooms.html", "speakers.html", "studio.html"];
/** Besides the two (a circuit's drawing keeps its own lettering, so text inside an svg isn't asked): readouts stay in the mono face, and the Cmd+K button (shared with every app) wears the system's. */
const ALSO = ["IBM Plex Mono", "system-ui"];
const BRAND_LOADED = `document.readyState === "complete" && [...document.fonts].some((f) => f.status === "loaded" && /Exo 2|Russo One/.test(f.family))`;
const FACES = `[...new Set([...document.querySelectorAll("body *")]
  .filter((el) => !el.closest("svg") && el.getClientRects().length &&[...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
  .map((el) => getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim()))]`;

test.skipIf(!hasChrome)("every page's text is in Russo One or Exo 2", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  try {
    for (const page of PAGES) {
      await load(chrome.cdp, tab, `${vite.url}${page}`, 0);
      await until(tab, BRAND_LOADED, FACES, 60_000);
      const faces = await tab.eval<string[]>(FACES);
      expect({ page, others: faces.filter((f) => f !== "Russo One" && f !== "Exo 2" && !ALSO.includes(f)) }).toEqual({ page, others: [] });
      expect(faces.some((f) => f === "Russo One" || f === "Exo 2")).toBe(true);
    }
  } finally { await tab.close(); }
});
