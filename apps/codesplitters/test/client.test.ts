import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every selector in the page's styles that reaches `.cls`, and its declarations. */
const rulesFor = (cls: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, sel, body]) => sel!.split(",").map((s) => ({ sel: s.trim(), body: body! })))
  .filter(({ sel }) => new RegExp(String.raw`\.${cls}(?![\w-])`).test(sel));

// The ⌘K palette opened as a narrow, tall box twice (#609, #678): a bare `.sheet` rule for
// another widget (the repo tabs, max-width: 200px) also styled the palette's sheet.
describe("the command palette and the drawer keep their size", () => {
  test("the palette's sheet is full width", () => {
    expect(html).toContain(`<div class="palette" id="palette" hidden><div class="sheet"`);
    const own = rulesFor("sheet").find((r) => r.sel === ".palette .sheet");
    expect(own?.body).toContain("width: min(640px, calc(100vw - 32px))");
  });

  test("no rule styles a .sheet outside the palette or the drawer", () => {
    expect(rulesFor("sheet").map((r) => r.sel).filter((s) => !/^\.(palette|drawer)(\.on)? \.sheet\b/.test(s))).toEqual([]);
  });
});
