// What the page keeps and how it talks to the engine: pure functions, no DOM, so the tests drive them directly.
import type { Placed, Solution, Thing, V3 } from "./engine.ts";

/** `inner` is what a product that opens (`holds`) has room for inside; null until it is typed, then half a unit of wall all round. */
export interface Row { name: string; l: number; w: number; h: number; qty: number; holds: boolean; inner: V3 | null }
export interface State {
  unit: "in" | "cm";
  /** Room kept between things, in the unit. */
  pad: number;
  /** Which of the five looks the packed box wears (viz.ts THEMES). */
  theme: number;
  /** Let boxes ride inside boxes. Off, every product is solid: what shipping software does today. */
  nest: boolean;
  boxes: Row[];
  items: Row[];
}

export const blank = (): Row => ({ name: "", l: 0, w: 0, h: 0, qty: 1, holds: false, inner: null });
const row = (name: string, l: number, w: number, h: number, qty = 1, holds = false): Row => ({ name, l, w, h, qty, holds, inner: null });

/** A half inch of wall, or the same in centimetres. */
export const wallOf = (unit: State["unit"]) => (unit === "in" ? 0.5 : 1.25);
/** The cavity a product opens up: what was typed, or its size less a default wall on every side (never below nothing). */
export const innerOf = (r: Row, unit: State["unit"]): V3 =>
  r.inner ?? ([r.l, r.w, r.h].map((d) => Math.max(0, Math.round((d - 2 * wallOf(unit)) * 1e6) / 1e6)) as V3);

/** A first visit's page: the small shipper only works once the gift tin carries the candles. */
export const example = (): State => ({
  unit: "in", pad: 0, theme: 0, nest: true,
  boxes: [row("Small", 8, 6, 4), row("Medium", 12, 9, 6), row("Large", 16, 12, 8)],
  items: [row("Gift tin", 7, 5, 4, 1, true), row("Candle", 3, 3, 3.5, 2), row("Matchbook", 2, 1.5, 0.3)],
});

const usable = (r: Row) => [r.l, r.w, r.h].every((d) => d > 0);

export function toInput(s: State): { boxes: Thing[]; items: Thing[]; pad: number } {
  const thing = (r: Row, inner?: V3): Thing => ({ name: r.name || "(unnamed)", l: r.l, w: r.w, h: r.h, qty: Math.max(1, Math.floor(r.qty) || 1), ...(inner ? { inner } : {}) });
  const opens = (r: Row) => {
    if (!s.nest || !r.holds) return undefined;
    const c = innerOf(r, s.unit);
    // A cavity typed bigger than the product, or none left, is no cavity: the product stays solid.
    return c.every((v) => v > 0) && c.every((v, k) => v <= [r.l, r.w, r.h][k]!) ? c : undefined;
  };
  return {
    boxes: s.boxes.filter(usable).map((r) => thing(r)),
    items: s.items.filter(usable).map((r) => thing(r, opens(r))),
    pad: s.pad,
  };
}

/** Which of the state's boxes the engine's `i`th box is (unusable rows are left out of the input). */
export const usableBoxes = (s: State) => s.boxes.filter(usable);

/** Siblings that are the same thing in the same place-shape, counted: three candles, not three lines. */
export interface Group { name: string; count: number; size: [number, number, number]; inside: Group[] }
export function group(placed: { name: string; size: [number, number, number]; inside: Placed[] }[]): Group[] {
  const out = new Map<string, Group>();
  for (const p of placed) {
    const inside = group(p.inside);
    const key = `${p.name}|${[...p.size].sort().join("x")}|${JSON.stringify(inside)}`;
    const g = out.get(key);
    if (g) g.count++;
    else out.set(key, { name: p.name, count: 1, size: p.size, inside });
  }
  return [...out.values()];
}

export type Verdict =
  | { kind: "empty"; why: string }
  | { kind: "fits"; box: string; fill: number; others: number }
  | { kind: "none" };

export function verdict(sol: Solution): Verdict {
  if (!sol.pieces.length) return { kind: "empty", why: "Add a product with a size." };
  if (sol.best === null) return { kind: "none" };
  const b = sol.boxes[sol.best]!;
  return { kind: "fits", box: b.name, fill: b.fill, others: sol.boxes.filter((x, i) => x.fits && i !== sol.best).length };
}

const ALIASES: Record<Exclude<keyof Row, "inner"> | "option", string[]> = {
  name: ["name", "title", "product", "sku", "item", "description", "box", "box name"],
  option: ["option1 value"],
  l: ["l", "length", "len", "long"],
  w: ["w", "width", "wide"],
  h: ["h", "height", "depth", "d", "high"],
  qty: ["qty", "quantity", "count", "units", "pcs"],
  holds: ["holds", "opens", "hollow", "nestable", "container"],
};
// A number as a chart writes it: 12, .5, 11.625, 11 5/8, 11-5/8 or 5/8, with an optional inch mark or unit after.
const N = String.raw`(?:\d+[ -]\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;
const UNIT = String.raw`\s*(?:"|''|”|in(?:ches|ch)?\b|cm\b|mm\b)?`;
const BY = String.raw`\s*(?:x|×|\*|by)\s*`;
const NUM = new RegExp(`^\\s*[-+]?${N}${UNIT}\\s*$`, "i");
const SIZE = new RegExp(`(${N})${UNIT}${BY}(${N})${UNIT}${BY}(${N})${UNIT}`, "i");
const truthy = (s: string) => /^(1|y|yes|true|x)$/i.test(s.trim());
/** `11-5/8` is eleven and five eighths; anything that is not a number is NaN. */
export function num(s: string): number {
  const t = s.trim().replace(/(?:"|''|”|in(?:ches|ch)?|cm|mm)$/i, "").trim();
  const m = /^(\d+)[ -](\d+)\/(\d+)$/.exec(t) ?? /^()(\d+)\/(\d+)$/.exec(t);
  return m ? Number(m[1] || 0) + Number(m[2]) / Number(m[3]) : NUM.test(t) ? Number(t) : NaN;
}

/** Records of cells, the way spreadsheets write them: quotes hold a separator or a line break, `""` is a quote. */
function table(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const end = () => { row.push(cell.trim()); cell = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (c === '"' && !cell.trim()) { quoted = true; cell = ""; }
    else if (c === sep) end();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end();
      if (row.some(Boolean)) out.push(row);
      row = [];
    } else cell += c;
  }
  end();
  if (row.some(Boolean)) out.push(row);
  return out;
}

/** A header as the sheet names it, boiled down: `Variant SKU`, `Length (product.metafields.custom.length)` -> `sku`, `length`. */
const heading = (c: string) => c.toLowerCase().replace(/\(.*\)/, "").replace(/^(variant|product|package|box|item|outer|inner)\s+(?=\S)/, "").replace(/\s*(in|cm|mm|inches)$/, "").trim();

/**
 * Rows from pasted text or a CSV file: comma, tab or semicolon separated, a header line optional.
 * With a header, columns are found by name (length, width, height, qty, ...); that covers a Shopify product
 * export (Title, Variant SKU, and length/width/height columns or metafields; variant lines under a product
 * take its title) and a carrier's box chart. Without one, the order is name, length, width, height, qty.
 * A cell like `10 x 8 x 4`, `11-5/8" x 8 x 3.5` or `Medium Box 1: 13 x 11 x 3.5` stands for all three sizes.
 */
export function parseRows(text: string): { rows: Row[]; skipped: number } {
  const first = text.split(/\r?\n/).find((l) => l.trim());
  if (!first) return { rows: [], skipped: 0 };
  const sep = [",", "\t", ";"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const [head, ...body] = table(text, sep);
  const header = !head!.some((c) => NUM.test(c) || SIZE.test(c));
  const col = {} as Partial<Record<keyof typeof ALIASES, number>>;
  if (header) {
    head!.forEach((c, i) => {
      const k = (Object.keys(ALIASES) as (keyof typeof ALIASES)[]).find((key) => ALIASES[key].includes(heading(c)));
      // Name columns: a Title beats a SKU, whichever comes first.
      if (k && (col[k] === undefined || (k === "name" && /^(title|name)$/.test(heading(c))))) col[k] = i;
    });
  } else Object.assign(col, { name: 0, l: 1, w: 2, h: 3, qty: 4 });
  const shopify = header && head!.some((c) => c.toLowerCase() === "handle");
  const rows: Row[] = [];
  let skipped = 0, title = "";
  for (const cells of header ? body : [head!, ...body]) {
    const at = (k: keyof typeof ALIASES) => (col[k] === undefined ? "" : cells[col[k]!] ?? "");
    const packedAt = cells.findIndex((c) => SIZE.test(c));
    const m = packedAt < 0 ? null : SIZE.exec(cells[packedAt]!)!;
    const [l, w, h] = m ? [m[1], m[2], m[3]].map((d) => num(d!)) : [at("l"), at("w"), at("h")].map(num);
    let name = at("name");
    if (shopify) { if (name) title = name; else name = title; }
    // A size written inside the name cell ("Medium Box 1: 13 x 11 x 3.5") leaves the words in front of it as the name.
    if (m && packedAt === (col.name ?? 0)) name = cells[packedAt]!.slice(0, m.index).replace(/[\s:,;=@|-]+$/, "");
    else if (SIZE.test(name)) name = "";
    const option = at("option");
    if (shopify && option && option !== "Default Title" && name) name += ` (${option})`;
    if (![l, w, h].every((d) => Number.isFinite(d) && d! > 0)) {
      // A Shopify image or option line under a product carries nothing to size: not a row that was missed.
      if (!(shopify && !at("name"))) skipped++;
      continue;
    }
    rows.push({ name, l: l!, w: w!, h: h!, qty: Math.max(1, Math.floor(Number(at("qty"))) || 1), holds: truthy(at("holds")), inner: null });
  }
  return { rows, skipped };
}
