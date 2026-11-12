// The home fits the window: on a desktop or a phone the page never scrolls sideways (the rows scroll inside themselves),
// and a phone's tabs sit along the bottom of the screen.
// The library's grid once sized its one column to its widest row, so a normal desktop window had to zoom far out to see it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { AppPage, Home } from "../src/app/pages.tsx";
import { APPS } from "../src/apps.ts";
import type { Studio } from "../src/studios.ts";

setDefaultTimeout(60_000);

const me = { id: "1", email: "a@example.com", name: "Ada" } as never;
// A studio as the Studio tab shows it: a long name, a few people, and a shelf with every kind of door.
const studios: Studio[] = [{ id: "qntbr", name: "QNTBR, a business with a long enough name to wrap", kind: "business", role: "owner", members: 3,
  people: [{ name: "Ada Lovelace-Byron", email: "ada@example.com", role: "owner" }, { name: "Bo", email: "bo@example.com", role: "admin" }, { name: "Cy", email: "cy@example.com", role: "maker" }],
  apps: APPS.slice(0, 8).map((a, i) => ({ id: a.id, name: a.name, play: a.origins[0] ?? null, make: i % 2 ? "qntbr/repo" : null, ship: a.origins.length ? "live" : "not deployed", shipped: i === 0 ? { stage: "production", version: "0.0.1+abc1234", at: Date.UTC(2026, 10, 6, 14, 2) } : null })) }];
const page = (tab: "library" | "studio") => "<!doctype html>" + renderToStaticMarkup(<Document><Home counts={new Map()} t0={0} me={me} mine={undefined} hub={null} everyone={null} unlocks={new Map([[APPS[0]!.id, new Map([["x", 1]])]])} tab={tab} studios={studios} /></Document>);
const game = () => "<!doctype html>" + renderToStaticMarkup(<Document><AppPage app={APPS.find((a) => a.shot) ?? APPS[0]!} mine={undefined} unlocks={new Map()} t0={0} /></Document>);
const srv = Bun.serve({ port: 0, fetch: async (r) => {
  const p = new URL(r.url).pathname, file = Bun.file(join(import.meta.dir, "../public", p));
  if (p === "/app") return new Response(game(), { headers: { "content-type": "text/html" } });
  if (p === "/" || p === "/studio") return new Response(page(p === "/" ? "library" : "studio"), { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); srv.stop(); });

test("the library, the Studio tab and a game's page are no wider than the window, desktop to phone", async () => {
  for (const path of ["/", "/studio", "/app"])
    for (const [w, h, mobile] of [[1512, 945, false], [1440, 900, false], [1000, 800, false], [768, 1024, true], [414, 896, true], [390, 844, true], [320, 640, true]] as const) {
      const tab = await openTab(chrome.cdp, { w, h }, mobile);
      await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}${path}`, 500);
      expect({ path, w, page: await tab.eval<number>("document.documentElement.scrollWidth") }).toEqual({ path, w, page: w });
      // On a phone the tabs are a bar along the bottom of the screen, under the thumb; wider, they sit with the greeting.
      if (w <= 640 && path !== "/app") expect({ path, w, bar: await tab.eval<number>("Math.round(document.querySelector('.home .tabs').getBoundingClientRect().bottom)") }).toEqual({ path, w, bar: h });
      await tab.close();
    }
});

// A game's page uses a wide window: the picture takes most of it with the words beside, and a margin either side stays clear
// for a streamer's camera or chat. On a phone the words go under the picture.
test("a game's page puts its picture beside the words on a wide window and above them on a phone", async () => {
  const where = `(() => { const s = document.querySelector(".shot").getBoundingClientRect(), w = document.querySelector(".words").getBoundingClientRect();
    return { beside: w.left >= s.right, under: w.top >= s.bottom, shot: Math.round(s.width), gutter: Math.round(document.querySelector(".pane").getBoundingClientRect().left) }; })()`;
  for (const [w, h, mobile] of [[1920, 1080, false], [1440, 900, false], [390, 844, true]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/app`, 500);
    const at = await tab.eval<{ beside: boolean; under: boolean; shot: number; gutter: number }>(where);
    if (mobile) expect({ w, under: at.under }).toEqual({ w, under: true });
    else {
      expect({ w, beside: at.beside, wide: at.shot > w * 0.45 }).toEqual({ w, beside: true, wide: true });
      expect(at.gutter).toBeGreaterThan(w * 0.04);
    }
    await tab.close();
  }
});
