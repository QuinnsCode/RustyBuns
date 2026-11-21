// The desktop deploy journey (deploy-check.ts) on just the framework examples a change touches, not all of them
// every time: a rolling check. An example whose folder changed since --base gets the journey; a change to the deploy
// machinery itself (Ship's try, preview and deploy routes, the CLI's deploy glue, deploy-check.ts) with no example
// changed gets today's example from a rotation, so over a few weeks every one is walked without walking all of them.
//
//   bun scripts/deploy-changed.ts                  the journey on what changed since origin/main (committed or not)
//     --base <ref>     compare against another ref
//     --list           only print which examples it would run and why, deploy nothing
//
// Each one runs `deploy-check.ts --app ../<example> --cli local --try --preview --drop <binding>` (the first binding in
// its rustybuns.config.ts; none, and it deploys twice instead), one at a time, and everything is torn down after.
// It deploys to the Cloudflare account this Mac's wrangler is logged in to, about 3 to 5 min an example.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { help } from "../../../scripts/help.ts";

/** Paths whose change can break any example's deploy, so a change there walks one example. */
export const MACHINERY = [
  "apps/codesplitter/scripts/deploy-check.ts",
  "apps/codesplitter/src/deploy",
  "apps/codesplitter/src/preview.ts",
  "apps/codesplitter/src/try-out.ts",
  "packages/cli/src/glue/deploy",
];

export type Pick = { app: string; why: string };

/** Which examples to walk: each one a changed file sits in, else (machinery changed) the rotation's pick for `day`. */
export function pick(changed: string[], examples: string[], day: number): Pick[] {
  const touched = examples.filter((e) => changed.some((f) => f.startsWith(`apps/frameworks/${e}/`)));
  if (touched.length) return touched.map((app) => ({ app, why: "its folder changed" }));
  const hit = changed.find((f) => MACHINERY.some((m) => f.startsWith(m)));
  if (!hit || !examples.length) return [];
  return [{ app: examples[day % examples.length]!, why: `${hit} changed; today's turn in the rotation` }];
}

/** The binding --drop takes out: the first `NAME: {` in the config's bindings, or none. */
export function dropBinding(config: string): string | undefined {
  return config.match(/^\s*"?([A-Z][A-Z0-9_]*)"?\s*:\s*\{/m)?.[1];
}

if (import.meta.main) {
  help(import.meta.path);
  const { values: a } = parseArgs({ options: { base: { type: "string", default: "origin/main" }, list: { type: "boolean", default: false } } });
  const root = resolve(import.meta.dir, "../../..");
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd: root });
    if (!r.success) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
    return r.stdout.toString().split("\n").filter(Boolean);
  };
  const changed = [...new Set([...git("diff", "--name-only", `${a.base}...HEAD`), ...git("diff", "--name-only", "HEAD")])];
  const examples = readdirSync(join(root, "apps/frameworks")).filter((d) => existsSync(join(root, "apps/frameworks", d, "rustybuns.config.ts"))).sort();
  const picks = pick(changed, examples, Math.floor(Date.now() / 86_400_000));
  if (!picks.length) { console.log(`nothing to walk: no example or deploy machinery changed since ${a.base}`); process.exit(0); }
  for (const p of picks) console.log(`${p.app}: ${p.why}`);
  if (a.list) process.exit(0);
  const failed: string[] = [];
  for (const { app } of picks) {
    const drop = dropBinding(readFileSync(join(root, "apps/frameworks", app, "rustybuns.config.ts"), "utf8"));
    const cmd = ["bun", "scripts/deploy-check.ts", "--app", `../frameworks/${app}`, "--cli", "local", "--try", "--preview", ...(drop ? ["--drop", drop] : [])];
    console.log(`\n== ${app}: ${cmd.join(" ")}`);
    const r = Bun.spawnSync(cmd, { cwd: join(root, "apps/codesplitter"), stdout: "inherit", stderr: "inherit" });
    if (!r.success) failed.push(app);
  }
  console.log(failed.length ? `\nred: ${failed.join(", ")}` : `\ngreen: ${picks.map((p) => p.app).join(", ")}`);
  process.exit(failed.length ? 1 : 0);
}
