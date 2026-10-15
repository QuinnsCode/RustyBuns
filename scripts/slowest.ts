// The slowest tests of a JUnit report, longest first, so a test that is turning into a hang shows before it
// takes the job's budget. Prints a markdown table (for $GITHUB_STEP_SUMMARY) and a ::warning for each test over
// the limit.
//
//   bun scripts/slowest.ts <junit.xml> [--top 15] [--limit 30]     limit in seconds
import { readFileSync } from "node:fs";

export type Slow = { file: string; name: string; s: number };

const unescape = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Every testcase in a JUnit report with its time, slowest first. */
export function slowest(xml: string): Slow[] {
  const out: Slow[] = [];
  for (const m of xml.matchAll(/<testcase ([^>]*?)\/?>/g)) {
    const attr = (k: string) => unescape(m[1]!.match(new RegExp(`(?:^|\\s)${k}="([^"]*)"`))?.[1] ?? "");
    out.push({ file: attr("file") || attr("classname"), name: attr("name"), s: Number(attr("time")) });
  }
  return out.sort((a, b) => b.s - a.s);
}

if (import.meta.main) {
  const arg = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
  const [file] = process.argv.slice(2), top = arg("top", 15), limit = arg("limit", 30);
  if (!file) throw new Error("usage: bun scripts/slowest.ts <junit.xml> [--top 15] [--limit 30]");
  const rows = slowest(readFileSync(file, "utf8"));
  console.log("| seconds | test |\n|---:|---|");
  for (const r of rows.slice(0, top)) console.log(`| ${r.s.toFixed(1)} | ${r.file} ${r.name.replace(/\|/g, "\\|")} |`);
  for (const r of rows.filter((r) => r.s > limit)) console.log(`::warning title=slow test::${r.file} "${r.name}" took ${r.s.toFixed(1)}s (limit ${limit}s)`);
}
