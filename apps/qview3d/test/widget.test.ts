// The widget as a shopper meets it: the demo shop in headless Chrome, served by the Worker on the local R2 twin with
// the widget built the way a deploy builds it. Put a picture on the cap, drag it across the fabric with the mouse,
// nudge it with an arrow key, save, and find the design in the bucket where the picture was left.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";
import { Design, PrintPlan } from "../src/api.ts";
import { designKey } from "../src/layout.ts";
import { putOrg, putProduct } from "../src/settings.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";

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

// The product page as a shop would build it: pick the hat, the shirt and the hoodie in turn, print on every zone,
// press Add to cart, and the form arrives with the saved design's id (the widget is a field in it, name="design").
test("the hat, the shirt and the hoodie each go in the cart with their design id", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await load(chrome.cdp, tab, `${app.url}/`, 500);
  await until("the widget ready", () => tab.eval<boolean>(`!!${HAT}.design`));
  const picks = [
    { product: "field-cap", model: "cap", zones: ["front"] },
    { product: "crew-tee", model: "tee", zones: ["front", "back", "left-sleeve"] },
    { product: "pullover-hoodie", model: "hoodie", zones: ["front", "back", "left-sleeve"] },
  ];
  for (const [n, p] of picks.entries()) {
    await tab.eval(`document.querySelector('[data-product="${p.product}"]').click()`);
    await until(`the ${p.model}`, () => tab.eval<boolean>(`${HAT}.model === "${p.model}" && !!${HAT}.design`));
    await tab.eval(`(async () => {
      const c = new OffscreenCanvas(128, 128), g = c.getContext("2d");
      g.fillStyle = "#1d4ed8"; g.fillRect(0, 0, 128, 128);
      for (const z of ${JSON.stringify(p.zones)}) await ${HAT}.addImage(await c.convertToBlob({ type: "image/png" }), z);
    })()`);
    await tab.eval(`document.getElementById("buy").click()`);
    const line = await until(`${p.product} in the cart`, () => tab.eval<Record<string, string> | null>(`window.demoCart?.[${n}] ?? null`));
    expect(line).toMatchObject({ product: p.product, qty: "1", design: await tab.eval<string>(`${HAT}.value`) });
    expect(line["design-url"]).toEndWith(`/r/${designKey("demo", line.design!)}`);
    const stored = Design(JSON.parse((await (await app.bindings.BUCKET.get(designKey("demo", line.design!)))?.text()) ?? "null"));
    expect(stored).toMatchObject({ model: p.model, product: p.product });
    // The cap's picture stays on the shirt's front when the shopper switches; each zone they printed on is there.
    expect([...new Set(stored!.layers.map((l): string => l.zone ?? "front"))].sort()).toEqual([...p.zones].sort());
  }
  expect(tab.noise).toEqual([]);
  await tab.close();
});

// A site builder that strips scripts gets the iframe: the shop's page hears the widget's events through
// postMessage, and asks it for a snapshot the same way.
test("the iframe tells the page round it what the widget does", async () => {
  const shop = Bun.serve({ port: 0, fetch: () => new Response(`<!doctype html><body><iframe src="${app.url}/v1/frame?org=demo&product=crew-tee" style="width:600px;height:500px;border:0"></iframe>
    <script>window.heard = []; addEventListener("message", (e) => { if (e.data?.source === "qview3d") window.heard.push({ type: e.data.type, from: e.origin, detail: e.data.detail }); });</script>`, { headers: { "content-type": "text/html" } }) });
  try {
    const tab = await openTab(chrome.cdp, { w: 800, h: 600 });
    await load(chrome.cdp, tab, `http://127.0.0.1:${shop.port}/`, 500);
    await until("qview:ready from the frame", () => tab.eval<boolean>(`window.heard.some((m) => m.type === "qview:ready")`));
    await tab.eval(`document.querySelector("iframe").contentWindow.postMessage({ source: "qview3d", type: "snapshot" }, "*")`);
    const shot = await until("a snapshot from the frame", () => tab.eval<{ from: string; size: number } | null>(`(() => { const m = window.heard.find((m) => m.type === "qview:snapshot"); return m ? { from: m.from, size: m.detail.blob.size, model: m.detail.design.model } : null; })()`));
    expect(shot).toMatchObject({ from: new URL(app.url).origin, model: "tee" });
    expect(shot.size).toBeGreaterThan(1000);
    await tab.close();
  } finally { await shop.stop(true); }

  // A shop's own org may only be framed by its own sites.
  await putOrg(app.bindings, "shop", { origins: ["https://shop.example"], admins: [], samples: 0 });
  const res = await fetch(`${app.url}/v1/frame?org=shop&product=crew-tee`);
  expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://shop.example");
  expect((await fetch(`${app.url}/v1/frame?org=nobody&product=crew-tee`)).status).toBe(404);
});

// A shop switched the tee's sleeve off and set where a new picture lands (/orgs.html): the widget offers only the
// front and back, and the picture starts at the shop's spot.
test("a product's print zones and starting place shape what the shopper gets", async () => {
  await putProduct(app.bindings, "demo", "front-back-tee", { name: "Front and back tee", model: "tee", colors: ["#f5f5f4"], print: ["front", "back"], place: { u: 0.5, v: 0.7, scale: 0.3, rotation: 0 } });
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  await load(chrome.cdp, tab, `${app.url}/`, 500);
  await tab.eval(`${HAT}.removeAttribute("model"); ${HAT}.setAttribute("product", "front-back-tee")`);
  await until("the tee", () => tab.eval<boolean>(`${HAT}.model === "tee" && !!${HAT}.design`));
  const zones = await until("its zone buttons", () => tab.eval<string>(`[...${HAT}.shadowRoot.querySelectorAll("[data-zone]")].map((b) => b.dataset.zone).join(",")`));
  expect(zones).toBe("front,back");
  await tab.eval(`(async () => { const c = new OffscreenCanvas(64, 64); c.getContext("2d").fillRect(0, 0, 64, 64); await ${HAT}.addImage(await c.convertToBlob({ type: "image/png" })); })()`);
  expect(await layer(tab)).toMatchObject({ u: 0.5, v: 0.7, scale: 0.3 });
  // A sleeve picture a page asks for anyway is refused, not printed where the shop said no.
  expect(await tab.eval<string>(`${HAT}.addImage(new Blob(["x"], { type: "image/png" }), "left-sleeve").then(() => "added", (e) => e.message)`)).toContain("left-sleeve");
  await tab.close();
});

// A shirt front with two photos and a line of text: the shopper adds them, rewrites the text, picks the first photo
// and brings it forward, removes the second, and saves. The design keeps them in drawing order, the text and all, and
// the print plan lays each one's original on the front's one sheet, where the shopper put it.
test("a shopper puts photos and a line of text on one shirt front, restacks them, and each prints", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  await load(chrome.cdp, tab, `${app.url}/`, 500);
  await tab.eval(`document.querySelector('[data-product="crew-tee"]').click()`);
  await until("the tee", () => tab.eval<boolean>(`${HAT}.model === "tee" && !!${HAT}.design`));
  const UI = (sel: string) => `${HAT}.shadowRoot.querySelector(${JSON.stringify(sel)})`;
  await tab.eval(`(async () => {
    for (const [colour, u] of [["#1d4ed8", 0.35], ["#16a34a", 0.65]]) {
      const c = new OffscreenCanvas(128, 128), g = c.getContext("2d");
      g.fillStyle = colour; g.fillRect(0, 0, 128, 128);
      await ${HAT}.addImage(await c.convertToBlob({ type: "image/png" }));
      ${HAT}.place({ u, v: 0.6, scale: 0.3 });
    }
  })()`);
  // The Add text button puts a line on and hands the shopper its words to type over.
  await tab.eval(`${UI('[title="Add text"]')}.click()`);
  await until("the text box focused", () => tab.eval<boolean>(`${HAT}.shadowRoot.activeElement === ${UI(".editor input")}`));
  await tab.call("Input.insertText", { text: "Fern & Co" });
  const lines = (d: string) => tab.eval<{ text?: { value: string }; u: number }[]>(`${HAT}.design.layers.map((l) => ({ text: l.text, u: l.u }))`).then((ls) => (ls.some((l) => l.text?.value === d) ? ls : null));
  await until("the new words on the shirt", () => lines("Fern & Co"));
  await tab.eval(`${HAT}.place({ v: 0.25, scale: 0.6 })`);

  // Three chips, bottom first; pick the blue photo and bring it forward once, past the green one.
  expect(await tab.eval<number>(`${UI(".stack")}.children.length`)).toBe(3);
  await tab.eval(`${UI(".stack")}.children[0].click()`);
  await tab.eval(`${UI('[title="Bring forward"]')}.click()`);
  const order = await tab.eval<number[]>(`${HAT}.design.layers.map((l) => l.u)`);
  expect(order.map((u) => Math.round(u * 100))).toEqual([65, 35, 50]);
  // Pick the green one (now at the bottom) and remove it.
  await tab.eval(`${UI(".stack")}.children[0].click()`);
  await tab.eval(`${UI('[title="Remove it"]')}.click()`);
  expect(await tab.eval<number>(`${UI(".stack")}.children.length`)).toBe(2);

  const saved = await tab.eval<{ id: string }>(`${HAT}.save().then((s) => ({ id: s.id }))`);
  const stored = Design(JSON.parse((await (await app.bindings.BUCKET.get(designKey("demo", saved.id)))?.text()) ?? "null"))!;
  expect(stored.layers.map((l) => [Math.round(l.u * 100), l.text?.value])).toEqual([[35, undefined], [50, "Fern & Co"]]);
  expect(stored.layers[1]!.text).toMatchObject({ font: "sans" });

  const plan = PrintPlan(await (await fetch(`${app.url}/api/orgs/demo/designs/${saved.id}/print`, { headers: { authorization: `Bearer ${DEMO_ADMIN}` } })).json());
  expect(plan.sheets.map((s) => [s.zone, s.unmade])).toEqual([["front", undefined]]);
  expect(plan.sheets[0]!.pictures.map((p) => [p.original.split("/").pop(), Math.round(p.at.u * 100), p.at.scale])).toEqual(
    stored.layers.map((l) => [l.original!.split("/").pop(), Math.round(l.u * 100), l.scale]));
  expect(tab.noise).toEqual([]);
  await tab.close();
});
