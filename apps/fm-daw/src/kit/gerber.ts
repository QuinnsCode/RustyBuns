// A kit's Gerbers and drill file read back into shapes, and drawn as the board a fab would send back: green solder
// mask over the copper, gold pads where the mask is open, white silkscreen, the holes drilled through. This draws the
// files that go in the zip, not the sim's PCB drawing, so what you see is what you would order. No DOM and no Vite:
// Q Builder hands in the kit folder's text (sheet.ts's `kitFiles`) and puts the SVG on the page.
//
// It reads what tscircuit's circuit-json-to-gerber writes: millimetres, absolute, circle and rectangle apertures,
// straight draws (G01), moves and flashes (D01/D02/D03), and an Excellon drill file. Anything else (arcs, regions,
// clear polarity, step and repeat, aperture macros in use) is named in `unread` rather than drawn wrong.
import type { KitFiles } from "./kit.ts";

export type Aperture = { shape: "C"; d: number } | { shape: "R" | "O"; w: number; h: number };
/** One thing a layer puts down, in millimetres with Y up as in the file: a line drawn with a round pen, or an aperture flashed once. */
export type Mark =
  | { t: "line"; pts: [number, number][]; w: number }
  | { t: "flash"; x: number; y: number; ap: Aperture };
export interface Layer { marks: Mark[]; unread: string[] }
export interface Hole { x: number; y: number; d: number; plated: boolean }

/** A Gerber (RS-274X) layer's marks. */
export function readGerber(text: string): Layer {
  const marks: Mark[] = [], unread = new Set<string>(), aps = new Map<string, Aperture>();
  let scale = 1e6, inch = false, ap: Aperture | null = null, x = 0, y = 0, line: Extract<Mark, { t: "line" }> | null = null;
  const mm = (v: number) => (inch ? v * 25.4 : v);
  // Extended commands sit between % signs; the rest are words ending in *.
  for (const [, ext, word] of text.matchAll(/%([^%]*)%|([^%*]+)\*/g)) {
    if (ext !== undefined) {
      for (const c of ext.split("*").map((s) => s.trim()).filter(Boolean)) {
        const fs = /^FSLAX(\d)(\d)Y\d\d$/.exec(c);
        if (fs) scale = 10 ** Number(fs[2]);
        else if (c === "MOMM") inch = false;
        else if (c === "MOIN") inch = true;
        else if (c.startsWith("ADD")) {
          const m = /^ADD(\d+)([A-Z]+),?([\d.X]*)$/.exec(c);
          const n = m?.[3].split("X").map(Number) ?? [];
          if (m && m[2] === "C") aps.set(m[1], { shape: "C", d: mm(n[0]) });
          else if (m && (m[2] === "R" || m[2] === "O")) aps.set(m[1], { shape: m[2], w: mm(n[0]), h: mm(n[1] ?? n[0]) });
          else if (m) aps.set(m[1], { shape: "C", d: 0 }), unread.add(`aperture ${m[2]}`);
        } else if (c === "LPC") unread.add("clear polarity");
        else if (c.startsWith("SR") && c !== "SR") unread.add("step and repeat");
        // TF/TA/TD attributes, AM macro bodies, LPD and the rest change nothing drawn.
      }
      continue;
    }
    const w = word.trim();
    if (!w || w.startsWith("G04") || w === "M02") continue;
    if (/^G0?[23]$/.test(w) || /^G0?[23]X/.test(w)) unread.add("arcs");
    if (w.startsWith("G36")) unread.add("regions");
    if (w === "G70") inch = true;
    if (w === "G71") inch = false;
    const sel = /^(?:G54)?D(\d{2,})$/.exec(w);
    if (sel && Number(sel[1]) >= 10) { ap = aps.get(sel[1]) ?? null; line = null; continue; }
    const m = /^(?:G01)?(?:X(-?\d+))?(?:Y(-?\d+))?(?:I-?\d+)?(?:J-?\d+)?D0?([123])$/.exec(w);
    if (!m) continue;
    const nx = m[1] !== undefined ? mm(Number(m[1]) / scale) : x, ny = m[2] !== undefined ? mm(Number(m[2]) / scale) : y;
    if (m[3] === "1" && ap) {
      const pen = ap.shape === "C" ? ap.d : Math.min(ap.w, ap.h);
      if (!line || line.w !== pen) { line = { t: "line", pts: [[x, y]], w: pen }; marks.push(line); }
      line.pts.push([nx, ny]);
    } else {
      line = null;
      if (m[3] === "3" && ap) marks.push({ t: "flash", x: nx, y: ny, ap });
    }
    x = nx; y = ny;
  }
  return { marks, unread: [...unread] };
}

/** An Excellon drill file's holes (millimetres, decimal coordinates, as tscircuit writes them). */
export function readDrill(text: string): Hole[] {
  const tools = new Map<string, number>(), holes: Hole[] = [];
  let tool = 0, plated = true, inch = false;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.includes("NonPlated") || l.includes("NPTH")) plated = false;
    if (l.startsWith(";") || !l) continue;
    if (l === "INCH" || l.startsWith("INCH,")) inch = true;
    if (l === "METRIC" || l.startsWith("METRIC,")) inch = false;
    const def = /^T(\d+)C([\d.]+)/.exec(l);
    if (def) { tools.set(def[1], Number(def[2]) * (inch ? 25.4 : 1)); continue; }
    const t = /^T(\d+)$/.exec(l);
    if (t) { tool = tools.get(t[1]) ?? 0; continue; }
    const xy = /^X(-?[\d.]+)Y(-?[\d.]+)$/.exec(l);
    if (xy && tool) holes.push({ x: Number(xy[1]) * (inch ? 25.4 : 1), y: Number(xy[2]) * (inch ? 25.4 : 1), d: tool, plated });
  }
  return holes;
}

/** The board's edge as the box around Edge_Cuts' lines: [left, bottom, right, top] in millimetres. */
export function outline(edge: Layer): [number, number, number, number] | null {
  const pts = edge.marks.flatMap((m) => (m.t === "line" ? m.pts : [[m.x, m.y] as [number, number]]));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export type BoardSide = "top" | "bottom";
/** What the mockup read from the kit, for the page's line under it and for probes. */
export interface Mockup {
  svg: string;
  /** Width and height in millimetres. */
  size: [number, number];
  holes: number;
  pads: number;
  /** The layer files it drew, and what in them it couldn't. */
  layers: string[];
  unread: string[];
}

const LOOK = { mask: "#17613a", copper: "#2f8c55", pad: "#d8b25c", silk: "#f3f1e8", hole: "#0b0d10", edge: "#c7b688" };
const n = (v: number) => Number(v.toFixed(3));

function draw(layer: Layer, fill: string, flip: (x: number, y: number) => [number, number], grow = 0): string {
  return layer.marks.map((m) => {
    if (m.t === "line") {
      const d = m.pts.map(([x, y], i) => { const [a, b] = flip(x, y); return `${i ? "L" : "M"}${n(a)} ${n(b)}`; }).join("");
      return `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${n(Math.max(m.w, 0.05) + grow)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    const [x, y] = flip(m.x, m.y), a = m.ap;
    if (a.shape === "C") return a.d > 0 ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(a.d / 2 + grow / 2)}" fill="${fill}"/>` : "";
    const w = a.w + grow, h = a.h + grow, r = a.shape === "O" ? Math.min(w, h) / 2 : 0;
    return `<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${fill}"/>`;
  }).join("");
}

/**
 * The kit's board as a fab would make it, seen from `side`, as SVG in millimetres. Null when the kit has no Edge_Cuts
 * (no board files yet). The bottom is seen from below, so it is mirrored left to right, as you'd hold it.
 */
export function mockup(kit: KitFiles, side: BoardSide = "top"): Mockup | null {
  const g = (name: string) => kit[`gerbers/${name}`];
  const edgeText = g("Edge_Cuts.gbr");
  if (edgeText === undefined) return null;
  const edge = readGerber(edgeText), box = outline(edge);
  if (!box) return null;
  const p = side === "top" ? "F" : "B", names = [`${p}_Cu.gbr`, `${p}_Mask.gbr`, `${p}_SilkScreen.gbr`, "Edge_Cuts.gbr"];
  const [cu, mask, silk] = names.slice(0, 3).map((f) => readGerber(g(f) ?? ""));
  const drill = Object.keys(kit).find((f) => f.startsWith("gerbers/") && f.endsWith(".drl"));
  const holes = drill ? readDrill(kit[drill]!) : [];
  const [x0, y0, x1, y1] = box, w = x1 - x0, h = y1 - y0, pad = 1.5;
  // File Y is up and SVG's down; seen from below, left and right swap.
  const flip = (x: number, y: number): [number, number] => [side === "top" ? x - x0 : x1 - x, y1 - y];
  const corner = Math.min(w, h) * 0.04;
  const body = [
    `<rect x="-0.25" y="-0.25" width="${n(w + 0.5)}" height="${n(h + 0.5)}" rx="${n(corner)}" fill="${LOOK.edge}"/>`,
    `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" rx="${n(corner)}" fill="${LOOK.mask}"/>`,
    `<g class="pcb-copper">${draw(cu, LOOK.copper, flip)}</g>`,
    `<g class="pcb-pads">${draw(mask, LOOK.pad, flip)}</g>`,
    `<g class="pcb-silk">${draw(silk, LOOK.silk, flip)}</g>`,
    `<g class="pcb-holes">${holes.map((o) => { const [x, y] = flip(o.x, o.y); return `<circle cx="${n(x)}" cy="${n(y)}" r="${n(o.d / 2)}" fill="${LOOK.hole}"/>`; }).join("")}</g>`,
  ].join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${n(w + pad * 2)} ${n(h + pad * 2)}" width="${n(w + pad * 2)}mm" height="${n(h + pad * 2)}mm" role="img" aria-label="The board's ${side}, from its Gerbers">${body}</svg>`;
  const unread = [...new Set([cu, mask, silk, edge].flatMap((l) => l.unread))];
  return { svg, size: [n(w), n(h)], holes: holes.length, pads: mask.marks.filter((m) => m.t === "flash").length, layers: [...names, ...(drill ? [drill.slice(8)] : [])], unread };
}
