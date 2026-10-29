// How long each test file takes, for CI to split the suite into shards of about equal time (scripts/ci-apps.ts).
//
//   cd apps/codesplitter && bun test --parallel --reporter=junit --reporter-outfile=/tmp/junit.xml test
//   bun scripts/test-times.ts /tmp/junit.xml        writes test-times.json: { "test/foo.test.ts": ms, ... }
//   bun scripts/test-times.ts /tmp/junit.xml ../skate-tech-park/test-times.json    another sharded app's (run from that app)
//
// A file missing from test-times.json (a new one) is weighed by its size, so a stale snapshot only unbalances the shards.
import { readFileSync, writeFileSync } from "node:fs";
import { fromJunit } from "./ester-memory.ts";

/** Total ms per test file in a bun JUnit report. */
export function timesOf(xml: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of fromJunit(xml, ".")) if (s.file) out[s.file] = (out[s.file] ?? 0) + s.ms;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

if (import.meta.main) {
  const [xml, out] = process.argv.slice(2);
  if (!xml) throw new Error("usage: bun scripts/test-times.ts <junit.xml> [out.json]");
  const times = timesOf(readFileSync(xml, "utf8"));
  writeFileSync(out ?? new URL("../test-times.json", import.meta.url), JSON.stringify(times, null, 2) + "\n");
  console.log(`wrote times for ${Object.keys(times).length} test files`);
}
