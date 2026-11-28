// `rustybuns plan` where there is nothing to plan: an app with no rustybuns.config.ts, such as one that deploys with
// wrangler alone. That is an answer, not a failure, so it says how that app is previewed and deployed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Whether package.json in `dir` has a `deploy` script. A missing or broken file is a no. */
function hasDeployScript(dir: string): boolean {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof pkg === "object" && pkg !== null && "scripts" in pkg && typeof pkg.scripts === "object" && pkg.scripts !== null && "deploy" in pkg.scripts;
  } catch { return false; }
}

/** What to print in place of a plan, or null when `dir` has a config to plan (or one was named with RUSTYBUNS_CONFIG). */
export function noPlanNote(dir: string, named = process.env.RUSTYBUNS_CONFIG): string | null {
  if (named || existsSync(join(dir, "rustybuns.config.ts"))) return null;
  const wrangler = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"].find((f) => existsSync(join(dir, f)));
  if (!wrangler) return "no plan here: no rustybuns.config.ts and no wrangler config in this folder. Run this in an app's folder, or `rustybuns init` to make one.";
  return [
    `no plan here: this app has no rustybuns.config.ts. It deploys with wrangler (${wrangler}). Nothing was checked or changed.`,
    "  preview   bunx wrangler deploy --dry-run   (uploads nothing; build first if it serves built files)",
    "  what's up bunx wrangler deployments list   (an error that the Worker doesn't exist means a first deploy)",
    `  deploy    ${hasDeployScript(dir) ? "bun run deploy" : "bunx wrangler deploy"}`,
  ].join("\n");
}
