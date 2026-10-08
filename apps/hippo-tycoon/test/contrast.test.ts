// WCAG contrast for the HUD, the cards, the buttons and the popups. The panels are
// translucent over a 3D scene that can be anything (a bloom flash is near white),
// so text on a panel is checked over a white and a black background behind it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/client/style.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const token = (name: string) => { const m = root.match(new RegExp(`--${name}:\\s*([^;]+);`)); if (!m) throw new Error(`no --${name}`); return m[1]!.trim(); };

type RGB = [number, number, number];
function parse(c: string): { rgb: RGB; a: number } {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) { const n = parseInt(hex[1]!, 16); return { rgb: [n >> 16, (n >> 8) & 255, n & 255], a: 1 }; }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`colour? ${c}`);
  const [r, g, b, a = "1"] = m[1]!.split(",").map((x) => x.trim());
  return { rgb: [Number(r), Number(g), Number(b)], a: Number(a) };
}
const over = (top: string, under: RGB): RGB => { const t = parse(top); return t.rgb.map((v, i) => v * t.a + under[i]! * (1 - t.a)) as RGB; };
const lum = ([r, g, b]: RGB) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const WHITE: RGB = [255, 255, 255], BLACK: RGB = [0, 0, 0];

describe("contrast", () => {
  const panels = [over(token("glass"), WHITE), over(token("glass"), BLACK)];

  test("body text and dim labels on a glass card stay readable whatever is behind it (4.5:1)", () => {
    for (const bg of panels) for (const t of ["text", "dim", "gold", "cyan"]) expect(ratio(parse(token(t)).rgb, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test("the score numbers (24px bold, large text) on a glass card (3:1), and the green/red pair holds up", () => {
    for (const bg of panels) for (const t of ["green", "red"]) expect(ratio(parse(token(t)).rgb, bg)).toBeGreaterThanOrEqual(3);
    for (const t of ["green", "red"]) expect(ratio(parse(token(t)).rgb, panels[0]!)).toBeGreaterThanOrEqual(4.5);
  });

  test("the cyan and pink controls: dark text on the lit segment and on the gradient button", () => {
    expect(ratio(parse("#04141a").rgb, parse(token("cyan")).rgb)).toBeGreaterThanOrEqual(4.5);   // .seg button.on
    for (const stop of ["#ff3d9a", "#ff8a3a", "#ff5aac", "#ffa05a"]) expect(ratio(parse("#1a0610").rgb, parse(stop).rgb)).toBeGreaterThanOrEqual(4.5);   // .btn.go and its hover
  });

  test("every popup colour reads against the black outline it is drawn with", () => {
    const src = ["../src/client/render/index.ts", "../src/client/render/cinematic.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
    const colours = new Set([...src.split("\n").filter((l) => /popup/i.test(l)).join("\n").matchAll(/"(#[0-9a-f]{6})"/gi)].map((m) => m[1]!.toLowerCase()));
    expect(colours.size).toBeGreaterThan(8);
    for (const c of colours) expect({ c, ok: ratio(parse(c).rgb, BLACK) >= 4.5 }).toEqual({ c, ok: true });
  });
});
