// The smoke and security run: every test the security model in REFERENCE.md cites, then the stress
// script (tier 1 and the faked paid paths), with a row per promise. Nothing leaves the machine.
//
//   bun run smoke [--no-stress] [--json]
//
// The promises come from test/trust-promises.ts, so a test renamed or dropped shows here as
// "missing" (and fails test/trust.test.ts in CI). The tests run once, as one `bun test` with a JUnit
// report (--parallel, a process per file, as `bun run test` does: the files share state in one), and
// each promise is as green as the tests it cites.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APP, citedFiles, promises, type Cite } from "../test/trust-promises.ts";

const AS_JSON = process.argv.includes("--json"), STRESS = !process.argv.includes("--no-stress");

type Verdict = "ok" | "FAIL" | "skipped" | "missing";
export interface Row { part: string; promise: string; verdict: Verdict; tests: { file: string; name: string; verdict: Verdict; ms: number }[] }

const unescape = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Each testcase in a JUnit report: `file name` -> its verdict and time. */
function parseJunit(xml: string): Map<string, { verdict: Verdict; ms: number }> {
  const out = new Map<string, { verdict: Verdict; ms: number }>();
  for (const m of xml.matchAll(/<testcase ([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attr = (k: string) => unescape(m[1].match(new RegExp(` ?${k}="([^"]*)"`))?.[1] ?? "");
    const body = m[3] ?? "";
    const verdict: Verdict = body.includes("<failure") ? "FAIL" : body.includes("<skipped") ? "skipped" : "ok";
    out.set(`${attr("file")} ${attr("name")}`, { verdict, ms: Math.round(Number(attr("time")) * 1000) });
  }
  return out;
}

/** Run the cited test files once, as one bun test, and read the report back. */
async function runTests(files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-smoke-"));
  const report = join(dir, "junit.xml");
  try {
    const proc = Bun.spawn(["bun", "test", "--parallel", ...files, "--reporter=junit", `--reporter-outfile=${report}`], { cwd: APP, stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    let xml = "";
    try { xml = readFileSync(report, "utf8"); } catch { throw new Error(`bun test exited ${code} and left no report`); }
    return parseJunit(xml);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export async function smoke(): Promise<{ rows: Row[]; pass: boolean }> {
  const list = promises();
  const files = [...new Set([...citedFiles(list), "test/security.test.ts", "test/trust.test.ts"])];
  const results = await runTests(files);
  const look = (c: Cite) => results.get(`${c.file} ${c.name}`) ?? { verdict: "missing" as Verdict, ms: 0 };
  const rows: Row[] = list.map((p) => {
    const tests = p.cites.map((c) => ({ ...c, ...look(c) }));
    const verdicts = tests.map((t) => t.verdict);
    const verdict: Verdict = verdicts.includes("FAIL") ? "FAIL" : verdicts.includes("missing") ? "missing" : verdicts.every((v) => v === "skipped") ? "skipped" : "ok";
    return { part: p.part, promise: p.text, verdict, tests };
  });
  return { rows, pass: rows.every((r) => r.verdict === "ok") };
}

if (import.meta.main) {
  const { rows, pass } = await smoke();
  if (!AS_JSON) {
    let part = "";
    console.log("\nThe security model (REFERENCE.md), a row per promise:\n");
    for (const r of rows) {
      if (r.part !== part) { part = r.part; console.log(`${part}`); }
      const ms = r.tests.reduce((n, t) => n + t.ms, 0);
      console.log(`  ${r.verdict.padEnd(8)} ${String(ms).padStart(6)} ms  ${r.promise.length > 110 ? r.promise.slice(0, 107) + "..." : r.promise}`);
      for (const t of r.tests) if (t.verdict !== "ok") console.log(`           ${t.verdict}: ${t.file}: "${t.name}"`);
    }
    const n = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
    console.log(`\n${rows.length} promises: ${n("ok")} ok, ${n("FAIL")} failed, ${n("missing")} missing, ${n("skipped")} skipped`);
  }
  let stress = 0;
  if (STRESS) {
    if (!AS_JSON) console.log("\nStress, tier 1 and the faked paid paths (scripts/stress.ts):\n");
    stress = await Bun.spawn(["bun", "scripts/stress.ts", "--paid-paths", ...(AS_JSON ? ["--json"] : [])], { cwd: APP, stdout: "inherit", stderr: "inherit" }).exited;
  }
  if (AS_JSON) console.log(JSON.stringify({ rows, pass, stress: STRESS ? stress === 0 : null }, null, 2));
  process.exit(pass && stress === 0 ? 0 : 1);
}
