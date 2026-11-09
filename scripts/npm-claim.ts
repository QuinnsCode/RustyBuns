// The owner's one sitting before a release with new @rustybuns packages (#3392). npm only lets a trusted
// publisher be set on a package that already exists, and a new one expires unless a publish uses it within
// 2 days. So, for each package in the release set (check-release.ts --list) that isn't on npm yet:
//   1. publish a 0.0.0 placeholder (a package.json and a README, no code) from this machine, to claim the name;
//   2. `npm trust github` it to .github/workflows/npm-publish.yml in the `npm` environment.
// Then push the release tag within 2 days; the workflow publishes the real versions with provenance.
//
//   bun scripts/npm-claim.ts            do it (needs `npm login` and 2FA on the account; asks for 2FA in the browser)
//   bun scripts/npm-claim.ts --dry-run  only say which names are new and what it would run
// It never reads or prints a token. Packages already on npm are left alone (their trust is already set).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "./help.ts";

help(import.meta.path);
const dry = process.argv.includes("--dry-run");
const REPO = "QuinnsCode/RustyBuns";
// `npm trust` needs npm 11.15.0 or later; run that npm whatever the machine has.
const NPM = ["npx", "-y", "npm@11.15.0"];

const sh = (cmd: string[], quiet = false) => Bun.spawnSync(cmd, { stdio: quiet ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"] });
const text = (cmd: string[]) => { const r = sh(cmd, true); return r.exitCode === 0 ? String(r.stdout ?? "").trim() : null; };

const list = text(["bun", "scripts/check-release.ts", "--list"]);
if (!list) throw new Error("bun scripts/check-release.ts --list failed");
const version = text(["bun", "-p", "require('./packages/cli/package.json').version"]);
// `npm view` exits non-zero for a name npm has never seen.
const fresh = list.split(" ").map((p) => `@rustybuns/${p}`).filter((name) => text(["npm", "view", name, "name"]) === null);

if (!fresh.length) {
  console.log(`Every package in the set is on npm already. Push the tag: git tag v${version} origin/main && git push origin v${version}`);
  process.exit(0);
}
console.log(`New on npm (${fresh.length}): ${fresh.join(" ")}`);
if (dry) {
  for (const name of fresh) {
    console.log(`  ${NPM.join(" ")} publish <placeholder ${name}@0.0.0> --access public`);
    console.log(`  ${NPM.join(" ")} trust github ${name} --repo ${REPO} --file npm-publish.yml --env npm --yes`);
  }
  process.exit(0);
}

const who = text([...NPM, "whoami"]);
if (!who) { console.error("Not signed in to npm. Run `npm login` (it opens the browser), then this again."); process.exit(1); }
console.log(`Signed in to npm as ${who}.`);

const failed: string[] = [];
for (const name of fresh) {
  const dir = mkdtempSync(join(tmpdir(), "rustybuns-claim-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name, version: "0.0.0", license: "Apache-2.0",
    description: `Placeholder that claims the name. The first real release (${version}) comes from GitHub Actions with provenance.`,
    repository: { type: "git", url: `https://github.com/${REPO}` },
  }, null, 2));
  writeFileSync(join(dir, "README.md"), `# ${name}\n\nPlaceholder. Install ${version} or later: https://github.com/${REPO}\n`);
  console.log(`\n${name}: claiming with 0.0.0`);
  if (sh([...NPM, "publish", dir, "--access", "public"]).exitCode !== 0) { failed.push(`${name} (publish)`); continue; }
  await Bun.sleep(2000); // npm asks for 2 s between trust calls, and the new name needs a moment
  console.log(`${name}: trusting ${REPO} npm-publish.yml (environment npm)`);
  if (sh([...NPM, "trust", "github", name, "--repo", REPO, "--file", "npm-publish.yml", "--env", "npm", "--yes"]).exitCode !== 0) failed.push(`${name} (trust)`);
}

if (failed.length) {
  console.error(`\nNot done: ${failed.join(", ")}. Run this again: it skips the names already claimed, so a failed trust is set on npmjs.com by hand (package Settings > Trusted publishing: GitHub Actions, ${REPO}, npm-publish.yml, environment npm).`);
  process.exit(1);
}
console.log(`\nAll ${fresh.length} claimed and trusted. Within 2 days, push the tag and approve the paused npm-publish run:\n  git fetch origin && git tag v${version} origin/main && git push origin v${version}`);
