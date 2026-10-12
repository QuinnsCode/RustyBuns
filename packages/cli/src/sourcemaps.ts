// worker.sourceMaps: Alchemy's `bundle: false` uploads the built maps byte-for-byte, but wrangler's
// `upload_source_maps` rewrites each map first (sourceMapForModule in wrangler's source-maps.ts):
// `file` becomes the module's name and each source loses one leading ./ or ../. Bun writes no `file`,
// so codeSplitters' live traces stayed minified (#799). This puts the maps in wrangler's shape.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const clean = (p: string) => p.replace(/^\.\.?[\\/]/, "");

/** A source map as wrangler uploads it beside `moduleName`. */
export function wranglerShapedMap(map: { file?: string; sourceRoot?: string; sources: string[] }, moduleName: string) {
  return { ...map, file: moduleName, ...(map.sourceRoot ? { sourceRoot: clean(map.sourceRoot) } : {}), sources: map.sources.map(clean) };
}

/** The `//# sourceMappingURL=` a module names, read from its last comment lines (as wrangler does). */
export function sourceMappingURL(js: string): string | undefined {
  for (const line of js.split("\n").reverse().map((l) => l.trim())) {
    if (!line) continue;
    if (line.startsWith("//# sourceMappingURL=")) return line.slice(21).trim();
    if (!line.startsWith("//#") && !line.startsWith("//@")) return;
  }
}

/** Rewrites, in place, the map each top-level .js/.mjs module in `dir` links to. Returns the maps it fixed. */
export function shapeSourceMaps(dir: string): string[] {
  const fixed: string[] = [];
  for (const name of readdirSync(dir).filter((n) => /\.m?js$/.test(n))) {
    const url = sourceMappingURL(readFileSync(join(dir, name), "utf8"));
    if (!url || url.startsWith("data:") || url.includes("/")) continue;
    const path = join(dir, url);
    writeFileSync(path, JSON.stringify(wranglerShapedMap(JSON.parse(readFileSync(path, "utf8")), name)));
    fixed.push(url);
  }
  return fixed;
}
