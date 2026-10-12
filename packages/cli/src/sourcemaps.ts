// worker.sourceMaps: shape the .map files beside builtMain the way wrangler does
// before Alchemy uploads them (#799).
//
// Alchemy (`bundle: false`) uploads each map byte-for-byte, as an
// `application/source-map` part named `<module>.map`, the same as wrangler. But
// wrangler's loadSourceMap rewrites the map first: `file` becomes the module's
// name and `sources` lose their leading `../`. Bun writes neither (no `file`,
// sources like `../../../../Users/…/src/branches.ts`), and after #708 Workers
// Logs kept showing minified frames. So rustybuns deploy rewrites them as
// wrangler would, with sources relative to the app (`src/branches.ts`).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Each `.map` under `dir` (recursively), as its path relative to `dir`. */
function mapsUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.replaceAll("\\", "/"))
    .filter((p) => p.endsWith(".map"))
    .sort();
}

/** `../../x` → `x`, `./x` → `x`: wrangler's cleanPathPrefix. */
const clean = (p: string) => p.replace(/^(?:\.\.?\/)+/, "");

/**
 * Rewrite every source map beside `builtMain` (a path in `appDir`): `file` names
 * its module (`worker.js` for `worker.js.map`) and `sources` are relative to
 * `appDir`. Returns the maps it rewrote, relative to builtMain's directory.
 */
export function tidySourceMaps(appDir: string, builtMain: string): string[] {
  const root = resolve(appDir, dirname(builtMain));
  if (!existsSync(root)) return [];
  const done: string[] = [];
  for (const name of mapsUnder(root)) {
    const path = join(root, name);
    const map = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(map.sources)) continue;
    const base = resolve(dirname(path), map.sourceRoot ?? "");
    map.file = name.slice(0, -".map".length);
    map.sources = map.sources.map((s: unknown) => typeof s !== "string" || /^[a-z][\w+.-]*:/i.test(s)
      ? s : clean(relative(appDir, resolve(base, s)).replaceAll("\\", "/")));
    delete map.sourceRoot;
    writeFileSync(path, JSON.stringify(map));
    done.push(name);
  }
  return done;
}
