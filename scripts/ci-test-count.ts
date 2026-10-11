// Runs a test command as-is and reports how many single tests passed, failed and were skipped, so the
// Agent Office PR board's health bar can count tests, not just CI checks (apps/agent-office/checks/).
//
//   bun scripts/ci-test-count.ts "bun test test"
//
// It reads bun test's closing summary (" 12 pass", " 1 fail", " 2 skip", summed if the command runs bun test more
// than once), prints it as a `::notice title=tests::12 pass, 1 fail, 2 skip` annotation on the job's check run
// (the office reads those back with `gh api .../check-runs/<id>/annotations`), adds a line to the job summary,
// and exits with the command's own code.
import { appendFileSync } from "node:fs";

export type TestCount = { pass: number; fail: number; skip: number };

/** bun test's summary lines, ANSI colours and all; undefined when there are none. */
export function countOf(out: string): TestCount | undefined {
  const t: TestCount = { pass: 0, fail: 0, skip: 0 };
  let seen = false;
  for (const m of out.replace(/\x1b\[[0-9;]*m/g, "").matchAll(/^\s*(\d+) (pass|fail|skip|todo)\s*$/gm)) {
    t[m[2] === "todo" ? "skip" : (m[2] as keyof TestCount)] += Number(m[1]);
    seen = true;
  }
  return seen ? t : undefined;
}

export const notice = (t: TestCount) => `::notice title=tests::${t.pass} pass, ${t.fail} fail, ${t.skip} skip`;

if (import.meta.main) {
  const cmd = process.argv.slice(2).join(" ");
  if (!cmd) throw new Error("usage: bun scripts/ci-test-count.ts <test command>");
  const child = Bun.spawn(["sh", "-c", cmd], { stdin: "inherit", stdout: "pipe", stderr: "pipe" });
  let out = "";
  const pump = async (from: ReadableStream<Uint8Array>, to: NodeJS.WriteStream) => {
    const dec = new TextDecoder();
    const reader = from.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) { out += dec.decode(r.value, { stream: true }); to.write(r.value); }
  };
  await Promise.all([pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)]);
  const code = await child.exited;
  const t = countOf(out);
  if (t) {
    console.log(notice(t));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Tests: ${t.pass} passed, ${t.fail} failed, ${t.skip} skipped\n`);
  }
  process.exit(code);
}
