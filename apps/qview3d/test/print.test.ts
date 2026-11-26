// A shop's store posts an order for a cap and a tee, and its receiver gets order.ready with finished print files: the
// server made one PNG per zone, at 300 dpi over the zone's real size, the picture where the shopper put it. Each is
// the PNG the admin page draws in Chrome (print-sheet.ts drawSheet), to a pixel or two. Without the admin key, none.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import encodeJpeg from "@jsquash/jpeg/encode";
import encodePng from "@jsquash/png/encode";
import { hex } from "@rustybuns/util/bytes";
import { chromeStartMs, launchChrome, load, openTab, type Tab } from "../../../scripts/chrome.ts";
import { HookEvent, HookReply, PrintPlan, type PrintSheet } from "../src/api.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";
import { decodePicture, type Picture } from "../src/print-render.ts";
import { withDpi } from "../src/print-sheet.ts";

setDefaultTimeout(30_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-print-"));
const events: string[] = [];
const receiver = Bun.serve({ port: 0, async fetch(req) { events.push(await req.text()); return new Response("ok"); } });
let app: Awaited<ReturnType<typeof local>>;
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let tab: Tab;
beforeAll(async () => {
  app = await local({ dir });
  chrome = await launchChrome();
  tab = await openTab(chrome.cdp, { w: 400, h: 300 });
  await load(chrome.cdp, tab, `${app.url}/llms.txt`, 0); // this origin, so the page may fetch originals with the key
  // The admin page's own drawing, as it bundles it.
  await Bun.write(join(dir, "page.ts"), `import { drawSheet, withDpi } from ${JSON.stringify(join(import.meta.dir, "../src/print-sheet.ts"))};\nObject.assign(globalThis, { drawSheet, withDpi });`);
  const built = await Bun.build({ entrypoints: [join(dir, "page.ts")], target: "browser" });
  await tab.eval(`${await built.outputs[0]!.text()}\n;0`);
}, chromeStartMs + 30_000); // past Chrome's start-or-explain budget, so a stall on a cold CI runner gets its retry and says why (#6241)
afterAll(() => { chrome?.stop(); app?.stop(); receiver.stop(true); rmSync(dir, { recursive: true, force: true }); });

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const call = (path: string, body: unknown, h: Record<string, string> = admin) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://shop.test", ...h }, body: JSON.stringify(body) });

async function upload(kind: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const s = (await (await call("/api/orgs/demo/uploads", { kind, type, size: bytes.length, sha256 }, {})).json()) as { key: string; exists: boolean; put?: { url: string; headers: Record<string, string> } };
  if (!s.exists) expect((await fetch(s.put!.url, { method: "PUT", headers: s.put!.headers, body: bytes })).status).toBe(201);
  return s.key;
}

/** A shopper's picture: a soft gradient with a block in one corner (so a flip or a turn shows), its corner `clear` cut out. */
function picture(w: number, h: number, clear: boolean) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, block = x < w / 3 && y < h / 3;
    data.set([block ? 20 : (255 * x) / w, block ? 160 : (255 * y) / h, block ? 60 : 140, clear && x > w * 0.8 && y > h * 0.8 ? 0 : 255], i);
  }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

type At = PrintSheet["pictures"][number]["at"];
/** A saved design with these pictures on one zone, in drawing order. */
async function design(model: string, product: string, zone: string, pictures: { type: string; bytes: Uint8Array<ArrayBuffer>; at: At }[]) {
  const layers = await Promise.all(pictures.map(async (p, i) => ({ texture: await upload("texture", "image/webp", new Uint8Array([zone.length, i])), original: await upload("original", p.type, p.bytes), zone, ...p.at })));
  const res = await call("/api/orgs/demo/designs", { v: 1, model, color: "#1f2937", product, layers, camera: { azimuth: 0, polar: 1.2, distance: 5.6 } }, {});
  return ((await res.json()) as { id: string }).id;
}

/** The sheet as the admin page draws it in Chrome: its originals fetched with the key, drawn, its dpi written in. */
async function drawnInChrome(s: PrintSheet) {
  const b64 = await tab.eval<string>(`(async () => {
    const s = ${JSON.stringify(s)};
    const images = await Promise.all(s.pictures.map(async (p) => {
      const image = await createImageBitmap(await (await fetch(p.original, { headers: ${JSON.stringify(admin)} })).blob());
      return { image, aspect: image.width / image.height };
    }));
    const canvas = new OffscreenCanvas(s.px.w, s.px.h);
    drawSheet(canvas.getContext("2d"), s, images);
    const png = withDpi(new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()), 300);
    let out = "";
    for (let i = 0; i < png.length; i += 0x8000) out += String.fromCharCode(...png.subarray(i, i + 0x8000));
    return btoa(out);
  })()`);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const ppm = (png: Uint8Array) => (new TextDecoder().decode(png.subarray(37, 41)) === "pHYs" ? new DataView(png.buffer, png.byteOffset).getUint32(41) : 0);
/** Where the picture's solid part sits: its box, from the pixels at least half covered. */
function box(p: Picture) {
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    if (p.data[(y * p.width + x) * 4 + 3]! < 128) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
/** The mean colour difference over pixels both draw solid. */
function colourGap(a: Picture, b: Picture) {
  let sum = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i + 3] !== 255 || b.data[i + 3] !== 255) continue;
    sum += Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    n += 3;
  }
  return { gap: sum / n, solid: n / 3 };
}

test("an order's print files are made on the server, the same PNGs the admin page draws", async () => {
  const hook = HookReply(await (await call("/api/orgs/demo/hooks", { url: `http://localhost:${receiver.port}/qv`, events: ["order.ready"] })).json());
  expect(hook.secret).toStartWith("whsec_");
  // A cap with a PNG that has a clear corner, a little turned; a tee front with a JPEG photo turned the other way and,
  // over its corner, a small PNG (a line of text arrives as one): one sheet, each picture where the shopper put it.
  const png = new Uint8Array(await encodePng(picture(800, 400, true)));
  const cap = await design("cap", "field-cap", "front", [{ type: "image/png", bytes: png, at: { u: 0.5, v: 0.55, scale: 0.7, rotation: 0.2 } }]);
  const tee = await design("tee", "crew-tee", "front", [
    { type: "image/jpeg", bytes: new Uint8Array(await encodeJpeg(picture(1200, 1500, false), { quality: 92 })), at: { u: 0.45, v: 0.6, scale: 0.8, rotation: -0.35 } },
    { type: "image/png", bytes: png, at: { u: 0.7, v: 0.2, scale: 0.4, rotation: 0.1 } },
  ]);

  expect((await call("/api/orgs/demo/orders", { id: "#2001", lines: [{ design: cap }, { design: tee, qty: 3 }] })).status).toBe(201);
  const ready = HookEvent(JSON.parse(events.at(-1)!));
  expect(ready).toMatchObject({ type: "order.ready", data: { order: "#2001" } });
  const sheets = ready.data.lines!.map((l) => l.sheets[0]!);
  // A cap front is 12 x 6 cm and a tee front 30 x 40 cm: at 300 dpi, these many pixels.
  expect(sheets.map((s) => [s.zone, s.px.w, s.px.h, s.pictures.length, s.unmade])).toEqual([["front", 1417, 709, 1, undefined], ["front", 3543, 4724, 2, undefined]]);
  expect(sheets[1]!.pictures.map((p) => p.at.u)).toEqual([0.45, 0.7]);

  for (const s of sheets) {
    expect((await fetch(s.png!)).status).toBe(401);
    const res = await fetch(s.png!, { headers: admin });
    expect(res.headers.get("content-type")).toBe("image/png");
    const served = new Uint8Array(await res.arrayBuffer());
    const drawn = await drawnInChrome(s);
    expect([ppm(served), ppm(drawn)]).toEqual([11811, 11811]); // pixels a metre at 300 dpi
    const [a, b] = [await decodePicture(served, Infinity), await decodePicture(drawn, Infinity)];
    if (typeof a === "string" || typeof b === "string") throw new Error(`${a} ${b}`);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    const [ba, bb] = [box(a), box(b)];
    for (let k = 0; k < 4; k++) expect(Math.abs(ba[k]! - bb[k]!)).toBeLessThanOrEqual(2);
    const { gap, solid } = colourGap(a, b);
    expect(solid).toBeGreaterThan(a.width * a.height * 0.3);
    expect(gap).toBeLessThan(3); // out of 255: the same picture, sampled a little differently
  }

  // The plan an admin asks for later links the same files, made once.
  const plan = PrintPlan(await (await fetch(`${app.url}/api/orgs/demo/designs/${cap}/print`, { headers: admin })).json());
  expect(plan.sheets[0]!.png).toBe(sheets[0]!.png);
});

test("a picture saved without its original is named as not printable, with why", async () => {
  const layer = { texture: await upload("texture", "image/webp", new Uint8Array([6, 6])), zone: "back", u: 0.5, v: 0.5, scale: 0.5, rotation: 0 };
  const saved = await call("/api/orgs/demo/designs", { v: 1, model: "tee", color: "#f5f5f4", product: "crew-tee", layers: [layer], camera: { azimuth: 0, polar: 1.2, distance: 5.6 } }, {});
  const { id } = (await saved.json()) as { id: string };
  const plan = PrintPlan(await (await fetch(`${app.url}/api/orgs/demo/designs/${id}/print`, { headers: admin })).json());
  expect(plan).toMatchObject({ sheets: [], skipped: [{ zone: "back", why: "no original was saved with this picture" }] });
});

test("the PNG says its dpi, so print software opens it at its real size", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(25).fill(0), 9, 9]);
  const out = withDpi(png, 300);
  expect(new TextDecoder().decode(out.subarray(37, 41))).toBe("pHYs");
  expect(new DataView(out.buffer).getUint32(41)).toBe(11811); // pixels a metre at 300 dpi
  expect(out.subarray(54)).toEqual(new Uint8Array([9, 9]));
});
