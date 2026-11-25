// A page's first-screen words, kept out of its markup: `content/first-screen.json` holds them and the owner edits
// them on `bun run screens` (packages/cms/src/screens.ts). An element in index.html names its line with
// `data-copy="title"` (or a dotted path, `data-copy="menu.play"`) and stays empty; `firstScreen()` in vite.config.ts
// writes the line in as the page is served or built, so nothing flashes and no line is kept twice. An attribute takes
// `data-copy-placeholder="name"` (or `-aria-label`, `-title`, `-alt`). A key the file doesn't have stops the page
// with its name, so a renamed key can't ship a blank button. Text written by the page's script imports the JSON.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// It imports nothing from @rustybuns/util: a desktop build loads vite.config.ts under Node, which only strips types,
// and guard.ts (through index.ts) holds a class Node can't run that way. So the escape is written out here.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The string at a dotted path in the copy, or an error naming the path and the file. */
function lineOf(copy: unknown, path: string, file: string): string {
  let at: unknown = copy;
  for (const k of path.split(".")) at = at !== null && typeof at === "object" && !Array.isArray(at) ? Object.getOwnPropertyDescriptor(at, k)?.value : undefined;
  if (typeof at !== "string") throw new Error(`${file} has no line "${path}" (index.html asks for it with data-copy)`);
  return at;
}

const ATTRS = ["placeholder", "aria-label", "title", "alt"] as const;

/** The page with every `data-copy` element's text and every `data-copy-<attr>` attribute filled from `copy`.
 *  A `data-copy` element holds only text, so its closing tag is the next one. */
export function fillCopy(html: string, copy: unknown, file = "content/first-screen.json"): string {
  let out = html.replace(/(<([a-zA-Z][\w-]*)\b[^>]*\sdata-copy="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g,
    (_, open: string, _tag: string, path: string, close: string) => `${open}${esc(lineOf(copy, path, file))}${close}`);
  for (const attr of ATTRS) {
    out = out.replace(new RegExp(`(<[^>]*\\s)data-copy-${attr}="([^"]+)"([^>]*>)`, "g"),
      (_, a: string, path: string, b: string) => `${a}${attr}="${esc(lineOf(copy, path, file))}"${b}`);
  }
  return out;
}

/** The Vite plugin: index.html's `data-copy` lines from `content/first-screen.json` (beside the Vite root, wherever
 *  the build was started from), read again on every request in dev, so a save on `bun run screens` shows on the next reload. */
export function firstScreen(file = "content/first-screen.json") {
  let root = process.cwd();
  return {
    name: "rustybuns-first-screen",
    configResolved: (config: { root: string }) => { root = config.root; },
    transformIndexHtml: (html: string) => fillCopy(html, JSON.parse(readFileSync(resolve(root, file), "utf8")), file),
  };
}
