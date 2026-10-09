// The office's cheerful pastels, retold as a forest. Pure (numbers in, numbers out) and tested.
//
// Rules by hue and lightness rather than by exact colour, so a new Agent Office release that nudges its palette
// still comes out in the forest: whites become birch and parchment, greys become stone, blues and purples
// become moss and pine, pinks and reds become autumn, and yellows stay gold.

export type HSL = { h: number; s: number; l: number };

export function hexToHsl(hex: number): HSL {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: HSL): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** What a surface is, as far as the forest cares. */
export type Surface = "wall" | "thing";

export function forestColor(hex: number, surface: Surface = "thing"): number {
  const { h, s, l } = hexToHsl(hex);
  // walls: weathered timber, a little lighter where the office was lighter
  if (surface === "wall") return hslToHex({ h: 32, s: 0.28, l: 0.3 + 0.12 * l });
  // near-whites → birch bark and parchment
  if (s < 0.25 && l > 0.82) return hslToHex({ h: 45, s: 0.3, l: 0.72 + (l - 0.82) * 0.5 });
  // greys → mossy stone; near-blacks stay dark, just warmer
  if (s < 0.2) return hslToHex({ h: 90, s: 0.08, l: l * 0.85 });
  // blues, purples, teals → pine, moss and deep fern
  if (h >= 170 && h < 290) return hslToHex({ h: 95 + (h - 170) * 0.25, s: Math.min(s, 0.45), l: Math.min(l, 0.55) * 0.85 });
  // pinks and magentas → berry and heather
  if (h >= 290 || h < 10) return hslToHex({ h: 345, s: Math.min(s, 0.45), l: Math.min(l, 0.6) * 0.85 });
  // reds and oranges → autumn rust and bark
  if (h < 45) return hslToHex({ h: 22 + (h - 10) * 0.3, s: Math.min(s, 0.55), l: Math.min(l, 0.55) * 0.9 });
  // yellows → gold, kept
  if (h < 70) return hslToHex({ h: 44, s: Math.min(s, 0.7), l: Math.min(l, 0.62) });
  // greens are already the forest
  return hslToHex({ h: Math.max(80, Math.min(h, 140)), s: Math.min(s, 0.5), l: Math.min(l, 0.5) });
}
