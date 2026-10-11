// Mark every version in advisories.json deprecated on npm, so bun/npm warn at
// install time, before the CLI's own check ever runs. Needs your npm login
// (`npm login`), so you run it: `bun run deprecate:bad`. Re-running is harmless.
import { readFileSync } from "node:fs";
import { validRange, type Advisory } from "../packages/cli/src/advisories.ts";

const { advisories } = JSON.parse(readFileSync("advisories.json", "utf8")) as { advisories: Advisory[] };
let failed = 0;
for (const a of advisories) {
  if (!validRange(a.versions)) { console.error(`skipping ${JSON.stringify(a.versions)}: not a plain range`); failed++; continue; }
  const msg = `${a.why}. ${a.do === "downgrade" ? "Go back to" : "Upgrade to"} @rustybuns/cli@${a.to}.`;
  console.log(`npm deprecate "@rustybuns/cli@${a.versions}" "${msg}"`);
  const p = Bun.spawnSync(["npm", "deprecate", `@rustybuns/cli@${a.versions}`, msg], { stdio: ["inherit", "inherit", "inherit"] });
  if (p.exitCode !== 0) failed++;
}
process.exit(failed ? 1 : 0);
