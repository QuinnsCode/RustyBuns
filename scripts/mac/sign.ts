// bun scripts/mac/sign.ts <app> <darwin binaries...>
// sign.sh's second half: the keychain holds the Developer ID and the `rustybuns-ci` notary
// profile by now, so this is `rustybuns build desktop --sign --notarize` on finished binaries.
import { $ } from "bun";
import { rmSync } from "node:fs";
import { developerIds, signDarwin } from "../../packages/cli/src/sign.ts";

const [app, ...bins] = process.argv.slice(2);
if (!app || !bins.length) throw new Error("usage: bun scripts/mac/sign.ts <app> <darwin binaries...>");
const team = process.env.APPLE_TEAM_ID;
// The .p12's identity, checked against the team, so a stray certificate can't sign a release.
const ids = developerIds(await $`security find-identity -v -p codesigning`.text()).filter((i) => !team || i.endsWith(`(${team})`));
if (ids.length !== 1) throw new Error(`want one Developer ID Application for team ${team}, found ${ids.length}`);
process.env.RB_SIGN_IDENTITY = ids[0];
const zips = await signDarwin(bins, { identifier: `dev.rustybuns.${app}`, notarize: "rustybuns-ci" });
// The zips were for Apple; the drop ships the bare binaries, as before.
for (const z of zips) rmSync(z);
console.log(`signed and notarized ${bins.join(", ")}`);
