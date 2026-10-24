// Builds Shared Sphere's host next to the plain one. Run in the TerraViz clone (run.ts --shared does): it copies the
// add-on into .rustybuns/sphere/, then builds the desktop from the config `rustybuns init` wrote with three changes
// made in memory, so the file stays as it was: the Worker's entry is our wrapper, a SPHERE Durable Object is bound,
// and TerraViz's own build step is skipped (dist/ and the Pages router are already there from the plain build).
import { buildDesktop } from "../../../packages/cli/src/build.ts";
import type { RustyBunsConfig } from "../../../packages/cli/src/config.ts";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUTDIR = ".rustybuns/sphere-dev";
const dir = ".rustybuns/sphere";
mkdirSync(dir, { recursive: true });
for (const f of ["room.ts", "worker.ts", "client.ts"]) copyFileSync(join(import.meta.dir, f), join(dir, f));
writeFileSync(join(dir, "entry.ts"), [
  `// written by RustyBuns apps/terraviz-demo/sphere/build.ts: TerraViz's generated router, wrapped`,
  `import inner from "../pages/index.ts";`,
  `import { sphere } from "./worker.ts";`,
  `export { SphereRoom } from "./room.ts";`,
  `export default sphere(inner);`,
  ``,
].join("\n"));

const base = (await import(join(process.cwd(), "rustybuns.config.ts"))).default as RustyBunsConfig;
const { build: _skip, ...worker } = base.worker!;
const config: RustyBunsConfig = {
  ...base,
  worker: { ...worker, main: `${dir}/entry.ts` },
  bindings: { ...base.bindings, SPHERE: { type: "durable_object", className: "SphereRoom" } },
};
console.log(`built ${await buildDesktop(config, { noCompile: true, outdir: OUTDIR })}`);
