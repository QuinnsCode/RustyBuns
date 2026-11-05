// The menus' artwork (#3543): a screen-print park poster drawn as a small SVG, no image files. Flat sky bands, a sun or
// moon disc, five ridges that fade into the sky's haze, pines and a trail sign on the near ridge, and after dark a ranger
// on the skyline with a torch beam. The front card shows it whole; every panel wears a strip of it through `--poster`.
// About 4 KB of markup, drawn once per time of day.
import { mulberry32 } from "@rustybuns/util";

export type Tod = "day" | "dusk" | "night";

/** The poster's time of day for an hour on the player's clock: dusk an hour or two either side of day. */
export const todAt = (hour: number): Tod => (hour >= 8 && hour < 17 ? "day" : (hour >= 6 && hour < 8) || (hour >= 17 && hour < 20) ? "dusk" : "night");

type Palette = { sky: string[]; haze: string; disc: string; near: string; far: string; ink: string };
const PALETTES: Record<Tod, Palette> = {
  day: { sky: ["#8fc4c9", "#b6d6c8", "#e6e2bd", "#f4dca2"], haze: "#f4dca2", disc: "#fff3cf", near: "#2f4a35", far: "#7fa58c", ink: "#22311f" },
  dusk: { sky: ["#3d2b4f", "#7a3a52", "#d9603b", "#f6b45a"], haze: "#f6b45a", disc: "#ffd98a", near: "#2a1b24", far: "#c0573c", ink: "#1d1219" },
  night: { sky: ["#0d1426", "#16223a", "#22324e", "#33466a"], haze: "#33466a", disc: "#f1ecd2", near: "#06090f", far: "#2a3a58", ink: "#04060a" },
};

/** `a` moved `t` of the way to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

const W = 520;

/** A ridge's skyline from x 0 to W: a few peaks with jagged shoulders, closed down to the bottom of the poster. */
function ridge(rnd: () => number, base: number, rise: number, h: number): { d: string; top: (x: number) => number } {
  const pts: [number, number][] = [];
  let x = 0;
  while (x <= W) { pts.push([x, base - rise * (0.25 + 0.75 * rnd())]); x += 26 + rnd() * 46; }
  pts.push([W, base - rise * 0.4]);
  const top = (px: number) => {
    for (let i = 1; i < pts.length; i++) if (px <= pts[i]![0]) { const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!; return y0 + ((y1 - y0) * (px - x0)) / (x1 - x0); }
    return pts[pts.length - 1]![1];
  };
  return { d: `M0 ${h} ${pts.map(([px, py]) => `L${px.toFixed(0)} ${py.toFixed(0)}`).join(" ")} L${W} ${h}Z`, top };
}

/** A pine: three stacked triangles on a stub, its foot at (x, y). */
const pine = (x: number, y: number, s: number) =>
  `M${x} ${y - 3.2 * s}l${-1.1 * s} ${1.3 * s}h${2.2 * s}zM${x} ${y - 2.4 * s}l${-1.4 * s} ${1.5 * s}h${2.8 * s}zM${x} ${y - 1.5 * s}l${-1.7 * s} ${1.5 * s}h${3.4 * s}zM${x - 0.25 * s} ${y}h${0.5 * s}v${-0.6 * s}h${-0.5 * s}z`;

/** The poster as SVG markup. `h` is its height in the 520-wide box; `seed` picks the skyline; `strip` drops the trail sign. */
export function posterSvg(tod: Tod, o: { h?: number; seed?: number; strip?: boolean } = {}): string {
  const h = o.h ?? 200, P = PALETTES[tod], rnd = mulberry32(o.seed ?? 7);
  const band = h * 0.62 / P.sky.length;
  const sky = P.sky.map((c, i) => `<rect y="${(i * band).toFixed(1)}" width="${W}" height="${(band + 1).toFixed(1)}" fill="${c}"/>`).join("");
  const discX = tod === "night" ? 112 : 388, discY = h * (tod === "day" ? 0.24 : 0.42), discR = h * (tod === "night" ? 0.11 : 0.13);
  const disc = tod === "night"
    ? `<circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/><circle cx="${discX + discR * 0.62}" cy="${discY - discR * 0.28}" r="${discR * 0.8}" fill="${P.sky[1]}"/>`
    : `<circle cx="${discX}" cy="${discY}" r="${discR * 1.5}" fill="${mix(P.disc, P.haze, 0.6)}"/><circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/>`;
  const stars = tod === "night" ? Array.from({ length: 26 }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * h * 0.42).toFixed(0)}" r="${(0.5 + rnd() * 0.9).toFixed(1)}"/>`).join("") : "";
  // Five ridges, far to near: each one darker and lower, the far ones melting into the haze.
  const ridges: string[] = [];
  let near = ridge(rnd, h, 0, h);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    near = ridge(rnd, h * (0.5 + 0.11 * i), h * (0.26 - 0.03 * i), h);
    ridges.push(`<path d="${near.d}" fill="${mix(mix(P.far, P.near, t), P.haze, 0.55 * (1 - t) ** 2)}"/>`);
  }
  const trees = Array.from({ length: 14 }, (_, i) => {
    const x = 14 + i * 37 + rnd() * 18;
    return `<path d="${pine(x, near.top(x) + 3, 5 + rnd() * 5)}"/>`;
  }).join("");
  const sign = o.strip ? "" : (() => {
    const x = 70, y = near.top(x) + 2;
    return `<g fill="${P.ink}"><rect x="${x - 1.5}" y="${y - 28}" width="3" height="28"/></g><path d="M${x - 2} ${y - 30}h38l8 6-8 6h-38z" fill="#6b4a2b" stroke="${P.ink}" stroke-width="1.4"/><path d="M${x + 4} ${y - 24}h26" stroke="#f3e2b8" stroke-width="2.2" stroke-linecap="round"/>`;
  })();
  // After dark: a ranger on the near skyline, and the torch beam sweeping the haze.
  const ranger = tod === "night" ? (() => {
    const x = 372, y = near.top(x) + 2;
    return `<path d="M${x + 4} ${y - 15}L${x + 160} ${y - 64}L${x + 176} ${y - 18}Z" fill="url(#beam)"/>`
      + `<g fill="${P.ink}"><circle cx="${x}" cy="${y - 19}" r="2.6"/><path d="M${x - 5} ${y - 22.5}h10l-2 -2h-6z"/><path d="M${x - 3} ${y - 16}h6l1 9h-2l-1 7h-2l-1 -7h-2z"/><path d="M${x + 2} ${y - 15}l4 1 -0.5 1.5 -4 -1z"/></g>`;
  })() : "";
  const defs = `<defs><linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2b0" stop-opacity="0.85"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></linearGradient></defs>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMax slice">${defs}${sky}<g fill="${P.disc}" opacity="0.85">${stars}</g>${disc}${ridges.join("")}${ranger}<g fill="${P.ink}">${trees}</g>${sign}</svg>`;
}

/** The poster as a CSS `url(...)`, for a background. */
export const posterUrl = (tod: Tod, o: { h?: number; seed?: number; strip?: boolean } = {}) => `url("data:image/svg+xml,${encodeURIComponent(posterSvg(tod, o))}")`;

/** Paint the menus for a time of day: the front card's art, the panels' strip (`--poster`), and `data-tod` for the type. */
export function paintPoster(tod: Tod, root: HTMLElement = document.documentElement): Tod {
  root.dataset.tod = tod;
  root.style.setProperty("--poster", posterUrl(tod, { h: 90, seed: 11, strip: true }));
  for (const el of document.querySelectorAll<HTMLElement>("[data-poster]")) el.innerHTML = posterSvg(tod, { h: 200, seed: 7 });
  return tod;
}
