// The menus' artwork, drawn from the course's own world, no images: the wind rose and the forecast strip read NOAA's
// grid (whatever the page has loaded), the scorecard is a punched card, and the fronds are the alien botany that
// grows on its edge, seeded by the course. Each is a small SVG string in the globe's colours (styles.css's tokens),
// so a panel re-render costs nothing; the needles that move every frame carry ids and are turned, never redrawn.
import { mulberry32 } from "@rustybuns/util";

/** A wind (or current) at a point: m/s, and the heading it blows toward, degrees clockwise from north. */
export interface Vane { speed: number; to: number }
/** One level on the rose: `scale` is the speed that fills the dial (the jet's 70 m/s is not the surface's 25). */
export interface Petal { vane: Vane | null; scale: number; kind: "low" | "high" | "sea"; on: boolean }

const n1 = (n: number) => Math.round(n * 10) / 10;
/** A point `r` out from the centre on compass heading `deg` (SVG y runs down, so north is -y). */
const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [n1(Math.sin(a) * r), n1(-Math.cos(a) * r)];
};

/** The wind rose: a scanner dial with 16 points, a petal per level pointing where it blows (longer is stronger),
 * the aim as a dashed needle (`#rose-aim`) and the basket as a flag on the rim (`#rose-basket`). */
export function windRose(petals: Petal[], aim: number, basket: number): string {
  const ticks = Array.from({ length: 16 }, (_, i) => {
    const major = i % 4 === 0, [x1, y1] = polar(i * 22.5, major ? 45 : 49), [x2, y2] = polar(i * 22.5, 53);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${major ? ` class="maj"` : ""}/>`;
  }).join("");
  const letters = ["N", "E", "S", "W"].map((l, i) => { const [x, y] = polar(i * 90, 38); return `<text x="${x}" y="${y}">${l}</text>`; }).join("");
  // Off petals first, so the one you're throwing in sits on top.
  const leaves = [...petals].sort((a, b) => Number(a.on) - Number(b.on)).map((p) => {
    if (!p.vane) return "";
    const len = 10 + 34 * Math.min(1, Math.sqrt(p.vane.speed / p.scale)), w = 3 + len * 0.13;
    return `<path class="petal ${p.kind}${p.on ? " on" : ""}" id="rose-${p.kind}" transform="rotate(${n1(p.vane.to)})" d="M0 0L${n1(w)} ${n1(-len * 0.38)}L0 ${n1(-len)}L${n1(-w)} ${n1(-len * 0.38)}Z"/>`;
  }).join("");
  return `<svg class="rose" viewBox="-62 -62 124 124" role="img" aria-label="Wind rose">
<circle class="face" r="58"/><circle class="ring" r="53"/><circle class="ring faint" r="30"/><circle class="ring faint" r="15"/>
<g class="ticks">${ticks}</g><g class="letters">${letters}</g>${leaves}
<g id="rose-aim" transform="rotate(${n1(aim)})"><line class="aim" y2="-50"/><ellipse class="aim-disc" cy="-50" rx="4" ry="1.8"/></g>
<g id="rose-basket" transform="rotate(${n1(basket)})"><path class="flag" d="M0 -53V-61L5 -58.5L0 -56"/></g>
<ellipse class="hub" rx="5" ry="2.2"/></svg>`;
}

/** Turn a rose's needle or petal (`aim`, `basket`, `low`, `high`, `sea`) without redrawing it. */
export function turnRose(root: ParentNode, id: string, deg: number): void {
  root.querySelector(`#rose-${id}`)?.setAttribute("transform", `rotate(${n1(deg)})`);
}

/** The forecast strip: the throw laid flat, tee on the left, and the wind at each stretch of it as an arrow relative to
 * the flight (right is a tailwind, left a headwind, up blows the disc left of the line), coloured by what it does. */
export function forecastStrip(cells: { vane: Vane; track: number }[], scale: number): string {
  const W = 300, H = 44, step = W / Math.max(1, cells.length);
  const body = cells.map(({ vane, track }, i) => {
    const rel = vane.to - track, along = Math.cos((rel * Math.PI) / 180);
    const cls = along > 0.4 ? "tail" : along < -0.4 ? "head" : "cross";
    const len = 5 + 11 * Math.min(1, vane.speed / scale), x = n1(step * i + step / 2);
    return `<g class="${cls}" transform="translate(${x} 18) rotate(${n1(rel + 90)})"><path d="M0 ${n1(len)}V${n1(-len)}M-3.5 ${n1(-len + 4)}L0 ${n1(-len)}L3.5 ${n1(-len + 4)}"/></g><text x="${x}" y="${H - 2}">${Math.round(vane.speed)}</text>`;
  }).join("");
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wind along the throw">
<line class="track" x1="2" y1="18" x2="${W - 2}" y2="18"/><ellipse class="tee" cx="3" cy="18" rx="3" ry="3"/><path class="land" d="M${W - 3} 12V24"/>${body}</svg>`;
}

/** Alien botany for a corner: curling stems that spiral in at the tip, with glowing pods and a few blades, grown from
 * `seed` so a course keeps its own. They rise from the bottom-right corner of a `w` by `h` box; `alpha` is how much
 * they show (a watermark behind a panel's text is faint, the scorecard's is bolder). */
export function fronds(seed: number, w = 140, h = 100, alpha = 1): string {
  const rnd = mulberry32((seed ^ 0x5eed) >>> 0);
  let stems = "", pods = "", blades = "";
  const count = 3 + Math.floor(rnd() * 2);
  for (let s = 0; s < count; s++) {
    let x = w - rnd() * 18, y = rnd() * 10;
    let a = 200 + s * (55 / count) + rnd() * 14, curl = (rnd() < 0.5 ? -1 : 1) * (2.2 + rnd() * 1.6);
    const len = 22 + rnd() * 26, pts: string[] = [`M${n1(x)} ${n1(y)}`];
    for (let i = 0; i < len; i++) {
      const r = (a * Math.PI) / 180, seg = 3.2 * (1 - i / (len * 1.35));
      x += Math.cos(r) * seg; y -= Math.sin(r) * seg;
      a += curl * (0.35 + (i / len) ** 2 * 4.5);
      pts.push(`L${n1(x)} ${n1(y)}`);
      if (i > 3 && i % 6 === 3 && rnd() < 0.8) {
        const side = rnd() < 0.5 ? 90 : -90, br = ((a + side) * Math.PI) / 180, bl = 5 + rnd() * 7;
        blades += `<path d="M${n1(x)} ${n1(y)}q${n1(Math.cos(br) * bl * 0.6 + 2)} ${n1(-Math.sin(br) * bl * 0.6)} ${n1(Math.cos(br) * bl)} ${n1(-Math.sin(br) * bl)}"/>`;
      }
      if (i > 5 && rnd() < 0.09) pods += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(1.1 + rnd() * 1.6)}"/>`;
    }
    pods += `<circle class="tip" cx="${n1(x)}" cy="${n1(y)}" r="${n1(1.6 + rnd())}"/>`;
    stems += `<path d="${pts.join("")}" stroke-width="${n1(1.6 - s * 0.25)}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g transform="translate(0 ${h}) scale(1 -1)" opacity="${alpha}"><g fill="none" stroke="#5ee6c8" stroke-linecap="round" stroke-opacity=".55">${stems}</g><g fill="none" stroke="#5ee6c8" stroke-opacity=".35" stroke-width=".8" stroke-linecap="round">${blades}</g><g fill="#ffb347" fill-opacity=".8">${pods.replace(/class="tip"/g, 'fill="#ffd791"')}</g></g></svg>`;
}

/** An SVG string as a CSS `url()`. */
export const cssUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** One hole on the card: par, and the strokes taken (net of a guess) once it is played. */
export interface CardHole { n: number; par: number; net?: number }

/** The nine-punch strip along the panel's top while you play: played holes punched in the colour of the result,
 * this one ringed. */
export function punchStrip(holes: CardHole[], current: number): string {
  return `<ol class="punches" aria-label="Scorecard">${holes.map((h) => {
    const d = h.net === undefined ? null : h.net - h.par;
    const cls = d === null ? (h.n === current ? "now" : "") : d < 0 ? "under" : d > 0 ? "over" : "even";
    const tip = d === null ? `Hole ${h.n}, par ${h.par}` : `Hole ${h.n}: ${h.net} on a par ${h.par}`;
    return `<li class="${cls}" title="${tip}">${h.n}</li>`;
  }).join("")}</ol>`;
}

/** A score's mark on the card, as on a golf card: rings for under par (two for an eagle), boxes for over. */
export const markFor = (d: number) => (d <= -2 ? "eagle" : d === -1 ? "birdie" : d === 1 ? "bogey" : d >= 2 ? "double" : "par");

/** The disc-in-orbit mark, big, for the title splash: a planet with its graticule, an orbit tilted across it and a disc
 * riding the orbit (CSS spins `.orbit-spin`). Behind the planet the disc is the copy drawn first, so the planet hides
 * it; in front, a second copy clipped to the orbit's near half sits on top. */
export function orbitMark(): string {
  const disc = `<g class="orbit-spin"><ellipse class="orbit-disc" cx="58" rx="7" ry="7"/></g>`;
  const tilt = `transform="rotate(-18) scale(1 0.3)"`;
  return `<svg class="orbit-mark" viewBox="-70 -70 140 140" role="img" aria-label="A disc in orbit round the planet">
<defs><clipPath id="orbit-near" clipPathUnits="userSpaceOnUse"><rect x="-80" y="0" width="160" height="80"/></clipPath>
<radialGradient id="orbit-sea" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#16395a"/><stop offset="1" stop-color="#050b14"/></radialGradient></defs>
<g ${tilt}><ellipse class="orbit-ring far" rx="58" ry="58"/>${disc}</g>
<circle class="planet" r="40" fill="url(#orbit-sea)"/>
<g class="planet-lines"><ellipse rx="40" ry="13"/><ellipse rx="40" ry="28"/><ellipse rx="14" ry="40"/><ellipse rx="29" ry="40"/><path d="M-40 0H40M0-40V40"/></g>
<circle class="planet-rim" r="40"/>
<g ${tilt}><path class="orbit-ring near" d="M-58 0A58 58 0 0 0 58 0"/><g clip-path="url(#orbit-near)">${disc}</g></g></svg>`;
}

/** A hole on the title's route map: its number and its flight from tee to basket as [lon, lat] points. */
export interface RouteHole { n: number; path: [number, number][] }

/** The nine holes as a route on a flat planet (lon across, lat up, 84°N to 58°S), over the coastlines: each hole an arc
 * from a numbered tee to a basket flag, with a scanner line that sweeps down it (CSS). `land` is [lon, lat] rings. */
export function routeMap(holes: RouteHole[], land: number[][][]): string {
  const y = (lat: number) => n1(-lat);
  // A ring or path as SVG, broken where it wraps across the date line.
  // `step` is how far (in degrees) a point must be from the last one kept: the coast at a glance, not every headland.
  const line = (pts: number[][], step = 0) => {
    let d = "", last: number[] | null = null;
    for (const p of pts) {
      const x = Math.round(p[0]!), yy = Math.round(-p[1]!);
      if (last && Math.abs(x - last[0]!) <= 180 && Math.hypot(x - last[0]!, yy - last[1]!) < Math.max(step, 0.5)) continue;
      d += `${!last || Math.abs(x - last[0]!) > 180 ? "M" : "L"}${x} ${yy}`;
      last = [x, yy];
    }
    return d;
  };
  const coast = land.filter((r) => r.length > 8).map((r) => line(r, 2.2)).join("");
  const grid = [-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((x) => `M${x} -84V58`).join("") + [-30, 0, 30, 60].map((l) => `M-180 ${y(l)}H180`).join("");
  const arcs = holes.map((h) => `<path d="${line(h.path)}"/>`).join("");
  const ends = holes.map((h) => {
    const [tx, ty] = h.path[0]!, [bx, by] = h.path.at(-1)!;
    return `<g class="tee"><circle cx="${n1(tx)}" cy="${y(ty)}" r="4.2"/><text x="${n1(tx)}" y="${y(ty)}">${h.n}</text></g><path class="flag" d="M${n1(bx)} ${y(by)}v-7l4.5 2.2l-4.5 2.2"/>`;
  }).join("");
  return `<svg class="route" viewBox="-180 -84 360 142" role="img" aria-label="The course: nine holes across the planet">
<path class="graticule" d="${grid}"/><path class="coast" d="${coast}"/><g class="arcs">${arcs}</g>${ends}<rect class="scanline" x="-180" y="-84" width="360" height="10"/></svg>`;
}

/** The scorecard's row glyph: land if the disc stayed dry on that hole, a wave if it went in the sea. */
export const lieGlyph = (wet: boolean) => wet
  ? `<svg class="lie sea" viewBox="0 0 14 10" aria-label="Went in the sea"><path d="M1 4q1.5-2 3 0t3 0t3 0t3 0M1 8q1.5-2 3 0t3 0t3 0t3 0"/></svg>`
  : `<svg class="lie land" viewBox="0 0 14 10" aria-label="Stayed on land"><path d="M1 9L5 3.5L7.5 6.5L9.5 4.5L13 9Z"/></svg>`;
