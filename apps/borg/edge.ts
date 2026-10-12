// bun edge.ts <command>: the guard rails around tier 2's edge run (#866, .github/workflows/borg-edge.yml).
//   stage             print a fresh stage name, borg<unix seconds>
//   cap <plan.txt>    refuse (exit 1) a plan over the cost cap; BORG_MAX_RESOURCES, BORG_ALLOW_PAID=1
//   url <stage>       the deployed Worker's URL, from Alchemy's state
//   sweep [--stage S] [--dry-run]
//                     delete borg resources older than an hour, and stage S's whatever their age
//                     (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
import { readFileSync } from "node:fs";
import { DEFAULT_CAP, overCap, stageName, sweep } from "./src/edge.ts";

const [cmd, arg, ...rest] = process.argv.slice(2);
if (cmd === "stage") console.log(stageName());
else if (cmd === "cap" && arg) {
  const problems = overCap(readFileSync(arg, "utf8"), {
    maxResources: Number(process.env.BORG_MAX_RESOURCES || DEFAULT_CAP.maxResources),
    allowPaid: process.env.BORG_ALLOW_PAID === "1",
  });
  if (problems.length) { console.error(`over the cost cap, so no deploy:\n  ${problems.join("\n  ")}`); process.exit(1); }
  console.log("inside the cost cap: every resource bills by usage, none needs Workers Paid");
} else if (cmd === "url" && arg) {
  const url = JSON.parse(readFileSync(`.alchemy/state/borg-slim/${arg}/Worker.json`, "utf8"))?.attr?.url;
  if (typeof url !== "string") { console.error(`no Worker URL in the Alchemy state for stage ${arg}`); process.exit(1); }
  console.log(url);
} else if (cmd === "sweep") {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } = process.env;
  if (!token || !accountId) { console.error("sweep needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(2); }
  const flags = [arg, ...rest].filter((a): a is string => !!a);
  const dryRun = flags.includes("--dry-run"), at = flags.indexOf("--stage");
  const swept = await sweep({ token, accountId, dryRun, stage: at >= 0 ? flags[at + 1] : undefined });
  for (const s of swept) console.log(`${s.error ? "✗" : dryRun ? "-" : "✓"} ${s.kind.padEnd(6)} ${s.name}${s.error ? `  ${s.error}` : ""}`);
  console.log(swept.length ? `${dryRun ? "would sweep" : "swept"} ${swept.length}` : "nothing of borg's left to sweep");
  process.exit(swept.some((s) => s.error) ? 1 : 0);
} else { console.error("usage: bun edge.ts stage | cap <plan.txt> | url <stage> | sweep [--stage S] [--dry-run]"); process.exit(2); }
