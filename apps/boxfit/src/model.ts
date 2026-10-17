// What the page keeps and how it talks to the engine: pure functions, no DOM, so the tests drive them directly.
import type { Placed, Solution, Thing } from "./engine.ts";

export interface Row { name: string; l: number; w: number; h: number; qty: number; holds: boolean }
export interface State {
  unit: "in" | "cm";
  /** Room kept between things, in the unit. */
  pad: number;
  /** Wall of any product marked as a box that holds things, in the unit. */
  wall: number;
  /** Let boxes ride inside boxes. Off, every product is solid: what shipping software does today. */
  nest: boolean;
  boxes: Row[];
  items: Row[];
}

export const blank = (): Row => ({ name: "", l: 0, w: 0, h: 0, qty: 1, holds: false });
const row = (name: string, l: number, w: number, h: number, qty = 1, holds = false): Row => ({ name, l, w, h, qty, holds });

/** A first visit's page: the small shipper only works once the gift tin carries the candles. */
export const example = (): State => ({
  unit: "in", pad: 0, wall: 0.2, nest: true,
  boxes: [row("Small", 8, 6, 4), row("Medium", 12, 9, 6), row("Large", 16, 12, 8)],
  items: [row("Gift tin", 7, 5, 3.5, 1, true), row("Candle", 3, 3, 3.5, 2), row("Matchbook", 2, 1.5, 0.3)],
});

const usable = (r: Row) => [r.l, r.w, r.h].every((d) => d > 0);

export function toInput(s: State): { boxes: Thing[]; items: Thing[]; pad: number } {
  const thing = (r: Row, wall: number): Thing => ({ name: r.name || "(unnamed)", l: r.l, w: r.w, h: r.h, qty: Math.max(1, Math.floor(r.qty) || 1), wall });
  return {
    boxes: s.boxes.filter(usable).map((r) => thing(r, 0)),
    items: s.items.filter(usable).map((r) => thing(r, s.nest && r.holds ? s.wall : 0)),
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

const ALIASES: Record<keyof Row, string[]> = {
  name: ["name", "title", "product", "sku", "item", "description"],
  l: ["l", "length", "len", "long"],
  w: ["w", "width", "wide"],
  h: ["h", "height", "depth", "d", "high"],
  qty: ["qty", "quantity", "count", "units", "pcs"],
  holds: ["holds", "opens", "hollow", "nestable", "container"],
};
const NUM = /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/;
const SIZE = /(\d+\.?\d*|\.\d+)\s*(?:x|×|\*|by)\s*(\d+\.?\d*|\.\d+)\s*(?:x|×|\*|by)\s*(\d+\.?\d*|\.\d+)/i;
const truthy = (s: string) => /^(1|y|yes|true|x)$/i.test(s.trim());

/**
 * Rows from pasted text or a CSV file: comma, tab or semicolon separated, a header line optional.
 * With a header, columns are found by name (length, width, height, qty, ...). Without one, the order is
 * name, length, width, height, qty. A cell like `10 x 8 x 4` stands for all three sizes.
 */
export function parseRows(text: string): { rows: Row[]; skipped: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], skipped: 0 };
  const sep = [",", "\t", ";"].map((c) => [c, lines[0]!.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const split = (l: string) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
  const first = split(lines[0]!);
  const header = !first.some((c) => NUM.test(c) || SIZE.test(c));
  const col = {} as Partial<Record<keyof Row, number>>;
  if (header) {
    first.forEach((c, i) => {
      const k = (Object.keys(ALIASES) as (keyof Row)[]).find((key) => ALIASES[key].includes(c.toLowerCase()));
      if (k && col[k] === undefined) col[k] = i;
    });
  } else Object.assign(col, { name: 0, l: 1, w: 2, h: 3, qty: 4 });
  const rows: Row[] = [];
  let skipped = 0;
  for (const line of header ? lines.slice(1) : lines) {
    const cells = split(line);
    const at = (k: keyof Row) => (col[k] === undefined ? "" : cells[col[k]!] ?? "");
    const packed = cells.map((c) => SIZE.exec(c)).find(Boolean);
    const [l, w, h] = packed ? [packed[1], packed[2], packed[3]].map(Number) : [at("l"), at("w"), at("h")].map(Number);
    if (![l, w, h].every((d) => Number.isFinite(d) && d! > 0)) { skipped++; continue; }
    const name = at("name") && !SIZE.test(at("name")) ? at("name") : "";
    rows.push({ name, l: l!, w: w!, h: h!, qty: Math.max(1, Math.floor(Number(at("qty"))) || 1), holds: truthy(at("holds")) });
  }
  return { rows, skipped };
}
