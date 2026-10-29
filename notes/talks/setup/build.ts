// `bun notes/talks/setup/build.ts`: bundles scene.ts (three.js and the real models from packages/models) into
// page.html and writes one self-contained dist/talks/setup.html, ready to open or publish as an artifact.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const here = import.meta.dir;
const models = join(here, "../../../packages/models/src");
const out = join(here, "../../../dist/talks/setup.html");

// three lives in packages/models' own node_modules, so resolve it from there.
const fromModels: Bun.BunPlugin = {
  name: "three-from-models",
  setup(b) {
    b.onResolve({ filter: /^three(\/|$)/ }, (args) => ({ path: Bun.resolveSync(args.path, models) }));
  },
};

const built = await Bun.build({ entrypoints: [join(here, "scene.ts")], minify: true, target: "browser", plugins: [fromModels] });
if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}
const js = (await built.outputs[0].text()).replaceAll("</script", "<\\/script");
const page = await Bun.file(join(here, "page.html")).text();
mkdirSync(dirname(out), { recursive: true });
await Bun.write(out, page.replace("<!-- scene -->", () => `<script type="module">${js}</script>`));
console.log(`${out} (${Math.round(Bun.file(out).size / 1024)} KB)`);
