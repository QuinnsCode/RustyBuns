// A drill template for a pedal box, from the board itself: the knobs and the
// LED go where their legs sit on the PCB, so the holes and the board can't
// disagree. The footswitch and the jacks go where kit builders put them on a
// 125B box (about 122 × 66 × 39 mm). Print the SVG at 100% and tape it on. A sound wall
// module's template is its Eurorack panel, from circuits/wall-panels.ts (where its board
// puts each jack and pot), with the rail screws' holes.
import { arr, check, num, obj, raw, str } from "@rustybuns/util/guard";
import { PANEL_H, panelHoles, panelWidth, type Panel } from "../../circuits/wall-panels.ts";

/** The 125B box, outside, in mm: the face is `w` × `h`, the sides are `d` deep. */
export const BOX_125B = { w: 66, h: 122, d: 39 };

export interface Hole {
  name: string;
  /** Face holes: x right, y up from the face's centre. Side holes: along the side, and depth down from the face. */
  x: number;
  y: number;
  /** Drill size, mm. */
  drill: number;
  face: "top" | "left" | "right" | "end";
}

export interface TemplateOptions {
  /** Part name → drill size and how far its shaft sits from the middle of its legs (mm, +y towards the box's top end). */
  parts: Record<string, { drill: number; shaft?: number }>;
  /** Where the board's centre sits on the face, mm from the face's centre (default 10 up). */
  boardY?: number;
  /** Holes not on the board: the footswitch, jacks and DC jack. */
  extra: Hole[];
}

const PcbComponent = obj({ type: str(80), source_component_id: str(200), center: obj({ x: num(-1e4, 1e4), y: num(-1e4, 1e4) }) });
const SourceComponent = obj({ type: str(80), source_component_id: str(200), name: str(80) });

/** The holes for a board's circuit JSON. Throws when a hole leaves its face or two holes come closer than 3 mm. */
export function drillHoles(json: unknown, o: TemplateOptions, box = BOX_125B): Hole[] {
  const els = arr(raw, 100_000)(json);
  const names = new Map<string, string>();
  for (const e of els) { const s = check(SourceComponent, e); if (s?.type === "source_component") names.set(s.source_component_id, s.name); }
  const holes: Hole[] = [];
  for (const e of els) {
    const p = check(PcbComponent, e);
    if (p?.type !== "pcb_component") continue;
    const name = names.get(p.source_component_id) ?? "";
    const spec = o.parts[name];
    if (spec) holes.push({ name, x: p.center.x, y: p.center.y + (o.boardY ?? 10) + (spec.shaft ?? 0), drill: spec.drill, face: "top" });
  }
  for (const want of Object.keys(o.parts)) if (!holes.some((h) => h.name === want)) throw new Error(`${want}: not on the board`);
  holes.push(...o.extra);
  const size = (f: Hole["face"]) => f === "top" ? [box.w, box.h] : f === "end" ? [box.w, box.d] : [box.h, box.d];
  for (const h of holes) {
    const [w, hh] = size(h.face), r = h.drill / 2 + 3;
    const inside = h.face === "top" ? Math.abs(h.x) + r <= w / 2 && Math.abs(h.y) + r <= hh / 2 : Math.abs(h.x) + r <= w / 2 && h.y - r >= 0 && h.y + r <= hh;
    if (!inside) throw new Error(`${h.name}: off the ${h.face} face`);
  }
  for (const a of holes) for (const b of holes) {
    if (a === b || a.face !== b.face || a.name > b.name) continue;
    if (Math.hypot(a.x - b.x, a.y - b.y) < (a.drill + b.drill) / 2 + 3) throw new Error(`${a.name} and ${b.name}: holes too close`);
  }
  return holes;
}

/** The template as an SVG in mm: the face in the middle, the sides folded out left and right, the top end above. */
export function drillSvg(holes: Hole[], title: string, box = BOX_125B): string {
  const m = 10, W = box.d * 2 + box.w + m * 2, H = box.d + box.h + m * 2 + 8;
  const fx = m + box.d, fy = m + 8 + box.d; // face's top-left corner
  // Face: centre origin, y up. Sides: x along the side from its middle (towards the top end), y depth from the face edge.
  const at = (h: Hole): [number, number] =>
    h.face === "top" ? [fx + box.w / 2 + h.x, fy + box.h / 2 - h.y]
    : h.face === "left" ? [fx - h.y, fy + box.h / 2 - h.x]
    : h.face === "right" ? [fx + box.w + h.y, fy + box.h / 2 - h.x]
    : [fx + box.w / 2 + h.x, fy - h.y];
  const rects = [
    [fx, fy, box.w, box.h], [fx - box.d, fy, box.d, box.h], [fx + box.w, fy, box.d, box.h], [fx, fy - box.d, box.w, box.d],
  ].map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.3"/>`);
  const marks = holes.map((h) => {
    const [x, y] = at(h);
    return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(h.drill / 2).toFixed(2)}" fill="none" stroke="#000" stroke-width="0.25"/>`
      + `<path d="M${(x - 1.5).toFixed(2)} ${y.toFixed(2)}h3M${x.toFixed(2)} ${(y - 1.5).toFixed(2)}v3" stroke="#000" stroke-width="0.2"/>`
      + `<text x="${x.toFixed(2)}" y="${(y + h.drill / 2 + 3).toFixed(2)}" font-size="2.4" text-anchor="middle" font-family="sans-serif">${h.name} ${h.drill} mm</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#fff"/>`
    + `<text x="${m}" y="${m}" font-size="3.5" font-family="sans-serif">${title}. Print at 100%: this line is 50 mm.</text>`
    + `<path d="M${m} ${m + 3}h50" stroke="#000" stroke-width="0.4"/>`
    + rects.join("") + marks.join("") + `</svg>\n`;
}

/** The panel as a drilling template, in mm: its outline, each hole with a cross at its centre, and what goes in it. */
export function panelSvg(p: Panel): string {
  const w = panelWidth(p.hp), f = (v: number) => v.toFixed(2);
  const holes = panelHoles(p).map((h) => `<circle cx="${f(h.x)}" cy="${f(h.y)}" r="${f(h.drill / 2)}"/><path d="M${f(h.x - 1)} ${f(h.y)}h2M${f(h.x)} ${f(h.y - 1)}v2"/>` +
    (h.name === "screw" ? "" : `<text x="${f(h.x)}" y="${f(h.y - h.drill / 2 - 1)}">${h.name}</text>`)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w + 20)}mm" height="${PANEL_H + 26}mm" viewBox="-10 -16 ${f(w + 20)} ${PANEL_H + 26}">` +
    `<style>circle,rect,path{fill:none;stroke:#000;stroke-width:0.2}text{font:2.4px sans-serif;text-anchor:middle}</style>` +
    `<text x="${f(w / 2)}" y="-9">${p.name}, ${p.hp} HP: print at 100%</text><text x="${f(w / 2)}" y="-5">${f(w)} × ${PANEL_H} mm</text>` +
    `<rect x="0" y="0" width="${f(w)}" height="${PANEL_H}"/>${holes}</svg>\n`;
}
