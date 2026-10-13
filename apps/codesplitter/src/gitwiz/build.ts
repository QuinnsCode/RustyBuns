// Layout (gitwiz/build.ts): copies and bundles gitwiz into a folder of static files
// gitwiz is three static files and a sample, with no route of its own: the Worker's assets serve them.
// ../../build.ts calls this for dist/client, and serve.ts for its own scratch folder.
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const here = import.meta.dir;

export async function buildGitwiz(outdir: string) {
  await mkdir(outdir, { recursive: true });
  await copyFile(join(here, "gitwiz.html"), join(outdir, "gitwiz.html"));
  // The sample is this repo's six most-edited files (bun scripts/gitwiz-log.ts <repo> --bundle 6), so the page works offline.
  await copyFile(join(here, "sample.json"), join(outdir, "gitwiz-sample.json"));
  const r = await Bun.build({ entrypoints: [join(here, "page.ts")], outdir, target: "browser", format: "iife", minify: true, naming: "gitwiz.js" });
  if (!r.success) { for (const l of r.logs) console.error(l); throw new Error("gitwiz did not bundle"); }
}
