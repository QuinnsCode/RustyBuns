// The docs sites. `bun run site` builds each one into dist/site/<name>/: `latest/` from the working
// tree plus a folder per release tag, read from git, so every version's docs match its code.
// `bun run site --check` (typecheck.yml runs it) builds only latest, into a temp dir, and fails on any
// link inside the site that doesn't land on a page or heading.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atTag, buildSite, shown, tags, worktree } from "./site/lib.ts";
import { rustybuns } from "./site/rustybuns.ts";

const check = process.argv.includes("--check");
const sites = [{ dir: "rustybuns", site: rustybuns, tags: "v*" }];

const root = check ? mkdtempSync(join(tmpdir(), "site-")) : "dist/site";
if (!check) rmSync(root, { recursive: true, force: true });
const problems: string[] = [];
for (const { dir, site, tags: pattern } of sites) {
  const sources = [worktree(), ...(check ? [] : tags(pattern).map(atTag))];
  problems.push(...buildSite(site, join(root, dir), sources).map((p) => `${dir}: ${p}`));
  if (!check) console.log(`${site.name}: ${sources.map((s) => s.version).join(", ")} -> ${shown(join(root, dir))}/index.html`);
}
if (check) rmSync(root, { recursive: true, force: true });
if (problems.length) {
  console.error(`site check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
if (check) console.log("site ok");
