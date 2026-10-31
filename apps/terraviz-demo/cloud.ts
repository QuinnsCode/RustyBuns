// Shared Sphere on Cloudflare: gets the TerraViz clone ready to deploy as its own stage, beside the plain one.
//
//   bun apps/terraviz-demo/cloud.ts            stage the add-on, write rustybuns.sphere.config.ts in the clone, print the commands
//   bun apps/terraviz-demo/cloud.ts --plan     the same, then `rustybuns plan --offline --stage sphere` (no account, no login)
//
// It never deploys or destroys: that needs the owner's Cloudflare login (MANUAL RUN issue). TerraViz's own files stay
// as they are; the second config is a new file in the clone, read through RUSTYBUNS_CONFIG. The clone is the one
// `run.ts` makes in ~/rustybuns-demos/terraviz, and its dist/ and Pages router come from the plain build.
import { $ } from "bun";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { RustyBunsConfig } from "../../packages/cli/src/config.ts";
import { linkRustybuns, stageSphere, withSphere } from "./sphere/stage.ts";

export const STAGE = "sphere";
export const CONFIG = "rustybuns.sphere.config.ts";
const REPO = resolve(import.meta.dir, "../..");
const CLI = join(REPO, "packages/cli/src/index.ts");
const clone = join(homedir(), "rustybuns-demos/terraviz/clones/zyra-project__terraviz");

/** The Worker, and so its workers.dev address. */
export const WORKER = "shared-terraviz";

/**
 * Shared Sphere with names of its own. A Worker only takes the name from `targets.edge.workerName` under `adopt`, and
 * `adopt` names every D1, R2, Vectorize and Analytics resource as the config does, which would be the plain site's
 * (both D1s are "sphere-feedback"). So each of those gets a `shared-terraviz-*` name here and nothing is shared.
 */
export function cloudSphere(base: RustyBunsConfig): RustyBunsConfig {
  const c = withSphere(base);
  const own = (key: string, sep: "-" | "_") => `${WORKER}-${key.toLowerCase().replace(/_/g, "-")}`.replace(/-/g, sep);
  const bindings = Object.fromEntries(Object.entries(c.bindings ?? {}).map(([k, b]) => [k,
    b.type === "d1" ? { ...b, databaseName: own(k, "-") }
    : b.type === "r2" ? { ...b, bucketName: own(k, "-") }
    : b.type === "vectorize" ? { ...b, indexName: own(k, "-") }
    : b.type === "analytics_engine" ? { ...b, dataset: own(k, "_") }
    : b]));
  return { ...c, bindings, targets: { ...c.targets, edge: { ...c.targets.edge!, adopt: true, workerName: WORKER } } };
}

/** The text of the second config: the clone's own, with Shared Sphere laid over it. */
export function sphereConfigFile(base: RustyBunsConfig) {
  return [
    `// written by RustyBuns apps/terraviz-demo/cloud.ts: TerraViz's rustybuns.config.ts plus Shared Sphere.`,
    `// Use it with RUSTYBUNS_CONFIG=${CONFIG} and --stage ${STAGE}; rustybuns.config.ts is untouched.`,
    `import { defineConfig } from "@rustybuns/cli/config";`,
    ``,
    `export default defineConfig(${JSON.stringify(cloudSphere(base), null, 2)});`,
    ``,
  ].join("\n");
}

/** The commands the owner runs from the clone. They run this checkout's CLI: `bunx rustybuns` in the clone finds another copy, which ignores RUSTYBUNS_CONFIG and plans the plain site. */
export const COMMANDS = (cwd: string) => [
  `cd ${cwd}`,
  `RUSTYBUNS_CONFIG=${CONFIG} bun ${CLI} plan --stage ${STAGE}     # read the account; stop if anything says delete`,
  `RUSTYBUNS_CONFIG=${CONFIG} bun ${CLI} deploy --stage ${STAGE}`,
  `RUSTYBUNS_CONFIG=${CONFIG} bun ${CLI} destroy --stage ${STAGE}  # to take it down again; the plain site is a different stage`,
];

if (import.meta.main) {
  if (!existsSync(join(clone, "dist/index.html")) || !existsSync(join(clone, ".rustybuns/pages/index.ts")))
    throw new Error(`no built TerraViz at ${clone}: run \`bun apps/terraviz-demo/run.ts\` first`);
  linkRustybuns(clone, REPO);
  process.chdir(clone);
  stageSphere();
  const base = (await import(join(clone, "rustybuns.config.ts"))).default as RustyBunsConfig;
  writeFileSync(CONFIG, sphereConfigFile(base));
  console.log(`wrote ${join(clone, CONFIG)}`);
  if (process.argv.includes("--plan"))
    await $`bun ${CLI} plan --offline --stage ${STAGE}`.env({ ...process.env, RUSTYBUNS_CONFIG: CONFIG });
  console.log(`\nThe owner runs:\n${COMMANDS(clone).map((c) => `  ${c}`).join("\n")}`);
}
