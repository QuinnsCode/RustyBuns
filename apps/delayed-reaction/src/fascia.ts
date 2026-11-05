// The menu's artwork: the front of a dub radio, drawn in code as small SVGs (no image files). Cold near-white on black
// like the tunnel; the only colour is the lanes' own (the preset LEDs and tape codes, the VU meter's hot end). Weights,
// as strings: a screw ~0.4 KB, the dial face ~4 KB, a worn knob ~3 KB, a VU meter ~2.5 KB, the grille and tape-fibre
// tiles ~0.5 KB each. Wear, tears and scuffs come from seeded streams, so each piece wears the same way every time.
import { mulberry32 } from "@rustybuns/util";

const INK = "#e9ecf2";
export const LANE_COLOURS = ["#ff5fa2", "#ffc542", "#4de3ff", "#9dff5f"] as const;
const MONO = "ui-monospace,Menlo,monospace";
const svg = (w: number, h: number, body: string, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const f = (n: number) => Math.round(n * 10) / 10;
const dataUri = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`)}")`;

const screwBody = (turn: number, id: string) => `<defs><radialGradient id="${id}" cx="35%" cy="30%"><stop offset="0" stop-color="#5c6170"/><stop offset="1" stop-color="#15171d"/></radialGradient></defs>
  <circle cx="8" cy="8" r="6.5" fill="url(#${id})" stroke="#000" stroke-width="1"/><rect x="2.8" y="7.2" width="10.4" height="1.6" rx=".6" fill="#07080b" transform="rotate(${turn} 8 8)"/>`;
/** A panel screw, its slot turned a little differently on each corner. */
export const screw = (turn: number) => svg(16, 16, screwBody(turn, `s${turn}`), "screw");

/** The station display's dial: a backlit face, a faint echo of the tunnel's grid running to a vanishing point, a tick every
 * 2 bpm from LO to HI numbered every 10, and a needle the menu moves (--needle on an ancestor). The needle stays under the numbers. */
export const LO = 80, HI = 150;
export function tuningScale() {
  const w = 300, x = (bpm: number) => f(10 + ((bpm - LO) / (HI - LO)) * (w - 20));
  let ticks = "", grid = "";
  for (let b = LO; b <= HI; b += 2) {
    const big = b % 10 === 0;
    ticks += `<line x1="${x(b)}" x2="${x(b)}" y1="${big ? 15 : 19}" y2="27" stroke="${INK}" stroke-opacity="${big ? 0.9 : 0.38}" stroke-width="${big ? 1.2 : 0.8}"/>`;
    if (big) ticks += `<text x="${x(b)}" y="10" text-anchor="middle" fill="${INK}" fill-opacity=".75" font-size="7.5" font-family="${MONO}">${b}</text>`;
  }
  for (let i = -6; i <= 6; i++) grid += `<line x1="150" y1="20" x2="${150 + i * 38}" y2="44" stroke="${INK}" stroke-opacity=".06"/>`;
  for (const y of [24, 29, 36]) grid += `<line x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="${INK}" stroke-opacity=".05"/>`;
  return svg(w, 44, `<defs><radialGradient id="glow" cx="50%" cy="65%" r="60%"><stop offset="0" stop-color="#cfe6ff" stop-opacity=".16"/><stop offset="1" stop-color="#cfe6ff" stop-opacity="0"/></radialGradient></defs>
    <rect x="0" y="0" width="${w}" height="44" fill="url(#glow)"/>${grid}${ticks}
    <line x1="10" x2="${w - 10}" y1="27" y2="27" stroke="${INK}" stroke-opacity=".55" stroke-width=".8"/>
    <text x="${w - 10}" y="39" text-anchor="end" fill="${INK}" fill-opacity=".45" font-size="6.5" letter-spacing="1" font-family="${MONO}">BPM</text>
    <g class="needle"><line x1="0" x2="0" y1="13" y2="34" stroke="#f4f8ff" stroke-width="1.6"/><line x1="0" x2="0" y1="13" y2="34" stroke="#cfe6ff" stroke-opacity=".35" stroke-width="6"/></g>`, "scale");
}
/** Where the needle stands for a tempo, as a share of the scale's width (the CSS turns it into a translate). */
export const needleAt = (bpm: number) => (10 + ((Math.min(HI, Math.max(LO, bpm)) - LO) / (HI - LO)) * 280) / 300;

/** A knurled knob that has been turned a lot: worn and missing knurls, scuffs on the cap, and a chipped index dot.
 * Its pointer turns with a CSS rotate; the name is engraved under it. */
export function knob(name: string, seed: number) {
  const rnd = mulberry32(seed * 104729 + 7), at = (deg: number, r: number) => {
    const a = (deg - 90) * Math.PI / 180;
    return [f(24 + Math.cos(a) * r), f(24 + Math.sin(a) * r)] as const;
  };
  let knurl = "", scale = "", scuffs = "";
  for (let i = 0; i < 44; i++) {
    const wear = rnd();
    if (wear < 0.1) continue; // worn smooth
    const [x1, y1] = at((i / 44) * 360, 15), [x2, y2] = at((i / 44) * 360, 17.6);
    knurl += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-opacity="${f(0.12 + wear * 0.25)}" stroke-width="1"/>`;
  }
  for (let i = 0; i <= 10; i++) {
    const [x1, y1] = at(-135 + i * 27, 20), [x2, y2] = at(-135 + i * 27, i % 5 === 0 ? 23.5 : 22.4);
    scale += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-opacity=".6" stroke-width="${i % 5 === 0 ? 1.3 : 0.9}"/>`;
  }
  for (let i = 0; i < 3; i++) {
    const d = rnd() * 360, r = 4 + rnd() * 6, [x1, y1] = at(d, r), [x2, y2] = at(d + 25 + rnd() * 30, r);
    scuffs += `<path d="M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="#fff" stroke-opacity=".09" stroke-width=".6"/>`;
  }
  const id = `k${seed}`;
  return `<figure class="knob">${svg(48, 48, `<defs><radialGradient id="${id}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#3a3f4a"/><stop offset=".55" stop-color="#171a20"/><stop offset="1" stop-color="#0a0b0e"/></radialGradient></defs>
    ${scale}<circle cx="24" cy="24" r="17.6" fill="#0d0f14" stroke="#000" stroke-width="1.5"/>${knurl}
    <circle cx="24" cy="24" r="12.5" fill="url(#${id})" stroke="${INK}" stroke-opacity=".16"/>${scuffs}
    <path d="M 15.5 18 A 10 10 0 0 1 27 13.7" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.4" stroke-linecap="round"/>
    <g class="pointer"><line x1="24" y1="21" x2="24" y2="13.2" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="15" r="1.3" fill="#fff" fill-opacity=".85"/><circle cx="24.7" cy="14.3" r=".5" fill="#0d0f14"/></g>`)}<figcaption>${name}</figcaption></figure>`;
}

/** The speaker grille behind the tapes: one tile of holes, as a CSS background. */
export const grille = dataUri(`<circle cx="3.5" cy="3.5" r="1.3" fill="#000" fill-opacity=".9"/><circle cx="3.2" cy="3.1" r="1.25" fill="#fff" fill-opacity=".06"/>`, 7, 7);
/** The fibre in a strip of tape: a soft noise tile laid over the paper colour. */
export const fibre = dataUri(`<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.1 .18" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .2  0 0 0 0 .23  0 0 0 0 .28  0 0 0 -1.1 .55"/></filter><rect width="96" height="48" filter="url(#n)"/>`, 96, 48);

/** A strip of tape's torn ends as a clip-path, seeded so each label keeps its own tear, and a slight tilt. */
export function tear(seed: number) {
  const rnd = mulberry32(seed * 7919 + 13), steps = 6, pts: string[] = [];
  for (let i = 0; i <= steps; i++) pts.push(`${f(rnd() * 3.5)}% ${f((i / steps) * 100)}%`);
  for (let i = steps; i >= 0; i--) pts.push(`${f(100 - rnd() * 3.5)}% ${f((i / steps) * 100)}%`);
  return { clip: `polygon(${pts.join(",")})`, tilt: f((rnd() - 0.5) * 2.4) };
}

/** A VU meter: an arc from -20 to +3, the hot end in the miss colour, a needle the CSS turns (--vu, 0 quiet to 1 pinned, on an
 * ancestor) and a backlit face. `label` is what it reads; the needle's swing has its own pivot so a transition can move it. */
export function vuMeter(label = "VU") {
  const cx = 60, cy = 64, r = 46, at = (v: number) => (-50 + v * 100) * Math.PI / 180;
  const pt = (v: number, rr: number) => [f(cx + Math.sin(at(v)) * rr), f(cy - Math.cos(at(v)) * rr)] as const;
  let marks = "";
  for (const [text, v] of [["-20", 0], ["-10", 0.3], ["-5", 0.5], ["-3", 0.62], ["0", 0.8], ["+3", 1]] as const) {
    const hot = v >= 0.8, c = hot ? LANE_COLOURS[0] : INK, [x1, y1] = pt(v, r - 6), [x2, y2] = pt(v, r), [tx, ty] = pt(v, r + 7);
    marks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="1.2"/><text x="${tx}" y="${ty}" text-anchor="middle" font-size="7" fill="${c}" fill-opacity=".85" font-family="${MONO}">${text}</text>`;
  }
  const [ax, ay] = pt(0, r), [bx, by] = pt(0.8, r), [hx, hy] = pt(1, r);
  return svg(120, 76, `<defs><radialGradient id="vuf" cx="50%" cy="85%" r="80%"><stop offset="0" stop-color="#cfe6ff" stop-opacity=".18"/><stop offset="1" stop-color="#cfe6ff" stop-opacity="0"/></radialGradient></defs>
    <rect x="1" y="1" width="118" height="74" rx="6" fill="#0b0d12" stroke="${INK}" stroke-opacity=".28"/><rect x="1" y="1" width="118" height="74" rx="6" fill="url(#vuf)"/>
    <path d="M ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by}" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width="1"/>
    <path d="M ${bx} ${by} A ${r} ${r} 0 0 1 ${hx} ${hy}" fill="none" stroke="${LANE_COLOURS[0]}" stroke-width="2.5"/>${marks}
    <g class="vu-needle"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r + 2}" stroke="#f4f8ff" stroke-width="1.4" stroke-linecap="round"/></g>
    <rect x="${cx - 22}" y="${cy - 2}" width="44" height="12" fill="#0b0d12"/><circle cx="${cx}" cy="${cy}" r="4" fill="#16191f" stroke="${INK}" stroke-opacity=".4"/>
    <text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="6.5" letter-spacing="1" fill="${INK}" fill-opacity=".55" font-family="${MONO}">${label}</text>`, "vu");
}
/** The needle's angle for a level, for the CSS rotate about the meter's pivot. */
export const vuTurn = (level: number) => `${f(-50 + Math.min(1, Math.max(0, level)) * 100)}deg`;

/** The Controls dialog's backplate (its `--ui-panel` token): the fascia's brushed black with a screw in each corner. */
export const backplate = [
  ...([["left 10px top 10px", 20], ["right 10px top 10px", 75], ["left 10px bottom 10px", 130], ["right 10px bottom 10px", 160]] as const)
    .map(([pos, turn]) => `${dataUri(screwBody(turn, "s"), 16, 16)} ${pos} / 13px 13px no-repeat`),
  "linear-gradient(#14161b, #08090c 35%, #0b0c10)",
].join(", ");
