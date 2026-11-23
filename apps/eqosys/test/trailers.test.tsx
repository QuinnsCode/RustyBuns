// An app's clips (scripts/trailers.ts cuts them into public/trailers): its page plays them one after another and the strip
// picks one; a tile on the home starts its clip once the pointer rests on it, and stops when it leaves.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { launchChrome, load, openTab } from "../../../scripts/chrome.ts";
import { Document } from "../src/app/Document.tsx";
import { AppPage, Home } from "../src/app/pages.tsx";
import { APPS } from "../src/apps.ts";
import { clipsOf } from "../src/trailers.ts";

setDefaultTimeout(60_000);

const app = APPS.find((a) => clipsOf(a.id).length > 1)!;
const me = { id: "1", email: "a@example.com", name: "Ada" } as never;
const built = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/app/trailers.client.ts")], format: "esm" });
const script = (await built.outputs[0]!.text()).replace(/export\s*\{[^}]*\};?\s*$/, "") + "\nmountTiles(document); window.__reel = mountReel(document);";
const page = (body: React.ReactNode) => "<!doctype html>" + renderToStaticMarkup(<Document>{body}</Document>).replace(/<script[^>]*commands\.client[^>]*><\/script>/, `<script>${script}</script>`);
const srv = Bun.serve({ port: 0, fetch: async (r) => {
  const p = new URL(r.url).pathname, file = Bun.file(join(import.meta.dir, "../public", p));
  if (p === "/app") return new Response(page(<AppPage app={app} mine={undefined} unlocks={new Map()} t0={0} />), { headers: { "content-type": "text/html" } });
  if (p === "/") return new Response(page(<Home counts={new Map()} t0={0} me={me} mine={undefined} hub={null} everyone={null} unlocks={new Map()} tab="library" studios={[]} />), { headers: { "content-type": "text/html" } });
  return (await file.exists()) ? new Response(file) : new Response("", { status: 404 });
} });

let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => { chrome = await launchChrome(["--autoplay-policy=no-user-gesture-required"]); });
afterAll(() => { chrome?.stop(); srv.stop(); });

test("an app's page plays its first clip, and a pick in the strip plays that one", async () => {
  const tab = await openTab(chrome.cdp, { w: 1440, h: 900 });
  await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/app`, 1500);
  const clips = clipsOf(app.id);
  expect(await tab.eval<unknown>("window.__reel.state()")).toEqual({ playing: clips[0]!.src, clips: clips.length });
  await tab.eval(`document.querySelectorAll("[data-pick]")[1].click()`);
  await Bun.sleep(800);
  expect(await tab.eval<unknown>("window.__reel.state()")).toEqual({ playing: clips[1]!.src, clips: clips.length });
  expect(await tab.eval<unknown>(`[...document.querySelectorAll("[data-pick]")].map((b) => b.getAttribute("aria-pressed"))`)).toEqual(clips.map((_, i) => String(i === 1)));
  await tab.close();
});

test("a tile starts its clip when the pointer rests on it and drops it when the pointer leaves", async () => {
  const tab = await openTab(chrome.cdp, { w: 1440, h: 900 });
  await load(chrome.cdp, tab, `http://127.0.0.1:${srv.port}/`, 800);
  const at = await tab.eval<{ x: number; y: number }>(`(() => { const e = document.querySelector(".game [data-clip]"); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await tab.call("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
  await Bun.sleep(1500);
  expect(await tab.eval<unknown>(`(() => { const v = document.querySelector(".game video.clip"); return v ? { playing: !v.paused, src: new URL(v.src).pathname === v.closest("[data-clip]").dataset.clip } : null; })()`)).toEqual({ playing: true, src: true });
  await tab.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await Bun.sleep(200);
  expect(await tab.eval<number>(`document.querySelectorAll("video.clip").length`)).toBe(0);
  await tab.close();
});
