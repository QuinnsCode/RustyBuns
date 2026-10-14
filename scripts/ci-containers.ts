// Container images in CI (#818 part 2). Two halves:
//
//   plan  (imported by ci-apps.ts)  which container bindings a PR touched. Read from each app's
//                                   rustybuns.config.ts as text, so the plan job needs no install.
//   run   bun ../../scripts/ci-containers.ts NAME path/to/Dockerfile   (cwd: the app)
//                                   build for linux/amd64, boot it, write a row to the job summary,
//                                   exit 1 on failure. The same buildOne / smokeOne `rustybuns containers` uses.

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildOne, containerBindings, mb, smokeOne } from "../packages/cli/src/containers.ts";
import type { RustyBunsConfig } from "../packages/cli/src/config.ts";

export interface Image { app: string; binding: string; dockerfile: string; context: string }

/** `NAME: { type: "container", ... dockerfile: "path" ...}` in a config's text. */
export function imagesIn(app: string, config: string): Image[] {
  return [...config.matchAll(/\b([A-Z][A-Z0-9_]*):\s*\{\s*type:\s*"container",[^}]*?dockerfile:\s*"([^"]+)"/g)].map((m) => {
    const dockerfile = m[2]!, at = dockerfile.lastIndexOf("/");
    return { app, binding: m[1]!, dockerfile, context: at < 0 ? "" : dockerfile.slice(0, at) };
  });
}

/** Where the images are built from: a change here rebuilds every image. */
const SHARED = /^packages\/cli\/src\/(gen\/|containers\.ts$)|^scripts\/ci-containers\.ts$/;

/** The images whose build context the diff touched; all of them when the shared build code did. */
export function touchedImages(images: Image[], changed: string[]): Image[] {
  if (changed.some((f) => SHARED.test(f))) return images;
  return images.filter((i) => changed.some((f) => f.startsWith(`apps/${i.app}/${i.context ? i.context + "/" : ""}`)));
}

export function allImages(root = join(import.meta.dir, "..")): Image[] {
  const apps = join(root, "apps");
  return readdirSync(apps).flatMap((app) => {
    const cfg = join(apps, app, "rustybuns.config.ts");
    return existsSync(cfg) ? imagesIn(app, readFileSync(cfg, "utf8")) : [];
  });
}

/** The summary table's row, and its header for the first. */
export const SUMMARY_HEAD = "| Image | Build | Size | Boot |\n|---|---|---|---|\n";

if (import.meta.main) {
  const [binding, dockerfile] = process.argv.slice(2);
  if (!binding || !dockerfile) throw new Error("usage: bun scripts/ci-containers.ts NAME path/to/Dockerfile (from the app's folder)");
  const [b] = containerBindings({ bindings: { [binding]: { type: "container", className: binding, dockerfile } } } as unknown as RustyBunsConfig);
  const label = `\`${binding}\` (${dockerfile})`;
  const summary = (row: string, extra = "") => {
    const out = process.env.GITHUB_STEP_SUMMARY;
    if (out) appendFileSync(out, SUMMARY_HEAD + row + "\n" + extra);
    console.log(row);
  };
  let built;
  try { built = await buildOne("ci", b!, { verbose: true }); }
  catch (e) {
    const msg = (e as Error).message;
    summary(`| ${label} | failed | | |`, `\n\`\`\`\n${msg.slice(0, 4000)}\n\`\`\`\n`);
    process.exit(1);
  }
  const t0 = performance.now(), r = await smokeOne("ci", b!, { env: {} });
  const boot = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
  summary(`| ${label} | ${(built.ms / 1000).toFixed(0)}s | ${mb(built.size)} | ${r.ok ? "up in " + boot : "failed"} |`, r.ok ? "" : `\n\`\`\`\n${r.note}\n\`\`\`\n`);
  if (!r.ok) process.exit(1);
}
