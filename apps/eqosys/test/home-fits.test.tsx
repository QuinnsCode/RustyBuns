// The home fits the window: on a desktop or a phone the page never scrolls sideways (the rows scroll inside themselves).
// The library's grid once sized its one column to its widest row, so a normal desktop window had to zoom far out to see it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { Home } from "../src/app/pages.tsx";

setDefaultTimeout(60_000);

const html = "<!doctype html>" + renderToStaticMarkup(<Document><Home counts={new Map()} t0={0} me={{ id: "1", email: "a@example.com", name: "Ada" } as never} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="library" /></Document>);
const srv = Bun.serve({ port: 0, fetch: async (r) => {
  const p = new URL(r.url).pathname, file = Bun.file(join(import.meta.dir, "../public", p));
  if (p === "/") return new Response(html, { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(); });
afterAll(() => { chrome?.stop(); srv.stop(); });

test("the library is no wider than the window, desktop to phone", async () => {
  for (const [w, h, mobile] of [[1440, 900, false], [1000, 800, false], [390, 844, true]] as const) {
    const tab = await openTab(chrome.cdp, { w, h }, mobile);
    await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/`, 500);
    expect({ w, page: await tab.eval<number>("document.documentElement.scrollWidth") }).toEqual({ w, page: w });
    await tab.close();
  }
});
