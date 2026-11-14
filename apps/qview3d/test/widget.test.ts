// The widget as a shopper meets it: the demo shop in headless Chrome, served by the Worker on the local R2 twin with
// the widget built the way a deploy builds it. Put a picture on the cap, drag it across the fabric with the mouse,
// nudge it with an arrow key, save, and find the design in the bucket where the picture was left.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";
import { Design } from "../src/api.ts";
import { designKey } from "../src/layout.ts";
import { local } from "../src/local.ts";

setDefaultTimeout(120_000);

const root = join(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "qview3d-widget-"));
let app: Awaited<ReturnType<typeof local>>;
let chrome: Awaited<ReturnType<typeof launchChrome>>;
beforeAll(async () => {
  await build({ root, logLevel: "error", build: { outDir: join(dir, "client"), emptyOutDir: true } });
  app = await local({ dir, assets: join(dir, "client") });
  chrome = await launchChrome();
});
afterAll(() => { chrome?.stop(); app?.stop(); rmSync(dir, { recursive: true, force: true }); });

const HAT = `document.querySelector("qview-3d")`;
const CANVAS = `${HAT}.shadowRoot.querySelector("canvas")`;

async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(250);
  }
}

const layer = (tab: Tab) => tab.eval<{ u: number; v: number } | null>(`(${HAT}.design?.layers[0] ?? null)`);
const mouse = (tab: Tab, type: string, x: number, y: number, held = false) =>
  tab.call("Input.dispatchMouseEvent", { type, x, y, button: held || type !== "mouseMoved" ? "left" : "none", buttons: held || type === "mousePressed" ? 1 : 0, clickCount: 1 });

/** Where the picture sits on screen: the middle of the spots where hovering shows the grab cursor. */
async function findPicture(tab: Tab) {
  const r = await tab.eval<{ x: number; y: number; w: number; h: number }>(`(() => { const r = ${CANVAS}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const hits: [number, number][] = [];
  for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
    const x = r.x + (r.w * i) / 24, y = r.y + (r.h * j) / 24;
    await mouse(tab, "mouseMoved", x, y);
    if (await tab.eval<string>(`${CANVAS}.style.cursor`) === "grab") hits.push([x, y]);
  }
  if (!hits.length) return null;
  return { x: hits.reduce((s, h) => s + h[0], 0) / hits.length, y: hits.reduce((s, h) => s + h[1], 0) / hits.length, w: r.w };
}

test("a shopper puts a picture on the cap, drags it, nudges it, and saves it", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  await load(chrome.cdp, tab, `${app.url}/`, 500);
  await until("the widget ready", () => tab.eval<boolean>(`!!${HAT}.design`));

  // A picture made on the spot, as a phone photo would arrive: a PNG blob.
  await tab.eval(`(async () => {
    const c = new OffscreenCanvas(256, 256), g = c.getContext("2d");
    g.fillStyle = "#ff5a1f"; g.fillRect(0, 0, 256, 256); g.fillStyle = "#fff"; g.fillRect(64, 64, 128, 128);
    await ${HAT}.addImage(await c.convertToBlob({ type: "image/png" }));
  })()`);
  const start = await until("a picture on the cap", () => layer(tab));

  // The camera swings to the front first; then hover finds the picture and the mouse drags it.
  const spot = await until("the picture under the mouse", () => findPicture(tab));
  await mouse(tab, "mousePressed", spot.x, spot.y);
  for (let k = 1; k <= 8; k++) await mouse(tab, "mouseMoved", spot.x + (spot.w * 0.08 * k) / 8, spot.y + 4 * k, true);
  await mouse(tab, "mouseReleased", spot.x + spot.w * 0.08, spot.y + 32);
  const dragged = (await layer(tab))!;
  expect(Math.hypot(dragged.u - start.u, dragged.v - start.v)).toBeGreaterThan(0.02);

  // The keyboard way (focus the view, then the arrows) moves it too.
  await tab.eval(`${CANVAS}.focus()`);
  for (const type of ["keyDown", "keyUp"]) await tab.call("Input.dispatchKeyEvent", { type, key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 });
  const nudged = (await layer(tab))!;
  expect(Math.hypot(nudged.u - dragged.u, nudged.v - dragged.v)).toBeGreaterThan(0.001);

  // Save, the way the shop's button does; the bucket holds the design where the picture was left, and its files.
  const saved = await tab.eval<{ id: string }>(`${HAT}.save().then((s) => ({ id: s.id }))`);
  const stored = Design(JSON.parse((await (await app.bindings.BUCKET.get(designKey("demo", saved.id)))?.text()) ?? "null"));
  expect(stored).toMatchObject({ model: "cap", product: "field-cap" });
  expect(stored!.layers[0]).toMatchObject({ u: nudged.u, v: nudged.v });
  for (const key of [stored!.layers[0]!.texture, stored!.layers[0]!.original, stored!.snapshot]) expect(await app.bindings.BUCKET.head(key!)).not.toBeNull();
  expect(tab.noise).toEqual([]);
  await tab.close();
});
