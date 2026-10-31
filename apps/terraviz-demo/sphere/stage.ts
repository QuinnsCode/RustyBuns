// What Shared Sphere adds to a TerraViz clone, shared by the desktop host (build.ts) and the cloud deploy (cloud.ts).
// Run with the clone as the working directory. TerraViz's own files stay as they are: the add-on lands in
// .rustybuns/sphere/ and the demo tours in .rustybuns/content/, and the config is the one `rustybuns init` wrote with
// three changes made on top: the Worker's entry is our wrapper, a SPHERE Durable Object is bound, and TerraViz's own
// build step is skipped (dist/ and the Pages router are already there from the plain build).
import type { RustyBunsConfig } from "../../../packages/cli/src/config.ts";
import { copyFileSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DIR = ".rustybuns/sphere";
const content = ".rustybuns/content";

/** Copy the add-on and the tours into the clone and write the wrapper entry. */
export function stageSphere() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(content, { recursive: true });
  for (const f of ["room.ts", "worker.ts", "client.ts", "tours.ts", "tour-pkg.ts"]) copyFileSync(join(import.meta.dir, f), join(DIR, f));
  const contentDir = join(import.meta.dir, "../content");
  for (const f of readdirSync(contentDir).filter((f) => f.endsWith(".json"))) copyFileSync(join(contentDir, f), join(content, f));
  writeFileSync(join(DIR, "entry.ts"), [
    `// written by RustyBuns apps/terraviz-demo/sphere/stage.ts: TerraViz's generated router, wrapped`,
    `import inner from "../pages/index.ts";`,
    `import { sphere } from "./worker.ts";`,
    `export { SphereRoom } from "./room.ts";`,
    `export default sphere(inner);`,
    ``,
  ].join("\n"));
}

/** The config with Shared Sphere in: our entry, a SPHERE Durable Object, no build step of TerraViz's. */
export function withSphere(base: RustyBunsConfig): RustyBunsConfig {
  const { build: _skip, ...worker } = base.worker!;
  return {
    ...base,
    worker: { ...worker, main: `${DIR}/entry.ts` },
    bindings: { ...base.bindings, SPHERE: { type: "durable_object", className: "SphereRoom" } },
  };
}

/** The clone links @rustybuns/* to whichever checkout ran the trial, which may be gone (an agent's worktree): point them at `repo`. */
export function linkRustybuns(clone: string, repo: string) {
  for (const p of ["cli", "shell-bun", "util"]) {
    const link = join(clone, "node_modules/@rustybuns", p);
    rmSync(link, { force: true });
    symlinkSync(join(repo, "packages", p), link);
  }
}
