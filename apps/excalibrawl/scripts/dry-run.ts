// bun scripts/dry-run.ts [https://excalibrawl.com]   Where the migration's manual run (#967) stands. Reads only; bills nothing.
import config from "../rustybuns.config.ts";
import { dryRun, render } from "../src/manual-run.ts";

const cron = config.worker?.crons?.[0] ?? "0 * * * *";
const cap = config.bindings?.DAILY_CALLS;
console.log(render(await dryRun({
  site: (process.argv[2] ?? "https://excalibrawl.com").replace(/\/$/, ""),
  cron,
  dailyCalls: Number(cap && "value" in cap ? cap.value : 1000),
  now: Date.now(),
  fetch,
})));
