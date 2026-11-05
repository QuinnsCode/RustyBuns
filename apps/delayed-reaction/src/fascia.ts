// The menu's artwork: the front of a dub radio, drawn in code as small SVGs (no image files). Near-white on black like
// the tunnel; the only colour is the lanes' own, on the preset LEDs and the VU meter's hot end. Weights, as strings:
// a screw ~0.4 KB, the tuning scale ~3 KB, a knob ~2 KB, the VU meter ~2 KB, the grille tile ~0.2 KB. Each tape label's
// torn ends are a clip-path cut from a seeded stream, so a label tears the same way every time.
import { mulberry32 } from "@rustybuns/util";

const INK = "#e9ecf2";
export const LANE_COLOURS = ["#ff5fa2", "#ffc542", "#4de3ff", "#9dff5f"] as const;
const svg = (w: number, h: number, body: string, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const f = (n: number) => Math.round(n * 10) / 10;

/** A panel screw, its slot turned a little differently on each corner. */
export const screw = (turn: number) => svg(16, 16, `<defs><radialGradient id="s${turn}" cx="35%" cy="30%"><stop offset="0" stop-color="#5c6170"/><stop offset="1" stop-color="#15171d"/></radialGradient></defs>
  <circle cx="8" cy="8" r="6.5" fill="url(#s${turn})" stroke="#000" stroke-width="1"/><rect x="2.8" y="7.2" width="10.4" height="1.6" rx=".6" fill="#07080b" transform="rotate(${turn} 8 8)"/>`, "screw");

/** The station display's tuning scale: a tick every 2 bpm from LO to HI, numbered every 10, and a needle the menu moves (--bpm on its parent). */
export const LO = 80, HI = 150;
export function tuningScale() {
  const w = 300, x = (bpm: number) => f(10 + ((bpm - LO) / (HI - LO)) * (w - 20));
  let ticks = "";
  for (let b = LO; b <= HI; b += 2) {
    const big = b % 10 === 0;
    ticks += `<line x1="${x(b)}" x2="${x(b)}" y1="${big ? 14 : 18}" y2="26" stroke="${INK}" stroke-opacity="${big ? 0.85 : 0.35}" stroke-width="${big ? 1.2 : 0.8}"/>`;
    if (big) ticks += `<text x="${x(b)}" y="10" text-anchor="middle" fill="${INK}" fill-opacity=".7" font-size="7.5" font-family="ui-monospace,Menlo,monospace">${b}</text>`;
  }
  return svg(w, 40, `${ticks}<line x1="10" x2="${w - 10}" y1="26" y2="26" stroke="${INK}" stroke-opacity=".5" stroke-width=".8"/>
    <text x="${w - 10}" y="37" text-anchor="end" fill="${INK}" fill-opacity=".45" font-size="6.5" letter-spacing="1" font-family="ui-monospace,Menlo,monospace">BPM</text>
    <g class="needle"><line x1="0" x2="0" y1="3" y2="31" stroke="${INK}" stroke-width="1.6"/><line x1="0" x2="0" y1="3" y2="31" stroke="${INK}" stroke-opacity=".35" stroke-width="5"/></g>`, "scale");
}
/** Where the needle stands for a tempo, as a share of the scale's width (the CSS turns it into a translate). */
export const needleAt = (bpm: number) => (10 + ((Math.min(HI, Math.max(LO, bpm)) - LO) / (HI - LO)) * 280) / 300;

/** A knurled knob with its name engraved under it. Its pointer turns with --turn (degrees) on the element. */
export function knob(name: string) {
  let knurl = "";
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    knurl += `<line x1="${f(24 + Math.cos(a) * 15)}" y1="${f(24 + Math.sin(a) * 15)}" x2="${f(24 + Math.cos(a) * 17.5)}" y2="${f(24 + Math.sin(a) * 17.5)}" stroke="${INK}" stroke-opacity=".28" stroke-width="1"/>`;
  }
  let scale = "";
  for (let i = 0; i <= 10; i++) {
    const a = ((-135 + i * 27) - 90) * Math.PI / 180;
    scale += `<line x1="${f(24 + Math.cos(a) * 20)}" y1="${f(24 + Math.sin(a) * 20)}" x2="${f(24 + Math.cos(a) * 22.5)}" y2="${f(24 + Math.sin(a) * 22.5)}" stroke="${INK}" stroke-opacity=".55" stroke-width="1"/>`;
  }
  return `<figure class="knob">${svg(48, 48, `${scale}<circle cx="24" cy="24" r="17.5" fill="#0d0f14" stroke="#000" stroke-width="1.5"/>${knurl}
    <circle cx="24" cy="24" r="12" fill="#16191f" stroke="${INK}" stroke-opacity=".18"/><g class="pointer"><line x1="24" y1="24" x2="24" y2="13.5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/></g>`)}<figcaption>${name}</figcaption></figure>`;
}

/** The speaker grille behind the tapes: one tile of holes, as a CSS background. */
export const grille = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="7" height="7"><circle cx="3.5" cy="3.5" r="1.25" fill="#fff" fill-opacity=".07"/></svg>`)}")`;

/** A strip of masking tape's torn ends as a clip-path, seeded so each label keeps its own tear, and a slight tilt. */
export function tear(seed: number) {
  const rnd = mulberry32(seed * 7919 + 13), steps = 6, pts: string[] = [];
  for (let i = 0; i <= steps; i++) pts.push(`${f(rnd() * 3.5)}% ${f((i / steps) * 100)}%`);
  for (let i = steps; i >= 0; i--) pts.push(`${f(100 - rnd() * 3.5)}% ${f((i / steps) * 100)}%`);
  return { clip: `polygon(${pts.join(",")})`, tilt: f((rnd() - 0.5) * 2.4) };
}

/** The results' VU meter: an arc from -20 to +3, the hot end in the miss colour, and the needle at `level` (0 quiet to 1 pinned). */
export function vuMeter(level: number) {
  const cx = 60, cy = 62, r = 46, at = (v: number) => (-50 + v * 100) * Math.PI / 180;
  const pt = (v: number, rr: number) => `${f(cx + Math.sin(at(v)) * rr)} ${f(cy - Math.cos(at(v)) * rr)}`;
  let marks = "";
  [["-20", 0], ["-10", 0.3], ["-5", 0.5], ["-3", 0.62], ["0", 0.8], ["+3", 1]].forEach(([label, v]) => {
    const t = Number(v);
    marks += `<line x1="${pt(t, r - 6).split(" ")[0]}" y1="${pt(t, r - 6).split(" ")[1]}" x2="${pt(t, r).split(" ")[0]}" y2="${pt(t, r).split(" ")[1]}" stroke="${t >= 0.8 ? LANE_COLOURS[0] : INK}" stroke-width="1.2"/>
      <text x="${pt(t, r + 7).split(" ")[0]}" y="${pt(t, r + 7).split(" ")[1]}" text-anchor="middle" font-size="7" fill="${t >= 0.8 ? LANE_COLOURS[0] : INK}" fill-opacity=".8" font-family="ui-monospace,Menlo,monospace">${label}</text>`;
  });
  const v = Math.min(1, Math.max(0, level));
  return svg(120, 74, `<rect x="1" y="1" width="118" height="72" rx="6" fill="#0d0f14" stroke="${INK}" stroke-opacity=".25"/>
    <path d="M ${pt(0, r)} A ${r} ${r} 0 0 1 ${pt(0.8, r)}" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width="1"/>
    <path d="M ${pt(0.8, r)} A ${r} ${r} 0 0 1 ${pt(1, r)}" fill="none" stroke="${LANE_COLOURS[0]}" stroke-width="2.5"/>${marks}
    <line x1="${cx}" y1="${cy}" x2="${pt(v, r - 2).split(" ")[0]}" y2="${pt(v, r - 2).split(" ")[1]}" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="4" fill="#16191f" stroke="${INK}" stroke-opacity=".4"/>
    <text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="6.5" letter-spacing="1" fill="${INK}" fill-opacity=".5" font-family="ui-monospace,Menlo,monospace">VU</text>`, "vu");
}
