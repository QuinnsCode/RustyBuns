// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Print files, for whoever fulfils an order. Both routes need an admin key: originals are the print source and
// are never served on /r/.
//
//   GET /api/orgs/<org>/designs/<id>/print   the plan: per zone, its real size, its pixels at 300 dpi, where the picture sits
//   GET /api/orgs/<org>/originals/<file>     one original, as uploaded
//
// The pixels themselves are drawn where there is a canvas: the admin page (print-sheet.ts), one PNG per zone.
import { privateJson, readJson } from "@rustybuns/util/http";
import { Design, PRINT_CM, Product, type Model, type PrintPlan, type PrintSheet, type ZoneName } from "./api.ts";
import { DEMO_PRODUCTS } from "./demo.ts";
import { designKey, productKey } from "./layout.ts";
import { sheetPx } from "./print-sheet.ts";
import type { Env } from "./worker.ts";

export const PRINT_DPI = 300;
const DESIGN_ID = /^[0-9a-f]{24}$/;
const ORIGINAL = /^[0-9a-f]{64}\.(png|jpg|webp)$/;

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
  let product: Product | null = null;
  if (d.product) {
    const p = await env.BUCKET.get(productKey(org, d.product));
    product = p ? await readJson(new Response(await p.text()), Product) : (DEMO_PRODUCTS[d.product] ?? null);
  }
  const sheets: PrintSheet[] = [], skipped: PrintPlan["skipped"] = [];
  for (const l of d.layers) {
    const zone = l.zone ?? "front";
    const cm = zoneCm(d.model, product, zone);
    const file = l.original?.split("/").pop();
    if (!l.original || !file || !ORIGINAL.test(file)) skipped.push({ zone, why: "no original was saved with this picture" });
    else if (!cm) skipped.push({ zone, why: `the product names no size for its ${zone}: add zones to its product file` });
    else sheets.push({ zone, cm, px: sheetPx(cm, PRINT_DPI), original: `${origin}/api/orgs/${org}/originals/${file}`, at: { u: l.u, v: l.v, scale: l.scale, rotation: l.rotation } });
  }
  return privateJson({ design: id, model: d.model, dpi: PRINT_DPI, sheets, skipped } satisfies PrintPlan, 200, headers);
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
