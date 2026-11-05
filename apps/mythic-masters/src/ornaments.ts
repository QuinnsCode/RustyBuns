// The tome's engraved artwork (#3533 round 5): small hand-authored SVGs in the manner of a woodcut, every line a stroke
// of ink, hatching for shade, nothing filled flat. `emblem(chapter)` is the frontispiece under the compendium's title:
// three standing stones for the line-up, a watching eye in a ring of thorns for the bestiary, a compass rose for the
// regions. Each is under a kilobyte and inlined, so the desktop build carries them offline. The vine rule, the foxing
// and the illuminated initial's frame are data URIs in src/tome.css, drawn the same way. No DOM here; `weights()`
// tells a test (and the PR) what each one costs.
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

export type Chapter = "lineup" | "bestiary" | "regions";
const EMBLEMS: Record<Chapter, string> = { lineup: STONES, bestiary: EYE, regions: ROSE };

/** The frontispiece of a chapter. */
export const emblem = (c: Chapter): string => EMBLEMS[c];

/** What each engraving weighs, in bytes, as the PR says it. */
export const weights = (): Record<Chapter, number> => ({ lineup: STONES.length, bestiary: EYE.length, regions: ROSE.length });
