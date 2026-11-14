// A shop saves a cap design, then whoever fulfils the order asks for its print files with the admin key: the plan
// lays the original at 300 dpi over the cap front's real size, and the original comes back byte for byte. Without
// the key, neither. Then the page's own drawing maths and the resolution it writes into the PNG.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { PrintPlan } from "../src/api.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";
import { sheetLayout, withDpi } from "../src/print-sheet.ts";

setDefaultTimeout(15_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-print-"));
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir }); });
afterAll(() => { app.stop(); rmSync(dir, { recursive: true, force: true }); });

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const post = (path: string, body: unknown) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://shop.test" }, body: JSON.stringify(body) });

async function upload(kind: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const s = (await (await post("/api/orgs/demo/uploads", { kind, type, size: bytes.length, sha256 })).json()) as { key: string; exists: boolean; put?: { url: string; headers: Record<string, string> } };
  if (!s.exists) expect((await fetch(s.put!.url, { method: "PUT", headers: s.put!.headers, body: bytes })).status).toBe(201);
  return s.key;
}

test("a saved cap design gives the fulfiller a 300 dpi print file of its front, and the original behind it", async () => {
  const original = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const layer = { texture: await upload("texture", "image/webp", new Uint8Array([5, 5])), original: await upload("original", "image/png", original), u: 0.5, v: 0.55, scale: 0.7, rotation: 0.2 };
  const saved = await post("/api/orgs/demo/designs", { v: 1, model: "cap", color: "#1f2937", product: "field-cap", layers: [layer], camera: { azimuth: 0, polar: 1.2, distance: 5.6 } });
  const { id } = (await saved.json()) as { id: string };

  expect((await fetch(`${app.url}/api/orgs/demo/designs/${id}/print`)).status).toBe(401);
  const res = await fetch(`${app.url}/api/orgs/demo/designs/${id}/print`, { headers: admin });
  const plan = PrintPlan(await res.json());
  expect(plan).toMatchObject({ design: id, model: "cap", dpi: 300, skipped: [] });
  // A cap front is 12 x 6 cm: 1417 x 709 px at 300 dpi.
  expect(plan.sheets).toMatchObject([{ zone: "front", cm: { w: 12, h: 6 }, px: { w: 1417, h: 709 }, at: { u: 0.5, v: 0.55, scale: 0.7, rotation: 0.2 } }]);

  const url = plan.sheets[0]!.original;
  expect((await fetch(url)).status).toBe(401);
  expect(new Uint8Array(await (await fetch(url, { headers: admin })).arrayBuffer())).toEqual(original);
});

test("a picture saved without its original is named as not printable, with why", async () => {
  const layer = { texture: await upload("texture", "image/webp", new Uint8Array([6, 6])), zone: "back", u: 0.5, v: 0.5, scale: 0.5, rotation: 0 };
  const saved = await post("/api/orgs/demo/designs", { v: 1, model: "tee", color: "#f5f5f4", product: "crew-tee", layers: [layer], camera: { azimuth: 0, polar: 1.2, distance: 5.6 } });
  const { id } = (await saved.json()) as { id: string };
  const plan = PrintPlan(await (await fetch(`${app.url}/api/orgs/demo/designs/${id}/print`, { headers: admin })).json());
  expect(plan).toMatchObject({ sheets: [], skipped: [{ zone: "back", why: "no original was saved with this picture" }] });
});

test("the picture sits where the shopper put it: u across, v up, scale of the zone's width", () => {
  expect(sheetLayout({ w: 1000, h: 500 }, { u: 0.25, v: 0.75, scale: 0.5, rotation: 0.3 }, 2)).toEqual({ x: 250, y: 125, w: 500, h: 250, rotation: 0.3 });
});

test("the PNG says its dpi, so print software opens it at its real size", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(25).fill(0), 9, 9]);
  const out = withDpi(png, 300);
  expect(new TextDecoder().decode(out.subarray(37, 41))).toBe("pHYs");
  expect(new DataView(out.buffer).getUint32(41)).toBe(11811); // pixels a metre at 300 dpi
  expect(out.subarray(54)).toEqual(new Uint8Array([9, 9]));
});
