import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platformTag } from "../src/index.ts";
import { openNativeWindow, type Op } from "../src/render.ts";

const tmp = mkdtempSync(join(tmpdir(), "rb-render-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Built by `bun native/crates/rb_render/build.ts` (on the builder); CI doesn't build it.
const lib = process.platform === "darwin" ? "librb_render.dylib" : process.platform === "win32" ? "rb_render.dll" : "librb_render.so";
const built = existsSync(join(import.meta.dir, "..", "..", "..", "native", "dist", "rb_render", platformTag(), lib));

test.skipIf(built)("with no rb_render to load, the app gets null and keeps its Chromium window", async () => {
  // A file that isn't a library, where loadNative looks first.
  writeFileSync(join(tmp, lib), "not a library");
  expect(await openNativeWindow({ dir: tmp, headless: true })).toBeNull();
});

// The first frame react-dom gives for packages/render's shopping-list app.
const shopping: Op[] = [
  ["el", 1, "main"], ["style", 1, "padding", "16px"], ["style", 1, "font-family", "system-ui"],
  ["el", 2, "h1"], ["text", 3, "Shopping"], ["insert", 2, 3, null], ["insert", 1, 2, null],
  ["el", 4, "input"], ["attr", 4, "placeholder", "Add an item"], ["prop", 4, "value", ""], ["insert", 1, 4, null],
  ["el", 5, "button"], ["attr", 5, "disabled", ""], ["text", 6, "Add"], ["insert", 5, 6, null], ["insert", 1, 5, null],
  ["el", 7, "ul"], ["insert", 1, 7, null],
  ["el", 8, "p"], ["attr", 8, "class", "count empty"], ["text", 9, "0 items"], ["insert", 8, 9, null], ["insert", 1, 8, null],
  ["insert", 0, 1, null],
];

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (file: string) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test.if(built)("rb_render paints a frame of ops headless, and names a bad op", async () => {
  const win = await openNativeWindow({ headless: true, width: 480, height: 320 });
  if (!win) throw new Error("rb_render is built but didn't load");
  win.snapshot(join(tmp, "blank.png"), 480, 320);
  win.frame(shopping);
  win.snapshot(join(tmp, "shopping.png"), 480, 320);
  expect(pngSize(join(tmp, "shopping.png"))).toEqual([480, 320]);
  // Text and a field on the page cost more bytes than a blank one.
  expect(readFileSync(join(tmp, "shopping.png")).length).toBeGreaterThan(readFileSync(join(tmp, "blank.png")).length * 2);
  expect(() => win.frame([["insert", 0, 99, null]])).toThrow(/node 99/);
});
