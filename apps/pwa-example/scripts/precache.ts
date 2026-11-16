// A Vite plugin, about thirty lines where a PWA plugin would be a dependency: after `vite build` it lists every file
// in the output, hashes them into a version, and writes src/sw.ts to dist/ui/sw.js with FILES and VERSION in front.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { transformWithEsbuild, type Plugin } from "vite";

/** Files the service worker must not cache: itself, and Cloudflare's headers file (never served). */
const SKIP = new Set(["sw.js", "_headers"]);

/** Every file under `dir` as a URL path, "/" for index.html (Workers assets redirects /index.html to it), sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!SKIP.has(relative(dir, p))) out.push("/" + relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.map((f) => (f === "/index.html" ? "/" : f)).sort();
}

export function precache(): Plugin {
  let outDir = "", root = "";
  return {
    name: "pocket-dice-precache",
    apply: "build",
    configResolved(c) { root = c.root; outDir = join(c.root, c.build.outDir); },
    async closeBundle() {
      const files = listFiles(outDir);
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f === "/" ? "index.html" : f)));
      const version = hash.digest("hex").slice(0, 12);
      const src = readFileSync(join(root, "src/sw.ts"), "utf8");
      const { code } = await transformWithEsbuild(src, "sw.ts", { loader: "ts", target: "es2022" });
      writeFileSync(join(outDir, "sw.js"), `const VERSION = ${JSON.stringify(version)};\nconst FILES = ${JSON.stringify(files)};\n${code}`);
    },
  };
}
