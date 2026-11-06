import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { platformTag } from "../src/index.ts";
import { drive, openNativeWindow, type Input, type NativeWindow, type Op, type Page } from "../src/render.ts";

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

// The first frame of packages/render's shopping-list app: node 0 is the document.
const shopping: Op[] = [
  ["el", 20, "html"], ["el", 21, "head"], ["el", 22, "link"], ["attr", 22, "rel", "stylesheet"], ["attr", 22, "href", "/app.css"],
  ["el", 23, "body"], ["insert", 0, 20, null], ["insert", 20, 21, null], ["insert", 21, 22, null], ["insert", 20, 23, null],
  ["el", 1, "main"], ["attr", 1, "style", "padding: 16px; font-family: system-ui"],
  ["el", 2, "h1"], ["text", 3, "Shopping"], ["insert", 2, 3, null], ["insert", 1, 2, null],
  ["el", 4, "input"], ["attr", 4, "placeholder", "Add an item"], ["prop", 4, "value", ""], ["insert", 1, 4, null],
  ["el", 5, "button"], ["attr", 5, "disabled", ""], ["text", 6, "Add"], ["insert", 5, 6, null], ["insert", 1, 5, null],
  ["el", 7, "ul"], ["insert", 1, 7, null],
  ["el", 8, "p"], ["attr", 8, "class", "count empty"], ["text", 9, "0 items"], ["insert", 8, 9, null], ["insert", 1, 8, null],
  ["comment", 10], ["insert", 23, 10, null], ["insert", 23, 1, 10],
];

test("drive paints each frame, fetches linked CSS with the page's session, and hands input back until the window closes", async () => {
  const typed: Input[] = [["input", 4, "milk"], ["click", 5]];
  const frames: Op[][] = [shopping, [["setText", 9, "1 items"]], []];
  const fetched: string[] = [], sent: Input[] = [], painted: Op[][] = [], css: [number, string][] = [];
  const page: Page = {
    frame: async () => frames.shift() ?? [],
    send: (i) => sent.push(i),
    window: {
      location: { href: "http://localhost:5173/lists" },
      fetch: async (url) => { fetched.push(url); return new Response("main { padding: 16px }"); },
    },
  };
  let ticks = 0;
  const win: NativeWindow = {
    frame: (ops) => painted.push([...ops]),
    pump: () => ++ticks <= 2,
    poll: () => ticks === 1 ? typed : [],
    css: (id, text) => css.push([id, text]),
    snapshot() {},
  };
  await drive(page, win);
  expect(fetched).toEqual(["http://localhost:5173/app.css"]);
  expect(css).toEqual([[22, "main { padding: 16px }"]]);
  expect(sent).toEqual(typed);
  expect(painted.map((f) => f.length)).toEqual([shopping.length, 1, 0]);
});

/** A PNG's width and height, from its IHDR chunk. */
const pngSize = (file: string) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test.if(built)("rb_render paints a frame of ops headless, and names a bad op", async () => {
  const win = await openNativeWindow({ headless: true, width: 480, height: 320, url: "http://localhost:5173/" });
  if (!win) throw new Error("rb_render is built but didn't load");
  win.snapshot(join(tmp, "blank.png"), 480, 320);
  win.frame(shopping);
  win.css(22, "body { margin: 0 } main { background: #fde68a }");
  win.snapshot(join(tmp, "shopping.png"), 480, 320);
  expect(pngSize(join(tmp, "shopping.png"))).toEqual([480, 320]);
  // Text and a field on the page cost more bytes than a blank one.
  expect(readFileSync(join(tmp, "shopping.png")).length).toBeGreaterThan(readFileSync(join(tmp, "blank.png")).length * 2);
  expect(() => win.frame([["insert", 0, 99, null]])).toThrow(/node 99/);
});
