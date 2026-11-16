// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Print files, for whoever fulfils an order. Both routes need an admin key: originals are the print source and
// are never served on /r/.
//
//   GET /api/orgs/<org>/designs/<id>/print   the plan: per zone, its real size, its pixels at 300 dpi, where the picture sits
//   GET /api/orgs/<org>/designs/<id>/print/<zone>.png   that zone's print file, made by the plan
//   GET /api/orgs/<org>/originals/<file>     one original, as uploaded
//
// The plan makes each zone's PNG once (print-render.ts) and keeps it at orgs/<org>/prints/<design>/<zone>.png; a design
// is named by its own content, so its files never go stale. An order (hooks.ts) asks for the plan, so order.ready
// carries finished files. One the server can't make (an original too big for a Worker) says why, and the admin page
// draws it from the original instead (print-sheet.ts).
import { privateJson, readJson } from "@rustybuns/util/http";
import { Design, PRINT_CM, ZONES, Product, type Model, type PrintPlan, type PrintSheet, type ZoneName } from "./api.ts";
import { designKey } from "./layout.ts";
import { getProduct } from "./settings.ts";
import { sheetPx } from "./print-sheet.ts";
import { decodePicture, renderSheet } from "./print-render.ts";
import type { Env } from "./worker.ts";

export const PRINT_DPI = 300;
const DESIGN_ID = /^[0-9a-f]{24}$/;
const ORIGINAL = /^[0-9a-f]{64}\.(png|jpg|webp)$/;
export const printKey = (org: string, design: string, zone: ZoneName) => `orgs/${org}/prints/${design}/${zone}.png`;

const nope = (why: string, status: number, headers: Record<string, string>) => privateJson({ error: why }, status, headers);

/** The zone's real size: the product's own, else the made product's default. */
function zoneCm(model: Model, product: Product | null, zone: ZoneName) {
  return product?.zones?.[zone] ?? (model === "custom" ? undefined : PRINT_CM[model][zone]);
}

export async function printPlanRoute(env: Env, org: string, id: string, origin: string, headers: Record<string, string>): Promise<Response> {
  if (!DESIGN_ID.test(id)) return nope("unknown design", 404, headers);
  const o = await env.BUCKET.get(designKey(org, id));
  const d = o ? await readJson(new Response(await o.text()), Design) : null;
  if (!d) return nope("unknown design", 404, headers);
  const product = d.product ? await getProduct(env, org, d.product) : null;
  const sheets: PrintSheet[] = [], skipped: PrintPlan["skipped"] = [];
  for (const l of d.layers) {
    const zone = l.zone ?? "front";
    const cm = zoneCm(d.model, product, zone);
    const file = l.original?.split("/").pop();
    if (!l.original || !file || !ORIGINAL.test(file)) skipped.push({ zone, why: "no original was saved with this picture" });
    else if (!cm) skipped.push({ zone, why: `the product names no size for its ${zone}: add zones to its product file` });
    else sheets.push({ zone, cm, px: sheetPx(cm, PRINT_DPI), original: `${origin}/api/orgs/${org}/originals/${file}`, at: { u: l.u, v: l.v, scale: l.scale, rotation: l.rotation } });
  }
  for (const s of sheets) {
    const why = await makePrint(env, org, id, s);
    if (why) s.unmade = why;
    else s.png = `${origin}/api/orgs/${org}/designs/${id}/print/${s.zone}.png`;
  }
  return privateJson({ design: id, model: d.model, dpi: PRINT_DPI, sheets, skipped } satisfies PrintPlan, 200, headers);
}

/** The sheet's PNG in R2, made now unless it is there already; null when it is, else why not. */
async function makePrint(env: Env, org: string, id: string, s: PrintSheet): Promise<string | null> {
  const key = printKey(org, id, s.zone);
  if (await env.BUCKET.head(key)) return null;
  const o = await env.BUCKET.get(`orgs/${org}/originals/${s.original.split("/").pop()}`);
  if (!o) return "its original is gone from the bucket";
  const picture = await decodePicture(new Uint8Array(await new Response(o.body).arrayBuffer()));
  if (typeof picture === "string") return picture;
  const png = await renderSheet(s, picture, PRINT_DPI);
  await env.BUCKET.put(key, png.buffer, { httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" } });
  return null;
}

/** One zone's print file, once the plan made it. */
export async function printFileRoute(env: Env, org: string, id: string, zone: string, headers: Record<string, string>): Promise<Response> {
  const z = ZONES.find((n) => n === zone);
  if (!DESIGN_ID.test(id) || !z) return nope("unknown print file", 404, headers);
  const o = await env.BUCKET.get(printKey(org, id, z));
  if (!o) return nope("no print file yet: ask for the design's print plan first", 404, headers);
  return new Response(o.body, { headers: { ...headers, "content-type": "image/png", "cache-control": "private, no-store" } });
}

export async function originalRoute(env: Env, org: string, file: string, headers: Record<string, string>): Promise<Response> {
  if (!ORIGINAL.test(file)) return nope("unknown file", 404, headers);
  const o = await env.BUCKET.get(`orgs/${org}/originals/${file}`);
  if (!o) return nope("unknown file", 404, headers);
  const h = new Headers(headers);
  o.writeHttpMetadata(h);
  h.set("cache-control", "private, no-store");
  return new Response(o.body, { headers: h });
}
