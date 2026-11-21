// The lava-lamp edition of the mpl pie: mpl's own SVG with a little lamp inside each slice. Soft blobs of wax in a
// lighter shade of the slice's colour rise, stretch, merge and sink through a darker shade of it, and bubbles stream
// up. Each slice's wax goes through a goo filter (blur, then a colour-matrix threshold on alpha), so blobs that touch
// flow into one, and everything is clipped to the slice's own path, drawn under the labels and their leader lines.
//
// SMIL only, no script, so the file plays when opened in a browser. Every animation's period divides `loop`, so the
// file at `loop` seconds is the file at 0 and a recording of it loops without a seam. Imported by pie.ts.
import { clamp, lerp, mulberry32 } from "../../packages/util/src/index.ts";

type Pt = [number, number];
const f1 = (n: number) => String(Math.round(n * 10) / 10);

/** A wedge path from mpl's SVG ("M … C … L centre Z") as a polygon, each cubic flattened into 12 lines. */
function polygon(d: string): Pt[] {
  const out: Pt[] = [];
  let at: Pt = [0, 0];
  for (const [, op, args] of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (op === "M" || op === "L") out.push((at = [n[0], n[1]]));
    if (op === "C")
      for (let i = 0; i + 5 < n.length; i += 6) {
        const [a, b, c]: Pt[] = [[n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]]];
        for (let s = 1; s <= 12; s++) {
          const t = s / 12, u = 1 - t;
          out.push([
            u * u * u * at[0] + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * c[0],
            u * u * u * at[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * c[1],
          ]);
        }
        at = c;
      }
  }
  return out;
}

/** The longest stretch of the vertical line at `x` inside the polygon, as [top, bottom] (SVG y grows downward). */
function column(poly: Pt[], x: number): [number, number] | null {
  const ys: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    if (x0 <= x !== x1 <= x) ys.push(y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  ys.sort((a, b) => a - b);
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < ys.length; i += 2) if (!best || ys[i + 1] - ys[i] > best[1] - best[0]) best = [ys[i], ys[i + 1]];
  return best;
}

/** `hex` mixed toward black (k < 0) or white (k > 0) by |k|. */
function shade(hex: string, k: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const to = k < 0 ? 0 : 255;
  return `#${c.map((v) => Math.round(lerp(v, to, Math.abs(k))).toString(16).padStart(2, "0")).join("")}`;
}

/** mpl's SVG with a lava lamp in every wedge. `colors[i]` is wedge i's colour. */
export function lavaLamp(svg: string, colors: string[], loop: number, seed = 7): string {
  const rand = mulberry32(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const wedges = [...svg.matchAll(/<g data-artist="artist\/(\d+)\/wedge">\s*<path d="([^"]+)"/g)].map((m) => ({ i: Number(m[1]), d: m[2] }));
  if (wedges.length !== colors.length) throw new Error(`found ${wedges.length} wedges for ${colors.length} colours`);
  const defs: string[] = [];
  const lamps: string[] = [];
  // A periodic animation of one attribute: `values` over `dur` seconds, started part-way through so blobs are out of step.
  const anim = (attr: string, values: number[], dur: number, ease = true) =>
    `<animate attributeName="${attr}" dur="${dur}s" begin="-${f1(rand() * dur)}s" repeatCount="indefinite" values="${values.map(f1).join(";")}"` +
    (ease ? ` calcMode="spline" keySplines="${Array(values.length - 1).fill(".45 0 .55 1").join(";")}"` : "") + "/>";
  for (const { i, d } of wedges) {
    const poly = polygon(d);
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const area = Math.abs(poly.reduce((s, [ax, ay], k) => s + ax * poly[(k + 1) % poly.length][1] - poly[(k + 1) % poly.length][0] * ay, 0)) / 2;
    const base = colors[i];
    const wax = shade(base, 0.42), waxHi = shade(base, 0.72), deep = shade(base, -0.55), warm = shade(base, -0.05);
    // A column at a random x that is at least `min` tall, or the tallest of the tries.
    const spot = (min: number) => {
      let best: { x: number; top: number; bot: number } | null = null;
      for (let t = 0; t < 40; t++) {
        const x = lerp(x0, x1, rand()), c = column(poly, x);
        if (c && (!best || c[1] - c[0] > best.bot - best.top)) best = { x, top: c[0], bot: c[1] };
        if (best && best.bot - best.top >= min) break;
      }
      return best;
    };
    const pad = 30;
    defs.push(
      `<clipPath id="lava-c${i}"><path d="${d}"/></clipPath>`,
      `<linearGradient id="lava-g${i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${warm}"/></linearGradient>`,
      `<radialGradient id="lava-w${i}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${waxHi}"/><stop offset=".55" stop-color="${wax}"/><stop offset="1" stop-color="${shade(base, 0.12)}"/></radialGradient>`,
    );
    const blobs: string[] = [];
    const n = area < 2500 ? 0 : clamp(Math.round(area / 6500), 1, 11);
    const r0 = clamp(Math.sqrt(area / Math.max(n, 1)) / 3.6, 7, 34);
    // The pool: wax resting at the slice's lowest point, breathing slowly; rising blobs pull out of it.
    if (n) {
      let low = { x: (x0 + x1) / 2, bot: 0 };
      for (let t = 0; t <= 24; t++) {
        const x = lerp(x0, x1, t / 24), c = column(poly, x);
        if (c && c[1] > low.bot) low = { x, bot: c[1] };
      }
      const pr = r0 * 1.5;
      blobs.push(`<ellipse cx="${f1(low.x)}" cy="${f1(low.bot)}" rx="${f1(pr * 1.4)}" ry="${f1(pr * 0.8)}">` +
        anim("rx", [pr * 1.4, pr * 1.7, pr * 1.4], loop) + anim("ry", [pr * 0.8, pr, pr * 0.8], loop / 2) + "</ellipse>");
    }
    for (let b = 0; b < n; b++) {
      const r = r0 * lerp(0.6, 1.15, rand());
      const s = spot(r * 5);
      if (!s) continue;
      const dur = s.bot - s.top > 260 ? loop : loop / 2;
      const top = s.top + r * lerp(0.6, 1.4, rand()), bot = s.bot + r * 0.4;
      const mid = (top + bot) / 2, sway = r * lerp(0.3, 0.9, rand());
      // Up, stretched tall while it climbs and squashed where it turns, then down again.
      blobs.push(`<ellipse cx="${f1(s.x)}" cy="${f1(bot)}" rx="${f1(r)}" ry="${f1(r)}">` +
        anim("cy", [bot, mid, top, mid, bot], dur) +
        anim("ry", [r * 0.85, r * 1.35, r * 0.9, r * 1.25, r * 0.85], dur) +
        anim("rx", [r * 1.15, r * 0.8, r * 1.1, r * 0.85, r * 1.15], dur) +
        anim("cx", [s.x, s.x + sway, s.x, s.x - sway, s.x], pick([loop, loop / 2])) + "</ellipse>");
    }
    const bubbles: string[] = [];
    const nb = clamp(Math.round(area / 2200), 2, 16);
    for (let b = 0; b < nb; b++) {
      const s = spot(40);
      if (!s) continue;
      const r = lerp(1.2, 3.4, rand()), dur = pick([loop / 2, loop / 3, loop / 4, loop / 6]);
      bubbles.push(`<circle cx="${f1(s.x)}" cy="${f1(s.bot)}" r="${f1(r)}">` +
        anim("cy", [s.bot + r, s.top - r], dur, false) +
        anim("cx", [s.x, s.x + 3, s.x, s.x - 3, s.x], dur, true) +
        anim("opacity", [0, 0.9, 0.9, 0], dur, false) + "</circle>");
    }
    const [fx, fy, fw, fh] = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map(f1);
    defs.push(`<filter id="lava-f${i}" filterUnits="userSpaceOnUse" x="${fx}" y="${fy}" width="${fw}" height="${fh}" color-interpolation-filters="sRGB">` +
      `<feGaussianBlur stdDeviation="${f1(clamp(r0 / 2.6, 3, 10))}"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 22 -9"/></filter>`);
    lamps.push(`<g clip-path="url(#lava-c${i})">` +
      `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="url(#lava-g${i})"/>` +
      (blobs.length ? `<g filter="url(#lava-f${i})" fill="url(#lava-w${i})">${blobs.join("")}</g>` : "") +
      `<g fill="${waxHi}" fill-opacity=".25" stroke="${waxHi}" stroke-opacity=".8" stroke-width=".8">${bubbles.join("")}</g>` +
      `</g><path d="${d}" fill="none" stroke="#0b0a12" stroke-width="2.5"/>`);
  }
  const last = svg.lastIndexOf("/wedge\">");
  const after = svg.indexOf("</g>", last) + 4;
  // Lamps go right after the last wedge, so every label and the legend draw over them. No width or height on the root:
  // with only a viewBox the picture fills whatever it is opened in.
  return (svg.slice(0, after) + `\n<g data-lavalamp="">${lamps.join("\n")}</g>` + svg.slice(after))
    .replace(/<svg ([^>]*?)width="\d+" height="\d+" /, "<svg $1")
    .replace(/(<svg [^>]*>)/, `$1\n<defs><radialGradient id="lava-bg" cx=".3" cy=".45" r=".8"><stop offset="0" stop-color="#1b1626"/><stop offset=".7" stop-color="#0b0a12"/></radialGradient>${defs.join("")}</defs>\n<rect width="100%" height="100%" fill="url(#lava-bg)"/>`);
}
