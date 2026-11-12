// The menus' artwork (#3543): a screen-print park poster drawn as a small SVG, no image files. Flat sky bands, a sun or
// moon disc, five ridges that fade into the sky's haze, pines and a trail sign on the near ridge, and after dark a ranger
// on the skyline with a torch beam. The front card shows it whole; every panel wears a strip of it through `--poster`.
// About 4 KB of markup, drawn once per time of day. Round 2 (#3568) adds the ranger insignia, the results card's permit
// and stamp, and strips drawn to each panel's own width. Round 3 (#3584) prints it in two inks: a second colour knocked
// a hair off register behind the near ridge and the pines, and a halftone screen fading down each card's paper.
import { clamp, mulberry32 } from "@rustybuns/util";

export type Tod = "day" | "dusk" | "night";

/** The poster's time of day for an hour on the player's clock: dusk an hour or two either side of day. */
export const todAt = (hour: number): Tod => (hour >= 8 && hour < 17 ? "day" : (hour >= 6 && hour < 8) || (hour >= 17 && hour < 20) ? "dusk" : "night");

type Palette = { sky: string[]; haze: string; disc: string; near: string; far: string; ink: string; reg: string };
const PALETTES: Record<Tod, Palette> = {
  day: { sky: ["#e9a55c", "#f0bd78", "#f5d39a", "#f9e6bf"], haze: "#f9e6bf", disc: "#fff6dc", near: "#3a2a1e", far: "#c7834f", ink: "#24180f", reg: "#b4441c" },
  dusk: { sky: ["#3d2b4f", "#7a3a52", "#d9603b", "#f6b45a"], haze: "#f6b45a", disc: "#ffd98a", near: "#2a1b24", far: "#c0573c", ink: "#1d1219", reg: "#e07a1f" },
  night: { sky: ["#0d1426", "#16223a", "#22324e", "#33466a"], haze: "#33466a", disc: "#f1ecd2", near: "#06090f", far: "#2a3a58", ink: "#04060a", reg: "#3f5f92" },
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
export function posterSvg(tod: Tod, o: PosterOpts = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${o.h ?? 200}" preserveAspectRatio="xMidYMax slice">${posterInner(tod, o)}</svg>`;
}
type PosterOpts = { h?: number; seed?: number; strip?: boolean; disc?: boolean; ranger?: number; facing?: -1 | 1; size?: number };

function posterInner(tod: Tod, o: PosterOpts): string {
  const h = o.h ?? 200, P = PALETTES[tod], rnd = mulberry32(o.seed ?? 7);
  const band = h * 0.62 / P.sky.length;
  const sky = P.sky.map((c, i) => `<rect y="${(i * band).toFixed(1)}" width="${W}" height="${(band + 1).toFixed(1)}" fill="${c}"/>`).join("");
  const discX = tod === "night" ? 112 : 388, discY = h * (tod === "day" ? 0.33 : tod === "night" && !o.strip ? 0.44 : 0.38), discR = h * (tod === "night" ? 0.11 : 0.13);
  const disc = o.disc === false ? "" : tod === "night"
    ? `<circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/><circle cx="${discX + discR * 0.62}" cy="${discY - discR * 0.28}" r="${discR * 0.8}" fill="${P.sky[1]}"/>`
    : `<circle cx="${discX}" cy="${discY}" r="${discR * 1.5}" fill="${mix(P.disc, P.haze, 0.6)}"/><circle cx="${discX}" cy="${discY}" r="${discR}" fill="${P.disc}"/>`;
  const stars = tod === "night" ? Array.from({ length: 26 }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * h * 0.42).toFixed(0)}" r="${(0.5 + rnd() * 0.9).toFixed(1)}"/>`).join("") : "";
  // Ridges far to near: each one darker and lower, the far ones melting into the haze. A strip prints five; the
  // full poster (round 5, #4220) prints seven, closer together, with valley mist at the foot of every far one.
  const ridges: string[] = [];
  const n = o.strip ? 5 : 7;
  let near = ridge(rnd, h, 0, h), high = near;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    near = ridge(rnd, h * (0.54 + 0.4 * t), h * (0.2 - 0.088 * t), h);
    // The near ridge's second ink, printed a hair off register: a bright sliver along its skyline.
    if (i === n - 2) high = near;
    if (i === n - 1) ridges.push(`<path d="${near.d}" fill="${P.reg}" transform="translate(2.5 -2)"/>`);
    ridges.push(`<path d="${near.d}" fill="${mix(mix(P.far, P.near, t), P.haze, 0.6 * (1 - t) ** 2)}"/>`);
    if (i < n - 2 && !o.strip) ridges.push(`<rect y="${(h * (0.5 + 0.4 * t)).toFixed(1)}" width="${W}" height="${(h * 0.08).toFixed(1)}" fill="url(#mist)" opacity="${(0.75 - 0.5 * t).toFixed(2)}"/>`);
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
    // Round 7 (#4229): a strip's ranger stands left of the results patch and half again as tall, so it reads.
    const x = o.ranger ?? (o.strip ? 318 : 262), y = (o.strip ? near : high).top(x) + 2, k = o.size ?? (o.strip ? 1.45 : 1.6);
    return `<g transform="translate(${x} ${y}) scale(${k * (o.facing ?? 1)} ${k}) translate(${-x} ${-y})"><path d="M${x + 4} ${y - 15}L${x + 160} ${y - 70}L${x + 172} ${y - 12}Z" fill="url(#beam)"/><path d="M${x + 4} ${y - 15}L${x + 120} ${y - 46}L${x + 124} ${y - 30}Z" fill="#fff6c8" opacity="0.55"/><circle cx="${x + 5}" cy="${y - 14.5}" r="2.4" fill="#fff6c8"/>`
      + `<g fill="${P.ink}" stroke="${P.disc}" stroke-width="0.7" stroke-opacity="0.8" paint-order="stroke"><circle cx="${x}" cy="${y - 19}" r="2.6"/><path d="M${x - 5} ${y - 22.5}h10l-2 -2h-6z"/><path d="M${x - 3} ${y - 16}h6l1 9h-2l-1 7h-2l-1 -7h-2z"/><path d="M${x + 2} ${y - 15}l4 1 -0.5 1.5 -4 -1z"/></g></g>`;
  })() : "";
  const defs = `<defs><linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff2b0" stop-opacity="0.85"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></linearGradient>`
    + `<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.haze}" stop-opacity="0"/><stop offset="0.55" stop-color="${P.haze}" stop-opacity="0.8"/><stop offset="1" stop-color="${P.haze}" stop-opacity="0"/></linearGradient></defs>`;
  return `${defs}${sky}<g fill="${P.disc}" opacity="0.85">${stars}</g>${disc}${ridges.join("")}${o.strip ? ranger : ""}<g fill="${P.reg}" transform="translate(1.8 -1.4)">${trees}</g><g fill="${P.ink}">${trees}</g>${o.strip ? "" : ranger}${sign}`;
}

/** Round 7 (#4229). The whole screen behind the menus as the poster, so a card sits on the print, not on the 3D render:
 *  a 400-tall poster pinned to the foot, its top sky band carried up to fill a tall screen, and there the sun or moon
 *  and more stars, clear of the card (on a wide screen, between the lobby's two panels). After dark the ranger stands
 *  right of centre, turned so the torch sweeps the gap the lobby's panels leave.
 *  `aspect` is the screen's height over its width. About 5 KB. */
export function backdropSvg(tod: Tod, aspect: number): string {
  const P = PALETTES[tod], ph = 400, H = Math.max(ph, Math.round((W * aspect) / 20) * 20), tall = H - ph > 160, rnd = mulberry32(23);
  const top = tall ? H - ph : 0;
  const stars = tod === "night" ? Array.from({ length: Math.round(top / 14) }, () => `<circle cx="${(rnd() * W).toFixed(0)}" cy="${(rnd() * top).toFixed(0)}" r="${(0.6 + rnd()).toFixed(1)}"/>`).join("") : "";
  // Tall: in the sky above the card. Wide: high in the gap between the lobby's panels, clear of the ridges.
  const r = tall ? 34 : 22, cx = tall ? (tod === "night" ? 120 : 400) : 320, cy = tall ? Math.min(top * 0.45, 90) : 118, cut = tall ? P.sky[0] : P.sky[1];
  const disc = tod === "night"
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.disc}"/><circle cx="${cx + r * 0.62}" cy="${cy - r * 0.28}" r="${r * 0.8}" fill="${cut}"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r * 1.5}" fill="${mix(P.disc, cut, 0.55)}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.disc}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice"><rect width="${W}" height="${H}" fill="${P.sky[0]}"/>`
    + `<g fill="${P.disc}" opacity="0.8">${stars}</g><svg y="${H - ph}" width="${W}" height="${ph}" viewBox="0 0 ${W} ${ph}">${posterInner(tod, { h: ph, seed: 5, disc: false, ranger: 395, facing: -1, size: 0.85 })}</svg>${disc}</svg>`;
}

/** Round 7 (#4229). Low ridges and pines printed faintly along the foot of the Controls card, in the poster's inks. */
export function ridgeFootSvg(tod: Tod): string {
  const P = PALETTES[tod], h = 90, rnd = mulberry32(31);
  const rows = [0, 1, 2].map((i) => ridge(rnd, h * (0.62 + 0.18 * i), h * (0.42 - 0.1 * i), h));
  const trees = Array.from({ length: 11 }, (_, i) => { const x = 20 + i * 48 + rnd() * 20; return `<path d="${pine(x, rows[2]!.top(x) + 3, 4 + rnd() * 4)}"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMax slice">`
    + rows.map((r, i) => `<path d="${r.d}" fill="${i < 2 ? P.far : P.near}" fill-opacity="${[0.16, 0.24, 0.3][i]}"/>`).join("")
    + `<g fill="${P.near}" fill-opacity="0.38">${trees}</g></svg>`;
}

/** The poster as a CSS `url(...)`, for a background. */
export const posterUrl = (tod: Tod, o: PosterOpts = {}) => `url("data:image/svg+xml,${encodeURIComponent(posterSvg(tod, o))}")`;

/** A screen-print halftone for a card's paper, as SVG markup: rows of dots on a 45-degree screen in the poster's second
 *  ink, big at the top (under the strip) and shrinking to nothing `h` px down. One pattern per row, about 2 KB. */
export function halftoneSvg(tod: Tod, h = 120): string {
  const step = 6, rows = Math.max(1, Math.floor(h / step)), P = PALETTES[tod];
  const pats: string[] = [], rects: string[] = [];
  for (let i = 0; i < rows; i++) {
    const r = (1.9 * (1 - i / rows) ** 1.4).toFixed(2);
    pats.push(`<pattern id="h${i}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="${r}"/><circle cx="4.5" cy="4.5" r="${r}"/></pattern>`);
    rects.push(`<rect y="${i * step}" width="${W}" height="${step}" fill="url(#h${i})"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rows * step}"><defs>${pats.join("")}</defs><g fill="${P.reg}" fill-opacity="${tod === "night" ? 0.22 : 0.16}">${rects.join("")}</g></svg>`;
}

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

/** The results card's citation head (a typed line and its permit number) and its rubber stamp. `stamp` is plain text.
 *  The front card wears the same line under another label, numbered for the day. */
export const permitLine = (key: string, label = "Citation") => `<span>${label}</span><span><i class="long">Backcountry permit </i><b>No. ${permitNo(key)}</b></span>`;
export const permitHead = (key: string) => `<p class="permit">${permitLine(key)}</p>`;
export const stampHtml = (stamp: string) => `<span class="stamp">${stamp.replace(/[&<>]/g, "")}</span>`;

/** How tall the panels' strip is drawn in the poster's 520-wide box, for a panel `w` px wide under a 76 px strip: a
 *  wide panel gets a squatter poster so its sun isn't sliced off the top, a narrow one crops the sides and keeps the sky. */
export const stripH = (w: number, strip = 76) => Math.round(clamp((W * strip) / Math.max(1, w), 64, 140) / 4) * 4;

/** A seed for a name: the same park always gets the same skyline on its patch. */
const seedOf = (name: string) => { let h = 2166136261; for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h % 100000; };

/** Round 4 (#3608). The results card's award: a round embroidered park patch, our own design. Inside, that park's own
 *  skyline (the poster seeded by its name) under a stitched ring; the park's name runs around the top of the ring and
 *  the round's outcome around the foot. About 5 KB with the poster inside. `id` keeps its clip and arcs apart. */
export function patchSvg(t: Tod, park: string, outcome: string, id = "pa"): string {
  const P = PALETTES[t], wood = "#4b3a26", cream = "#f3e2b8", clean = (x: string) => x.replace(/[&<>"]/g, "").toUpperCase();
  const name = clean(park), long = name.length > 16;
  const inner = posterSvg(t, { h: 240, seed: seedOf(park) }).replace("<svg ", `<svg x="26" y="26" width="88" height="88" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140" role="img" aria-label="${name}: ${clean(outcome)}">`
    + `<defs><clipPath id="${id}-in"><circle cx="70" cy="70" r="44"/></clipPath>`
    + `<path id="${id}-top" d="M17 70a53 53 0 0 1 106 0"/><path id="${id}-foot" d="M14 70a56 56 0 0 0 112 0"/></defs>`
    + `<circle cx="70" cy="70" r="68" fill="${wood}"/><circle cx="70" cy="70" r="64" fill="#9a3412"/>`
    + `<circle cx="70" cy="70" r="61" fill="none" stroke="${cream}" stroke-width="1.3" stroke-dasharray="3 2.4"/>`
    + `<g clip-path="url(#${id}-in)">${inner}</g><circle cx="70" cy="70" r="45" fill="none" stroke="${wood}" stroke-width="3"/>`
    + `<circle cx="70" cy="70" r="48" fill="none" stroke="${P.reg === "#b4441c" ? "#e07a1f" : P.reg}" stroke-width="1.2" stroke-dasharray="2 2"/>`
    + `<g fill="${cream}" style="font-family:var(--plate);font-weight:700" letter-spacing="${long ? 0.6 : 1.6}" font-size="${long ? 9 : 11}">`
    + `<text text-anchor="middle"><textPath href="#${id}-top" startOffset="50%">${name}</textPath></text>`
    + `<text text-anchor="middle" font-size="8.5" letter-spacing="1.4" dy="6"><textPath href="#${id}-foot" startOffset="50%">${clean(outcome)}</textPath></text></g>`
    + `<path d="M8 70l4-3 0 6zM132 70l-4-3 0 6z" fill="${cream}"/></svg>`;
}
/** The patch for the results card, sewn on at the strip's foot. */
export const awardHtml = (park: string, outcome: string, t: Tod = tod) => `<div class="award">${patchSvg(t, park, outcome)}</div>`;

let tod: Tod = "day";
const strips = new Map<string, string>();
const stripUrl = (h: number) => {
  const k = `${tod}:${h}`;
  if (!strips.has(k)) strips.set(k, posterUrl(tod, { h, seed: 11, strip: true }));
  return strips.get(k)!;
};
const paintStrip = (el: HTMLElement) => { if (el.clientWidth) el.style.setProperty("--poster", stripUrl(stripH(el.clientWidth, Number(el.dataset.strip) || 76))); };
let sized: ResizeObserver | undefined;
let backdropSized = false, backdropKey = "";
/** The screen-filling poster behind the menus (`#backdrop`), redrawn when the time of day or the screen's shape changes. */
function paintBackdrop() {
  const el = document.getElementById("backdrop");
  if (!el || !innerWidth) return;
  const aspect = Math.round((innerHeight / innerWidth) * 20) / 20, k = `${tod}:${aspect}`;
  if (k === backdropKey) return;
  backdropKey = k;
  el.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(backdropSvg(tod, aspect))}")`;
}

/** Paint the menus for a time of day: the front card's art and insignia, each panel's strip (`--poster`, drawn to that
 *  panel's width and redrawn when it changes), the paper's halftone (`--halftone`), the panel heads' badge
 *  (`--insignia`), and `data-tod` for the type. */
export function paintPoster(t: Tod, root: HTMLElement = document.documentElement): Tod {
  tod = t;
  root.dataset.tod = t;
  root.style.setProperty("--poster", posterUrl(t, { h: 90, seed: 11, strip: true }));
  root.style.setProperty("--halftone", `url("data:image/svg+xml,${encodeURIComponent(halftoneSvg(t))}")`);
  root.style.setProperty("--insignia", `url("data:image/svg+xml,${encodeURIComponent(insigniaSvg(t))}")`);
  root.style.setProperty("--ridgefoot", `url("data:image/svg+xml,${encodeURIComponent(ridgeFootSvg(t))}")`);
  paintBackdrop();
  if (!backdropSized && typeof window !== "undefined") { backdropSized = true; window.addEventListener("resize", () => requestAnimationFrame(paintBackdrop)); }
  for (const el of document.querySelectorAll<HTMLElement>("[data-poster]")) el.innerHTML = posterSvg(t, { h: 230, seed: 7 });
  for (const el of document.querySelectorAll<HTMLElement>("[data-insignia]")) el.innerHTML = insigniaSvg(t, { ribbon: true });
  if (typeof ResizeObserver === "function") sized ??= new ResizeObserver((es) => { for (const e of es) if (e.target instanceof HTMLElement) paintStrip(e.target); });
  for (const el of document.querySelectorAll<HTMLElement>(".panel, .gc-card")) { sized?.observe(el); paintStrip(el); }
  return t;
}

/** Round 6 (#4226). A park chip's patch: a tiny round badge with that park's own skyline (seeded by its name, like the
 *  results patch) in three flat ridges under the sun or moon. About 700 bytes, drawn once per park and time of day. */
const chipPatches = new Map<string, string>();
export function chipPatchSvg(park: string, t: Tod = tod): string {
  const k = `${t}:${park}`, hit = chipPatches.get(k);
  if (hit) return hit;
  const P = PALETTES[t], rnd = mulberry32(seedOf(park)), h = 520;
  const sky = P.sky.slice(1).map((c, i) => `<rect y="${i * 110}" width="${W}" height="${i === 2 ? h : 111}" fill="${c}"/>`).join("");
  const dx = 130 + rnd() * 260, dy = 120 + rnd() * 40;
  const disc = t === "night" ? `<circle cx="${dx.toFixed(0)}" cy="${dy.toFixed(0)}" r="52" fill="${P.disc}"/><circle cx="${(dx + 32).toFixed(0)}" cy="${(dy - 15).toFixed(0)}" r="42" fill="${P.sky[2]}"/>`
    : `<circle cx="${dx.toFixed(0)}" cy="${dy.toFixed(0)}" r="60" fill="${P.disc}"/>`;
  const ridges = [0, 0.5, 1].map((s) => `<path d="${ridge(rnd, h * (0.5 + 0.3 * s), h * (0.36 - 0.1 * s), h).d}" fill="${mix(mix(P.far, P.near, s), t === "night" ? "#7d93b8" : P.haze, 0.55 * (1 - s) ** 2)}"/>`).join("");
  const svg = `<span class="chip-patch" aria-hidden="true"><svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="xMidYMid slice">${sky}${disc}${ridges}</svg></span>`;
  chipPatches.set(k, svg);
  return svg;
}

/** Round 6 (#4226). A region's trail marker, the blaze painted on a post where trails split: each region gets its own
 *  shape (diamond, circle, triangle, square, arrow, bar) so the list reads as signposts, not a sheet of planks. */
const BLAZES = ["M8 1l7 7-7 7-7-7z", "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1z", "M8 1.5l7 12.5H1z", "M2 2h12v12H2z", "M1 4h8V1l6 7-6 7v-3H1z", "M1 5h14v6H1z"];
export const blazeSvg = (i: number) => `<svg class="blaze" viewBox="0 0 16 16" aria-hidden="true"><path d="${BLAZES[i % BLAZES.length]}"/></svg>`;
