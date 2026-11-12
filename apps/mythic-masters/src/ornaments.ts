// The tome's engraved artwork (#3533 round 5): small hand-authored SVGs in the manner of a woodcut, every line a stroke
// of ink, hatching for shade, nothing filled flat. `emblem(chapter)` is the frontispiece under the compendium's title:
// three standing stones for the line-up, a watching eye in a ring of thorns for the bestiary, a compass rose for the
// regions. Each is under a kilobyte and inlined, so the desktop build carries them offline. The vine rule, the foxing
// and the illuminated initial's frame are data URIs in src/tome.css, drawn the same way. No DOM here; `weights()`
// tells a test (and the PR) what each one costs.
import { mulberry32 } from "@rustybuns/util";

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" class="engraving" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

/** Short parallel strokes between two points, the engraver's shade. */
function hatch(x: number, y: number, n: number, len: number, step: number, tilt = 0.5): string {
  let d = "";
  for (let i = 0; i < n; i++) { const x0 = x + i * step; d += `M${x0} ${y}l${(len * tilt).toFixed(1)} ${len}`; }
  return `<path d="${d}" stroke-width="0.7" opacity="0.75"/>`;
}

/** The line-up: three standing stones on a rise, the tallest leaning, grass at their feet. */
const STONES = svg(120, 64, [
  `<path d="M10 58q50 -8 100 0"/>`,
  `<path d="M28 56l4 -34l10 -4l6 38z"/>`, hatch(33, 26, 5, 24, 2.4, 0.15),
  `<path d="M54 56l2 -44l14 -2l4 46z"/>`, hatch(59, 14, 6, 36, 2.6, 0.1),
  `<path d="M84 56l6 -30l10 2l-2 28z"/>`, hatch(91, 30, 4, 22, 2.6, 0.2),
  `<path d="M14 56l2 -5M20 57l1 -4M44 57l2 -5M78 57l1 -4M104 57l2 -5" stroke-width="0.8"/>`,
  `<path d="M40 10q8 -6 16 0M62 6q6 -4 12 0" stroke-width="0.7" opacity="0.6"/>`,
].join(""));

/** The bestiary: an eye that watches you read, inside a ring of thorns. */
const EYE = svg(120, 64, [
  `<circle cx="60" cy="32" r="27"/>`,
  ...Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * Math.PI * 2, x = 60 + Math.cos(a) * 27, y = 32 + Math.sin(a) * 27; return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(a + 0.5) * 5).toFixed(1)} ${(Math.sin(a + 0.5) * 5).toFixed(1)}" stroke-width="0.9"/>`; }),
  `<path d="M38 32q22 -20 44 0q-22 20 -44 0z"/>`,
  `<circle cx="60" cy="32" r="7"/><circle cx="60" cy="32" r="3" fill="currentColor"/>`,
  `<path d="M44 32q16 -12 32 0" stroke-width="0.7" opacity="0.7"/>`,
  hatch(42, 33, 7, 6, 2.4, 0.3), hatch(64, 33, 7, 6, 2.4, -0.3),
].join(""));

/** The regions: a compass rose, its north a little worn. */
const ROSE = svg(120, 64, [
  `<circle cx="60" cy="32" r="26" stroke-width="0.8"/><circle cx="60" cy="32" r="20" stroke-width="0.6" opacity="0.7"/>`,
  `<path d="M60 6l5 21l-5 -4l-5 4zM60 58l5 -21l-5 4l-5 -4zM34 32l21 5l-4 -5l4 -5zM86 32l-21 5l4 -5l-4 -5z"/>`,
  `<path d="M60 6l5 21l-5 -4zM60 58l-5 -21l5 4zM34 32l21 -5l-4 5zM86 32l-21 5l4 -5z" fill="currentColor" opacity="0.8"/>`,
  `<path d="M44 16l12 12M76 16l-12 12M44 48l12 -12M76 48l-12 -12" stroke-width="0.7" opacity="0.6"/>`,
  `<path d="M57 3h6M60 0v3" stroke-width="0.8"/>`,
].join(""));

/** The title: the grimoire itself, open, an eye on its page, a ribbon out of the gutter. */
const GRIMOIRE = svg(120, 64, [
  `<path d="M60 14q-22 -10 -48 -2v40q26 -8 48 2q22 -10 48 -2v-40q-26 -8 -48 2z"/><path d="M60 14v40"/>`,
  `<path d="M16 20q20 -6 40 1M16 28q20 -6 40 1M16 36q20 -6 40 1M16 44q20 -6 40 1" stroke-width="0.6" opacity="0.6"/>`,
  `<path d="M70 32q12 -9 24 0q-12 9 -24 0z"/><circle cx="82" cy="32" r="3"/><circle cx="82" cy="32" r="1.2" fill="currentColor"/>`,
  hatch(66, 36, 5, 5, 2.4, 0.3), hatch(90, 36, 5, 5, 2.4, -0.3),
  `<path d="M60 54l-3 8l3 -2l3 2z" fill="currentColor" opacity="0.8"/>`,
].join(""));

/** The Bog Witch: a cauldron on three stones, a fire under it, three bubbles rising. */
const CAULDRON = svg(120, 64, [
  `<path d="M38 24h44l-4 20q-18 8 -36 0z"/><path d="M34 24h52" stroke-width="1.4"/><path d="M42 20q18 -6 36 0" stroke-width="0.8"/>`,
  hatch(44, 30, 9, 12, 3.6, 0.2),
  `<path d="M46 48l-6 10M74 48l6 10M60 46v12" stroke-width="0.9"/><path d="M34 58h52" stroke-width="0.8"/>`,
  `<path d="M48 58q4 -10 8 -2q2 -8 6 0q4 -9 8 2" stroke-width="0.9"/>`,
  `<circle cx="56" cy="14" r="2"/><circle cx="64" cy="9" r="2.6"/><circle cx="58" cy="4" r="1.4"/>`,
].join(""));

/** The factions: a path lamp on its post, three sets of footprints behind it, one step behind you. */
const LAMP = svg(120, 64, [
  `<path d="M60 58v-34"/><path d="M52 58h16" stroke-width="1.3"/>`,
  `<path d="M52 24h16l-3 -12h-10z"/><path d="M54 12l6 -6l6 6"/>`, hatch(55, 14, 5, 8, 2.2, 0.1),
  `<path d="M60 24v6" stroke-width="0.7"/>`,
  `<path d="M14 50l3 -1M22 54l3 -1M30 50l3 -1M38 54l3 -1M82 50l3 -1M90 54l3 -1M98 50l3 -1M106 54l3 -1" stroke-width="1.3" opacity="0.8"/>`,
  `<path d="M48 18q-6 -4 -12 0M72 18q6 -4 12 0" stroke-width="0.6" opacity="0.6"/>`,
].join(""));

export type Chapter = "lineup" | "bestiary" | "regions" | "factions" | "title" | "witch";
const EMBLEMS: Record<Chapter, string> = { lineup: STONES, bestiary: EYE, regions: ROSE, factions: LAMP, title: GRIMOIRE, witch: CAULDRON };

/** The frontispiece of a chapter (or of the title scroll and the Bog Witch's sheet). */
export const emblem = (c: Chapter): string => EMBLEMS[c];

/** A thorn-and-vine ring to frame a bound beast's plate: a ring with thorns leaning one way, a pair of leaves at
 * each quarter, a berry between. Laid over the plate at the same size, so it scales with it. */
export function frame(): string {
  const parts: string[] = [`<circle cx="50" cy="50" r="46" stroke-width="0.9"/><circle cx="50" cy="50" r="43.5" stroke-width="0.5" opacity="0.6"/>`];
  for (let i = 0; i < 28; i++) {
    // thorns as a briar grows them: mostly leaning with the stem, every third against it, never two the same length
    const a = (i / 28) * Math.PI * 2, x = 50 + Math.cos(a) * 46, y = 50 + Math.sin(a) * 46, t = a + (i % 3 === 1 ? -1.25 : 1.05), len = 2.4 + ((i * 7) % 5) * 0.45;
    parts.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(t) * len).toFixed(1)} ${(Math.sin(t) * len).toFixed(1)}" stroke-width="0.8"/>`);
  }
  for (let q = 0; q < 4; q++) {
    const a = (q / 4) * Math.PI * 2 + Math.PI / 4, x = 50 + Math.cos(a) * 46, y = 50 + Math.sin(a) * 46, d = (a * 180) / Math.PI;
    parts.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${d.toFixed(0)})"><path d="M0 0q5 -5 9 -1q-4 4 -9 1zM0 0q5 5 9 1q-4 -4 -9 -1z" stroke-width="0.8"/><path d="M2 -1l5 -2M2 1l5 2" stroke-width="0.5" opacity="0.7"/></g>`);
    const b = a + Math.PI / 4, bx = 50 + Math.cos(b) * 46, by = 50 + Math.sin(b) * 46;
    parts.push(`<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="1.6" fill="#7b1d14" stroke="none"/>`);
  }
  return `<svg viewBox="0 0 100 100" class="engraving frame" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round">${parts.join("")}</svg>`;
}

/** Small marginal figures, one per field, as a medieval scribe doodled beasts and hands down the margin: a flame,
 * a wave, a gust, a cairn, a frost star, a bolt, a leaf sprig, a dripping fang, a candle, a crescent, a horseshoe, a paw. */
const MARGINALIA: Record<string, string> = {
  ember: `<path d="M16 28q-9 -6 -4 -14q1 6 5 7q-2 -8 5 -13q-1 8 6 11q4 5 -2 9q-5 3 -10 0z"/><path d="M13 24q2 -4 6 -4" stroke-width="0.6"/>`,
  tide: `<path d="M3 20q6 -8 12 0t12 0M3 26q6 -8 12 0t12 0" stroke-width="1"/><path d="M8 13q4 -5 8 -1" stroke-width="0.7"/>`,
  gale: `<path d="M4 12q10 -4 18 0q6 3 2 7q-4 2 -6 -2M4 20q12 -3 20 2q4 3 0 6" stroke-width="1"/>`,
  stone: `<path d="M8 28h16M10 28l1 -6h10l1 6M12 22l1 -5h6l1 5M14 17l1 -4h2l1 4" stroke-width="1"/><path d="M12 25l2 -2M20 25l-2 -2" stroke-width="0.5"/>`,
  frost: `<path d="M16 4v24M6 10l20 12M6 22l20 -12M16 9l-3 -3M16 9l3 -3M16 23l-3 3M16 23l3 3" stroke-width="0.9"/>`,
  storm: `<path d="M18 4l-8 13h7l-4 11l11 -15h-7l5 -9z" stroke-width="1"/>`,
  grove: `<path d="M16 28v-18M16 18q-8 0 -10 -8q8 0 10 8zM16 14q8 0 10 -8q-8 0 -10 8zM16 24q-7 0 -9 -6q7 0 9 6z" stroke-width="0.9"/>`,
  venom: `<path d="M12 4l4 12l4 -12z" stroke-width="1"/><path d="M16 18v4M16 26q-2 2 0 3q2 -1 0 -3z" stroke-width="0.9"/>`,
  spirit: `<path d="M12 28h8M14 28v-12h4v12M16 12q-3 -4 0 -8q3 4 0 8z" stroke-width="1"/><path d="M16 9v2" stroke-width="0.6"/>`,
  shadow: `<path d="M20 4q-10 2 -10 12t10 12q-6 -4 -6 -12t6 -12z" stroke-width="1"/><circle cx="24" cy="8" r="1" fill="currentColor"/>`,
  iron: `<path d="M8 22q-2 -14 8 -16q10 2 8 16M8 22l2 4M24 22l-2 4" stroke-width="1.1"/><path d="M11 12l1 2M21 12l-1 2M9 18l2 1M23 18l-2 1" stroke-width="0.6"/>`,
  wild: `<path d="M16 28q-7 -2 -5 -8q3 -4 5 -4t5 4q2 6 -5 8z" stroke-width="1"/><circle cx="8" cy="13" r="2"/><circle cx="13" cy="8" r="2"/><circle cx="19" cy="8" r="2"/><circle cx="24" cy="13" r="2"/>`,
};
/** A pointing hand, the scribe's mark beside a line worth reading. */
const MANICULE = `<path d="M4 16h10l0 -8q0 -2 2 -2t2 2v8h2v-5q0 -2 2 -2t2 2v5h2v-3q0 -2 2 -2t2 2v9q0 4 -4 4h-8q-4 0 -8 -4l-6 -5q-2 -2 0 -3q2 0 4 2z" stroke-width="0.9"/>`;

/** The figures down a folio's margin: one for each of the beast's fields, a pointing hand, and a thorn sprig. */
export function marginalia(fields: readonly string[]): string {
  const glyph = (body: string) => `<svg viewBox="0 0 32 32" class="engraving" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  const thorn = `<path d="M16 30q-2 -14 4 -26M14 22l-5 -3M17 14l6 -4M15 8l-4 -5" stroke-width="0.9"/>`;
  return [MANICULE, ...fields.map((f) => MARGINALIA[f] ?? thorn), thorn].map(glyph).join("");
}

/** The seal pressed on a bind's result note (#3604 round 12): a blob of red wax, lobed where it spread under the
 * matrix, its rim raised, the watching eye in thorns debossed in the middle, and the two ends of a green cord
 * caught under it. Wax is the one thing in the book drawn filled, not hatched. */
export function seal(): string {
  const lobes = Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2, r = 34 + 2.6 * Math.sin(5 * a + 1) + 1.6 * Math.sin(9 * a + 2) + (i % 11 === 3 ? 3.5 : 0);
    return `${(50 + Math.cos(a) * r).toFixed(1)} ${(46 + Math.sin(a) * r).toFixed(1)}`;
  });
  const thorns = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2, x = 50 + Math.cos(a) * 21, y = 46 + Math.sin(a) * 21, t = a + 1.1;
    return `M${x.toFixed(1)} ${y.toFixed(1)}l${(Math.cos(t) * 3).toFixed(1)} ${(Math.sin(t) * 3).toFixed(1)}`;
  }).join("");
  const eye = `<path d="M34 46q16 -13 32 0q-16 13 -32 0z"/><circle cx="50" cy="46" r="5"/><circle cx="50" cy="46" r="2" fill="currentColor"/>`;
  return `<svg viewBox="0 0 100 112" class="seal-art" aria-hidden="true" stroke-linecap="round" stroke-linejoin="round">`
    + `<defs><radialGradient id="mm-wax" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#c2412a"/><stop offset=".45" stop-color="#8f2418"/><stop offset="1" stop-color="#4d0f09"/></radialGradient></defs>`
    + `<path d="M40 70l-16 38l7 -5l4 8l13 -38zM60 70l16 38l-7 -5l-4 8l-13 -38z" fill="#3d5634" stroke="#26381f" stroke-width=".8"/>`
    + `<path d="M${lobes.join("L")}z" fill="url(#mm-wax)" stroke="#4d0f09" stroke-width=".8"/>`
    + `<circle cx="50" cy="46" r="25" fill="none" stroke="#5c130b" stroke-width="2.2" opacity=".8"/><path d="M30 38a25 25 0 0 1 30 -16" fill="none" stroke="#e0806a" stroke-width="1.1" opacity=".55"/>`
    + `<g fill="none" stroke="#e0806a" stroke-width=".9" opacity=".5" transform="translate(-.7 -.7)">${eye}<path d="${thorns}"/></g>`
    + `<g fill="none" stroke="#3d0a05" stroke-width="1.2" color="#3d0a05">${eye}<path d="${thorns}"/></g></svg>`;
}

/** A loss tears the note: its top right corner ripped away (#3604 round 12). `clip` cuts the paper (a polygon for
 * the note's paper, the tear measured in pixels from its top right), `svg` lays the torn fibres along the same edge
 * (the paper's pale core where it parted, hairs left standing) and the ink that spilt as it went. */
export function tear(seed = 5): { clip: string; svg: string } {
  const W = 150, H = 110, rand = mulberry32(seed), pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, end = i === 0 || i === 24, bow = end ? 0 : Math.sin(t * Math.PI) * 18; // the rip bows into the page; its ends sit on the edges
    const jag = end ? 0 : (rand() - 0.5) * 9;
    pts.push([W * (1 - t) - bow * 0.7 + jag * 0.6, (H - 6) * t + bow * 0.7 + jag * 0.6]); // from the right edge, down from the top
  }
  const clip = `polygon(0 0, ${pts.map(([x, y]) => `calc(100% - ${x.toFixed(1)}px) ${y.toFixed(1)}px`).join(", ")}, 100% 100%, 0 100%)`;
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${(W - x).toFixed(1)} ${y.toFixed(1)}`).join("");
  const hairs = pts.slice(1, -1).filter((_, i) => i % 2 === 0).map(([x, y]) => `M${(W - x).toFixed(1)} ${y.toFixed(1)}l${(2 + rand() * 3).toFixed(1)} ${(-2 - rand() * 3).toFixed(1)}`).join("");
  // the spill: a blot near where the rip meets the right edge (in the margin, clear of the words), drops trailing off it
  const [bx, by] = pts[19]!, drops = Array.from({ length: 5 }, (_, i) => `<circle cx="${(W - bx - 12 - i * 5 + rand() * 3).toFixed(1)}" cy="${(by + 12 + i * 5 + rand() * 4).toFixed(1)}" r="${(2.4 - i * 0.35).toFixed(1)}"/>`).join("");
  const svg = `<svg viewBox="0 0 ${W} ${H + 20}" class="tear-art" aria-hidden="true" fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${line}" stroke="#f6ecd2" stroke-width="3.2" opacity=".9" transform="translate(-1.6 1.6)"/>`
    + `<path d="${line}" stroke="#8a6a44" stroke-width=".7" opacity=".7"/>`
    + `<path d="${hairs}" stroke="#efe2c2" stroke-width=".6" opacity=".9"/>`
    + `<g fill="#2a1b10" opacity=".85"><path d="M${(W - bx - 10).toFixed(1)} ${(by + 4).toFixed(1)}q-9 1 -11 9q4 6 11 3q2 7 8 4q3 -7 -2 -11q4 -5 -6 -5z"/>${drops}</g></svg>`;
  return { clip, svg };
}

/** A fallen fighter's plate struck through (#3604 round 13): two strokes of a loaded pen, thick in the middle and
 * thinning to ragged ends, the second laid over the first, a drop of ink run from where they cross. Filled, not
 * stroked, so each tapers as a pen's line does. */
export function struck(): string {
  const stroke = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, at = (t: number, s: number) =>
      `${(x0 + dx * t + nx * s).toFixed(1)} ${(y0 + dy * t + ny * s).toFixed(1)}`;
    return `<path d="M${at(0, 0)}Q${at(0.3, w * 1.1)} ${at(0.55, w * 0.9)}T${at(1, 0.4)}L${at(0.98, -0.6)}Q${at(0.6, -w)} ${at(0.35, -w * 0.8)}T${at(0, 0)}z"/>`;
  };
  return `<svg viewBox="0 0 100 100" class="struck" aria-hidden="true" fill="currentColor">${stroke(14, 18, 88, 84, 4.2)}${stroke(86, 14, 16, 86, 3.6)}<path d="M51 54q-2 9 0 15q2 -6 0 -15z" opacity=".85"/><circle cx="51" cy="72" r="2.2" opacity=".85"/></svg>`;
}

/** What the book has on a beast you have not met (#3604 round 24): not its shape, only a rumour, inked in red by a
 * hand that never saw it: a track, claw marks, an eye in the dark, a scrawled question, a crossed-out sketch, a
 * warding spiral. Which one is picked by the entry's own number, so it never says what the beast is. */
const RUMOURS = [
  `<path d="M40 62q-9 -2 -9 -12q0 -9 9 -10q9 1 9 10q0 10 -9 12z"/><circle cx="29" cy="34" r="4"/><circle cx="37" cy="27" r="4"/><circle cx="46" cy="28" r="4"/><circle cx="53" cy="35" r="4"/>`,
  `<path d="M26 22q8 18 4 38M38 18q8 20 4 42M50 22q8 18 4 38" stroke-width="3.2"/><path d="M27 26q4 6 4 12M39 22q4 8 4 14" stroke-width="1" opacity=".6"/>`,
  `<path d="M16 40q24 -22 48 0q-24 22 -48 0z"/><circle cx="40" cy="40" r="7" fill="currentColor"/><path d="M12 30l6 4M68 30l-6 4M40 14v6" stroke-width="1.4"/>`,
  `<path d="M28 28q2 -12 13 -12q12 1 11 12q-1 8 -11 12v8" stroke-width="3.6"/><circle cx="41" cy="60" r="2.8" fill="currentColor"/>`,
  `<path d="M22 54q4 -26 20 -30q14 -2 16 14q-2 14 -18 16" stroke-width="1.4" opacity=".8"/><path d="M18 22l44 36M62 22l-44 36" stroke-width="3"/>`,
  `<path d="M40 40m-4 0a4 4 0 1 1 8 0a9 9 0 1 1 -18 0a14 14 0 1 1 28 0a19 19 0 1 1 -38 0" stroke-width="2"/>`,
];
/** What the hand wrote beside each rumour: a guess, never a name. */
export const GUESSES = ["tracks by the creek", "something with claws", "it watched us", "what was it?", "not what I drew", "keep the circle",
  "heard, not seen", "the dogs would not go", "bigger than the last", "only at night", "a smell like wet ash", "gone by morning",
  "two eyes, then four?", "do not follow it", "the miller saw it", "it knew my name", "under the bridge", "salt the door"];
export const rumour = (n: number): string =>
  `<svg viewBox="0 0 80 80" class="rumour" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4">${RUMOURS[n % RUMOURS.length]}</svg>`;

/** What each engraving weighs, in bytes, as the PR says it. */
export const weights = (): Record<Chapter | "frame" | "marginalia", number> =>
  ({ lineup: STONES.length, bestiary: EYE.length, regions: ROSE.length, factions: LAMP.length, title: GRIMOIRE.length, witch: CAULDRON.length, frame: frame().length, marginalia: marginalia(["ember", "tide"]).length });

/** An engraving as a CSS image, inked in the book's faded brown: for a leaf drawn by CSS alone (the facing leaf of
 * the Settings and result spreads, #3671 round 81), where there is no element to hold the svg. */
export const inkUrl = (svgMarkup: string, ink = "#5e4630"): string =>
  `url("data:image/svg+xml,${encodeURIComponent(svgMarkup.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ').replaceAll("currentColor", ink))}")`;
