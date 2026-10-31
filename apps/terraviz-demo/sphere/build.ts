// Builds Shared Sphere's host next to the plain one. Run in the TerraViz clone (run.ts --shared does): it stages the
// add-on (stage.ts), then builds the desktop from the config `rustybuns init` wrote with Shared Sphere changed in
// memory, so the file stays as it was. With --compile it makes the one-file binary instead of the dev host.
import { buildDesktop } from "../../../packages/cli/src/build.ts";
import type { RustyBunsConfig } from "../../../packages/cli/src/config.ts";
import { join } from "node:path";
import { stageSphere, withSphere } from "./stage.ts";

export const OUTDIR = ".rustybuns/sphere-dev";
export const BINARY = ".rustybuns/sphere-dev/terraviz-shared-sphere";
stageSphere();
const config = withSphere((await import(join(process.cwd(), "rustybuns.config.ts"))).default as RustyBunsConfig);
const compile = process.argv.includes("--compile");
console.log(`built ${await buildDesktop(config, compile ? { outfile: BINARY } : { noCompile: true, outdir: OUTDIR })}`);
