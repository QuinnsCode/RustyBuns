// Writes public/ui.js: packages/ui bundled for the static page (it has no build step). Run `bun run ui` after the kit changes.
import { join } from "node:path";

export const bundle = async (): Promise<string> => {
  const r = await Bun.build({ entrypoints: [join(import.meta.dir, "../../../packages/ui/src/index.ts")], target: "browser", format: "esm", minify: true });
  if (!r.success) throw new Error(r.logs.join("\n"));
  return r.outputs[0].text();
};

if (import.meta.main) { await Bun.write(join(import.meta.dir, "../public/ui.js"), await bundle()); console.log("wrote public/ui.js"); }
