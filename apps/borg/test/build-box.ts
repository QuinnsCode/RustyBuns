// `rustybuns build box` for the local test. The config has no targets.box on purpose: with one,
// `rustybuns deploy` would stand up a Railway service too. So the box goes in here, in memory.
// Run from apps/borg; writes .rustybuns/railway/box.js.
import { buildRailway } from "../../../packages/cli/src/box.ts";
import config from "../rustybuns.config.ts";

console.log(`built ${await buildRailway({ ...config, targets: { ...config.targets, box: { provider: "railway" } } })}`);
