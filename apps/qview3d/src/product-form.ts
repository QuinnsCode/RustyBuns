// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The product editor on /orgs.html, as plain functions: what the form's fields become (a Product through its guard, the
// same one the Worker checks with), and the fields a saved product fills the form with. No DOM, so the tests use it too.
import { Bad } from "@rustybuns/util/guard";
import { Product, zonesOf, type Model, type Placement, type ZoneName } from "./api.ts";

/** The editor's fields as typed: colours as one line ("#1f2937, #fff"), placement in percent, blank for "the default". */
export type ProductFields = {
  name: string;
  model: Model;
  colors: string;
  /** The zones ticked. All of the model's ticked means "every zone" and is left out of the product. */
  print: ZoneName[];
  across: string;
  up: string;
  size: string;
  /** Kept as it was: a sample's GLB and print sizes aren't edited here. */
  keep?: Pick<Product, "glb" | "zones">;
};

/** "#abc" and "ABCDEF" alike become "#aabbcc". */
const hex = (c: string) => {
  const s = c.replace(/^#/, "").toLowerCase();
  return `#${s.length === 3 ? [...s].map((x) => x + x).join("") : s}`;
};

/** The product the fields describe, or the reason they don't make one (in the guard's words, field named). */
export function productBody(f: ProductFields): Product {
  const colors = f.colors.split(/[\s,]+/).filter(Boolean).map(hex);
  const zones = zonesOf(f.model);
  const print = f.print.filter((z) => zones.includes(z));
  if (!print.length) throw new Bad("pick a print zone at least");
  const pct = (s: string) => Number(s) / 100;
  const place: Placement | undefined = [f.across, f.up, f.size].every((s) => s.trim() === "") ? undefined
    : { u: pct(f.across || "50"), v: pct(f.up || "50"), scale: pct(f.size || "40"), rotation: 0 };
  const body = {
    name: f.name.trim(), model: f.model, colors, ...f.keep,
    ...(print.length < zones.length ? { print } : {}),
    ...(place ? { place } : {}),
  };
  return Product(body);
}

/** The fields a saved product fills the editor with. */
export function fieldsOf(p: Product): ProductFields {
  const pct = (n: number | undefined) => n === undefined ? "" : String(Math.round(n * 100));
  return {
    name: p.name, model: p.model, colors: p.colors.join(", "), print: [...(p.print ?? zonesOf(p.model))],
    across: pct(p.place?.u), up: pct(p.place?.v), size: pct(p.place?.scale),
    keep: { ...(p.glb ? { glb: p.glb } : {}), ...(p.zones ? { zones: p.zones } : {}) },
  };
}

