// The menus' artwork (#3543): a screen-print park poster drawn as a small SVG, no image files. Flat sky bands, a sun or
// moon disc, five ridges that fade into the sky's haze, pines and a trail sign on the near ridge, and after dark a ranger
// on the skyline with a torch beam. The front card shows it whole; every panel wears a strip of it through `--poster`.
// About 4 KB of markup, drawn once per time of day. Round 2 (#3568) adds the ranger insignia, the results card's permit
// and stamp, and strips drawn to each panel's own width.
import { clamp, mulberry32 } from "@rustybuns/util";

export type Tod = "day" | "dusk" | "night";

/** The poster's time of day for an hour on the player's clock: dusk an hour or two either side of day. */
export const todAt = (hour: number): Tod => (hour >= 8 && hour < 17 ? "day" : (hour >= 6 && hour < 8) || (hour >= 17 && hour < 20) ? "dusk" : "night");

type Palette = { sky: string[]; haze: string; disc: string; near: string; far: string; ink: string };
const PALETTES: Record<Tod, Palette> = {
  day: { sky: ["#e9a55c", "#f0bd78", "#f5d39a", "#f9e6bf"], haze: "#f9e6bf", disc: "#fff6dc", near: "#3a2a1e", far: "#c7834f", ink: "#24180f" },
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
  const discX = tod === "night" ? 112 : 388, discY = h * (tod === "day" ? 0.33 : 0.38), discR = h * (tod === "night" ? 0.11 : 0.13);
  const disc = tod === "night"
    ? `<circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/><circle cx="${discX + discR * 0.62}" cy="${discY - discR * 0.28}" r="${discR * 0.8}" fill="${P.sky[1]}"/>`
    : `<circle cx="${discX}" cy="${discY}" r="${discR * 1.5}" fill="${mix(P.disc, P.haze, 0.6)}"/><circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/>`;
  const stars = tod === "night" ? Array.from({ length: 26 }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * h * 0.42).toFixed(0)}" r="${(0.5 + rnd() * 0.9).toFixed(1)}"/>`).join("") : "";
  // Five ridges, far to near: each one darker and lower, the far ones melting into the haze.
  const ridges: string[] = [];
  let near = ridge(rnd, h, 0, h);
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    near = ridge(rnd, h * (0.54 + 0.1 * i), h * (0.2 - 0.022 * i), h);
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

/** The ranger insignia, our own: a flat-topped shield with the poster's sky, a ridge and a pine, and with `ribbon` a
 *  rust banner reading RANGER across its foot. About 1.2 KB. Its clip id is unique, so it can sit inline beside the poster. */
export function insigniaSvg(tod: Tod, o: { ribbon?: boolean } = {}): string {
  const P = PALETTES[tod], wood = "#4b3a26", cream = "#f3e2b8";
  const inner = "M9 9h46v27c0 15-10 25-23 30C19 61 9 51 9 36z";
  const disc = tod === "night"
    ? `<circle cx="42" cy="22" r="6" fill="${P.disc}"/><circle cx="45" cy="20" r="5" fill="${P.sky[1]}"/>`
    : `<circle cx="42" cy="24" r="9" fill="${mix(P.disc, P.haze, 0.6)}"/><circle cx="42" cy="24" r="6" fill="${P.disc}"/>`;
  const ribbon = o.ribbon
    ? `<path d="M0 52h64l-4 5 4 5H0l4-5z" fill="#9a3412" stroke="${wood}" stroke-width="1.2"/><text x="32" y="59.6" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="7" letter-spacing="1.6" fill="${cream}">RANGER</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 76"><defs><clipPath id="ins-in"><path d="${inner}"/></clipPath></defs>`
    + `<path d="M4 4h56v32c0 19-13 31-28 37C17 67 4 55 4 36z" fill="${wood}" stroke="${cream}" stroke-opacity="0.55" stroke-width="1.2"/>`
    + `<g clip-path="url(#ins-in)"><rect width="64" height="76" fill="${P.sky[1]}"/><rect y="28" width="64" height="12" fill="${P.sky[3]}"/>${disc}`
    + `<path d="M9 42L19 31l6 5 9-11 10 12 5-4 6 6v38H9z" fill="${mix(P.far, P.haze, 0.25)}"/><path d="M9 50l12-7 9 5 11-6 14 7v27H9z" fill="${mix(P.far, P.near, 0.6)}"/>`
    + `<path d="${pine(32, 60, 8.5)}" fill="${P.ink}"/></g>`
    + `<path d="${inner}" fill="none" stroke="${cream}" stroke-width="2"/>${ribbon}</svg>`;
}

/** A results card's permit number, steady for a key (the zone and round): two digits, a dash, four more. */
export function permitNo(key: string): string {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return `${10 + (h % 90)}-${String(1000 + (Math.floor(h / 90) % 9000))}`;
}

/** The results card's citation head (a typed line and its permit number) and its rubber stamp. `stamp` is plain text. */
export const permitHead = (key: string) => `<p class="permit"><span>Citation</span><span>Backcountry permit <b>No. ${permitNo(key)}</b></span></p>`;
export const stampHtml = (stamp: string) => `<span class="stamp">${stamp.replace(/[&<>]/g, "")}</span>`;

/** How tall the panels' strip is drawn in the poster's 520-wide box, for a panel `w` px wide under a 76 px strip: a
 *  wide panel gets a squatter poster so its sun isn't sliced off the top, a narrow one crops the sides and keeps the sky. */
export const stripH = (w: number) => Math.round(clamp((W * 76) / Math.max(1, w), 64, 100) / 4) * 4;

let tod: Tod = "day";
const strips = new Map<string, string>();
const stripUrl = (h: number) => {
  const k = `${tod}:${h}`;
  if (!strips.has(k)) strips.set(k, posterUrl(tod, { h, seed: 11, strip: true }));
  return strips.get(k)!;
};
const paintStrip = (el: HTMLElement) => { if (el.clientWidth) el.style.setProperty("--poster", stripUrl(stripH(el.clientWidth))); };
let sized: ResizeObserver | undefined;

/** Paint the menus for a time of day: the front card's art and insignia, each panel's strip (`--poster`, drawn to that
 *  panel's width and redrawn when it changes), the panel heads' badge (`--insignia`), and `data-tod` for the type. */
export function paintPoster(t: Tod, root: HTMLElement = document.documentElement): Tod {
  tod = t;
  root.dataset.tod = t;
  root.style.setProperty("--poster", posterUrl(t, { h: 90, seed: 11, strip: true }));
  root.style.setProperty("--insignia", `url("data:image/svg+xml,${encodeURIComponent(insigniaSvg(t))}")`);
  for (const el of document.querySelectorAll<HTMLElement>("[data-poster]")) el.innerHTML = posterSvg(t, { h: 140, seed: 7 });
  for (const el of document.querySelectorAll<HTMLElement>("[data-insignia]")) el.innerHTML = insigniaSvg(t, { ribbon: true });
  if (typeof ResizeObserver === "function") sized ??= new ResizeObserver((es) => { for (const e of es) if (e.target instanceof HTMLElement) paintStrip(e.target); });
  for (const el of document.querySelectorAll<HTMLElement>(".panel, .gc-card")) { sized?.observe(el); paintStrip(el); }
  return t;
}
