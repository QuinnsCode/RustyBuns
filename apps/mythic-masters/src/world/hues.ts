// The colour a player's ground hums in (world/bearer.ts): one of 64, picked in Settings, and no two players in a room wear
// the same one. Pure, so the page, the picker and the tests share it.
//
// The 64 are 16 hues at 4 tones, laid evenly in OKLCH (a perceptual space, so equal steps look equal) and kept light
// enough to glow on dark forest floor and saturated enough to show on pale sand. Colour alone isn't enough for everyone,
// so each colour also has its own figure: the waves' symmetry, pitch and twist (`hum`) differ from one colour to the next,
// and two friends whose colours a colour-blind eye confuses still draw different shapes.

/** How many colours there are. */
export const COLOURS = 64;
const HUES = 16;
/** Each tone's OKLCH lightness and chroma: deep, rich, bright, pale. */
const TONES: readonly [number, number][] = [[0.6, 0.19], [0.7, 0.17], [0.8, 0.14], [0.9, 0.09]];

/** OKLCH to linear sRGB (Björn Ottosson's OKLab matrices). */
function oklchToLinear(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180, a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3, m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3, s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_, -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_, -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_];
}
const toByte = (v: number) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

/** Colour `i` as 0xrrggbb: its tone, and a hue round the wheel (each tone turned a half-step, so no two tones line up);
 *  chroma eased down until it fits in sRGB, so the hue holds and nothing clips. */
function make(i: number): number {
  const [l, c0] = TONES[Math.floor(i / HUES)]!, h = ((i % HUES) + (Math.floor(i / HUES) % 2) * 0.5) * (360 / HUES) + 20;
  for (let c = c0; ; c -= 0.005) {
    const rgb = oklchToLinear(l, Math.max(0, c), h);
    if (c <= 0 || rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return rgb.map((v) => toByte(Math.min(1, Math.max(0, v)))).reduce((n, v) => (n << 8) | v, 0);
  }
}
/** The 64 colours, 0xrrggbb. */
export const PALETTE: readonly number[] = Array.from({ length: COLOURS }, (_, i) => make(i));
export const css = (i: number) => `#${PALETTE[i]!.toString(16).padStart(6, "0")}`;

/** Colour `i`'s figure: how many plane waves cross (its symmetry), half-waves across the disc, how far it twists into
 *  arms, how many ripples run out from the middle and which way. Neighbouring colours differ in every one. */
export function hum(i: number) {
  return { sym: 3 + (i % 5), k: 3 + ((i * 3) % 4), swirl: ((i % 7) - 3) * 0.6, rings: 2 + (i % 3), flow: i % 2 ? 1.4 : -1.1 };
}

/** A string's FNV-1a hash. */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** The colour a browser starts with until its player picks one: seeded from its id, so it is the same every visit. */
export const firstColour = (id: string) => hash(id) % COLOURS;

/** What you wear: the colour you chose, unless a friend in the room already wears it and was there first (the smaller
 *  public id wins, so both pages agree without asking anyone); then the next colour round the palette nobody wears. */
export function wornColour(chosen: number, me: string, others: readonly { id: string; colour?: number }[]): number {
  const taken = new Set(others.flatMap((o) => (o.colour === undefined ? [] : [o.colour])));
  if (!others.some((o) => o.colour === chosen && o.id < me)) return chosen;
  for (let k = 1; k < COLOURS; k++) { const c = (chosen + k) % COLOURS; if (!taken.has(c)) return c; }
  return chosen;
}
