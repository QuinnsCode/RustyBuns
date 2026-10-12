// Which of T3 Code's server tests fail on Bun but not on Node, from vitest's JSON reports
// (one per runtime and shard, named <runtime>-<shard>.json). Prints markdown for the job summary.
//
//   bun .github/t3-bun/compare.ts <dir of reports>

import { readdirSync } from "node:fs";
import { join } from "node:path";

type Report = {
  numPassedTests: number; numFailedTests: number; numPendingTests: number;
  testResults: { name: string; status: string; assertionResults: { fullName: string; status: string }[] }[];
};
type Tally = Record<string, { passed: number; failed: number; skipped: number; failing: Set<string> }>;

/** Each runtime's totals and failing tests: "<file> > <test>", or "<file>" when the file itself failed. */
export function tally(reports: Record<string, Report[]>): Tally {
  const out: Tally = {};
  for (const [runtime, list] of Object.entries(reports)) {
    const t = (out[runtime] = { passed: 0, failed: 0, skipped: 0, failing: new Set<string>() });
    for (const r of list) {
      t.passed += r.numPassedTests; t.failed += r.numFailedTests; t.skipped += r.numPendingTests;
      for (const file of r.testResults) {
        const name = file.name.replace(/\\/g, "/").replace(/^.*?\/apps\/server\//, "");
        const failed = file.assertionResults.filter((a) => a.status === "failed");
        for (const a of failed) t.failing.add(`${name} > ${a.fullName}`);
        if (!failed.length && file.status === "failed") t.failing.add(name);
      }
    }
  }
  return out;
}

export function summary(t: Tally): string {
  const node = t.node?.failing ?? new Set<string>(), bun = t.bun?.failing ?? new Set<string>();
  const section = (title: string, s: string[]) =>
    [`**${title} (${s.length})**`, s.length ? s.sort().map((x) => `- \`${x}\``).join("\n") : "none", ""];
  return [
    "| Runtime | Passed | Failed | Skipped |", "|---|---|---|---|",
    ...Object.entries(t).map(([r, x]) => `| ${r} | ${x.passed} | ${x.failed} | ${x.skipped} |`), "",
    ...section("Fail on Bun only", [...bun].filter((x) => !node.has(x))),
    ...section("Fail on Node only", [...node].filter((x) => !bun.has(x))),
    ...section("Fail on both", [...bun].filter((x) => node.has(x))),
  ].join("\n");
}

if (import.meta.main) {
  const dir = process.argv[2] ?? ".";
  const reports: Record<string, Report[]> = {};
  for (const f of readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".json"))) {
    const runtime = f.split(/[\\/]/).pop()!.split("-")[0]!;
    (reports[runtime] ??= []).push(await Bun.file(join(dir, f)).json());
  }
  console.log(summary(tally(reports)));
}
