// Isometric drawings as SVG strings: the shape a row describes as it is typed (a dot, a line, a rectangle,
// a box, a box hollowed out), and the packed box as a scene whose pieces can be revealed one step at a time.
// Pure: no DOM, so the tests can count what gets drawn.
import type { Placed, V3 } from "./engine.ts";

export interface Theme { name: string; bg: string; ink: string; shell: string; pieces: string[] }
/** Five looks, each with enough contrast between neighbours that a nested piece never melts into its holder. */
export const THEMES: Theme[] = [
  { name: "Kraft", bg: "#f4ead6", ink: "#3b2a1a", shell: "#8a5a2b", pieces: ["#d9822b", "#2f6f8f", "#b23a48", "#5b8c3a", "#7b4fa3", "#e0b000"] },
  { name: "Neon", bg: "#0e1022", ink: "#e8ecff", shell: "#7f8cff", pieces: ["#ff3d81", "#00e5ff", "#ffe600", "#7CFF6B", "#b388ff", "#ff9100"] },
  { name: "Mint", bg: "#e6f6ef", ink: "#12352a", shell: "#1f7a5c", pieces: ["#ff6f59", "#2d6cdf", "#f2a900", "#8e44ad", "#00a6a6", "#c2185b"] },
  { name: "Ocean", bg: "#0b2239", ink: "#e3f2ff", shell: "#4fb3ff", pieces: ["#ffb703", "#fb5607", "#8ecae6", "#c77dff", "#80ed99", "#ff006e"] },
  { name: "Candy", bg: "#fff0f6", ink: "#3d1a2e", shell: "#d6336c", pieces: ["#4dabf7", "#fcc419", "#51cf66", "#9775fa", "#ff922b", "#e64980"] },
];

const C = Math.cos(Math.PI / 6), S = Math.sin(Math.PI / 6);
/** World (x right-down, y left-down, z up) to the screen. */
const proj = ([x, y, z]: V3, u: number): [number, number] => [(x - y) * C * u, (x + y) * S * u - z * u];
const pts = (ps: V3[], u: number) => ps.map((p) => proj(p, u).map((n) => n.toFixed(1)).join(",")).join(" ");

function mix(hex: string, to: number, by: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (to - c) * by));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
const light = (c: string) => mix(c, 255, 0.35), dark = (c: string) => mix(c, 0, 0.3);

/** Three faces of a box at `o`: top, the face toward +x, the face toward +y, then its outline. Faces with no area are skipped. */
function boxSvg(o: V3, d: V3, color: string, stroke: string, opacity = 1, u = 1): string {
  const [x, y, z] = o, [l, w, h] = d;
  const faces: [V3[], string][] = [
    [[[x, y, z + h], [x + l, y, z + h], [x + l, y + w, z + h], [x, y + w, z + h]], light(color)],
    [[[x + l, y, z], [x + l, y + w, z], [x + l, y + w, z + h], [x + l, y, z + h]], color],
    [[[x, y + w, z], [x + l, y + w, z], [x + l, y + w, z + h], [x, y + w, z + h]], dark(color)],
  ];
  const flat = [l, w, h].filter((v) => v > 0).length;
  return faces.map(([f, fill], i) => {
    const area = i === 0 ? l * w : i === 1 ? w * h : l * h;
    return area > 0 ? `<polygon points="${pts(f, u)}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` : "";
  }).join("") + (flat === 1 ? `<polyline points="${pts([[x, y, z], [x + l, y + w, z + h]], u)}" stroke="${stroke}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` : "");
}

const wrap = (inner: string, box: [number, number, number, number], cls = "") =>
  `<svg class="${cls}" viewBox="${box.map((n) => n.toFixed(1)).join(" ")}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;

/**
 * What a row's numbers make so far: nothing but a dot at 0 0 0, a line once one is set, a rectangle with
 * two, a box with three. With an `inner` size it is hollowed out from the top, so the cavity shows.
 * Any float is fine; sizes are scaled to the page, not rounded.
 */
export function shapeSvg(d: V3, inner: V3 | null, theme: Theme, color = theme.pieces[0]!): string {
  const m = Math.max(...d);
  const stroke = theme.ink;
  if (!(m > 0)) return wrap(`<circle cx="0" cy="0" r="2.5" fill="${stroke}"/>`, [-14, -14, 28, 28], "shape");
  const u = 24 / m;
  const body = boxSvg([0, 0, 0], d, color, stroke, 1, u);
  let hole = "";
  if (inner && d.every((v) => v > 0)) {
    const o: V3 = [0, 1, 2].map((k) => Math.max(0, (d[k]! - inner[k]!) / 2)) as V3;
    const top = d[2]!;
    const floor = top - Math.min(inner[2]!, top);
    const [ox, oy] = o, [il, iw] = inner;
    hole = `<polygon points="${pts([[ox, oy, floor], [ox + il, oy, floor], [ox + il, oy + iw, floor], [ox, oy + iw, floor]], u)}" fill="${dark(color)}" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      + `<polygon points="${pts([[ox, oy, top], [ox, oy + iw, top], [ox, oy + iw, floor], [ox, oy, floor]], u)}" fill="${mix(color, 0, 0.5)}" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>`
      + `<polygon points="${pts([[ox, oy, top], [ox + il, oy, top], [ox + il, oy, floor], [ox, oy, floor]], u)}" fill="${mix(color, 0, 0.4)}" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  }
  const all: V3[] = [[0, 0, 0], [d[0], 0, 0], [0, d[1], 0], [d[0], d[1], 0], [0, 0, d[2]], [d[0], 0, d[2]], [0, d[1], d[2]], d];
  const xy = all.map((p) => proj(p, u));
  const [x0, x1] = [Math.min(...xy.map((p) => p[0])), Math.max(...xy.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...xy.map((p) => p[1])), Math.max(...xy.map((p) => p[1]))];
  return wrap(body + hole, [x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8], "shape");
}

/** One drawn thing in the packed box: world corner, world size, how deep it is nested, whether it carries others. */
export interface Part { name: string; at: V3; size: V3; level: number; holder: boolean }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** A vector in a piece's own frame as its parent sees it. */
const turned = (v: V3, turn: V3): V3 => [v[turn[0]]!, v[turn[1]]!, v[turn[2]]!];

/**
 * Every piece in the packed box in world terms, a holder before what rides in it (that is the order
 * the animation fills the box in). Turning a holder turns its contents with it: `corner` and `size` say
 * how this frame's points and sizes read in the world.
 */
export function parts(placed: Placed[], corner: (v: V3) => V3 = (v) => v, size: (v: V3) => V3 = (v) => v, level = 0): Part[] {
  return placed.flatMap((p) => [
    { name: p.name, at: corner(p.pos), size: size(p.size), level, holder: p.inside.length > 0 },
    ...parts(p.inside, (v) => corner(add(p.pos, turned(add(p.cav, v), p.turn))), (v) => size(turned(v, p.turn)), level + 1),
  ]);
}

/**
 * The packed box as an SVG of `shown` pieces (all, by default): solid pieces first, far to near, then
 * every holder as glass over what it carries, the shipping box last. Each piece carries its step
 * (`data-step`) so the page can animate them in.
 */
export function sceneSvg(box: V3, all: Part[], theme: Theme, shown = all.length): string {
  const u = 1;
  const colors = new Map<string, string>();
  const colorOf = (name: string) => colors.get(name) ?? (colors.set(name, theme.pieces[colors.size % theme.pieces.length]!), colors.get(name)!);
  const indexed = all.map((p, i) => ({ p, i })).filter(({ i }) => i < shown);
  for (const p of all) colorOf(p.name); // colours follow the order things first appear, however many are shown
  const depth = ({ p }: { p: Part }) => p.at[0] + p.size[0] / 2 + p.at[1] + p.size[1] / 2 + p.at[2] + p.size[2] / 2;
  const solids = indexed.filter(({ p }) => !p.holder).sort((a, b) => depth(a) - depth(b));
  const glass = indexed.filter(({ p }) => p.holder).sort((a, b) => b.p.level - a.p.level);
  const draw = ({ p, i }: { p: Part; i: number }, g: boolean) =>
    `<g class="part${g ? " glass" : ""}" data-step="${i}">${boxSvg(p.at, p.size, colorOf(p.name), theme.ink, g ? 0.28 : 1, u)}<title>${p.name.replace(/[&<>]/g, "")}</title></g>`;
  const shell = boxSvg([0, 0, 0], box, theme.shell, theme.shell, 0.12, u);
  const corners: V3[] = [0, 1].flatMap((a) => [0, 1].flatMap((b) => [0, 1].map((c) => [a * box[0], b * box[1], c * box[2]] as V3)));
  const xy = corners.map((c) => proj(c, u));
  const [x0, x1] = [Math.min(...xy.map((p) => p[0])), Math.max(...xy.map((p) => p[0]))];
  const [y0, y1] = [Math.min(...xy.map((p) => p[1])), Math.max(...xy.map((p) => p[1]))];
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05 + 1;
  return wrap(solids.map((x) => draw(x, false)).join("") + glass.map((x) => draw(x, true)).join("") + `<g class="shell">${shell}</g>`, [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad], "scene");
}
