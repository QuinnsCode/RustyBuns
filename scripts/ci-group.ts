// Runs several apps' test suites in one CI job, one after another, each in its own folder as its own job would
// (apps.yml's group rows, from scripts/ci-apps.ts; #5564). Every suite runs, so one red app doesn't hide another's
// result, and the job fails if any did.
//
//   bun scripts/ci-group.ts apps/borg 'bun test test' apps/qcrm 'bun test test'
//
// ci-test-count.ts around it adds up their bun test summaries. Each app's output starts with a `ci-group: <dir>` line,
// which scripts/test-times.ts splits the job's log on. It imports nothing outside node, since a group job checks out
// only its own apps (and scripts/).
import { help } from "./help.ts";

help(import.meta.path);

export const MARK = "ci-group: ";

/** The log lines from `dir`'s marker up to the next marker: one app's part of a group job's log. */
export function section(log: string, dir: string): string {
  const out: string[] = [];
  let mine = false;
  for (const line of log.split("\n")) {
    const at = line.indexOf(MARK);
    if (at >= 0) { mine = line.slice(at + MARK.length).trim() === dir; continue; }
    if (mine) out.push(line);
  }
  return out.join("\n");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.length % 2) throw new Error("usage: bun scripts/ci-group.ts <app dir> <test command> [<app dir> <test command> ...]");
  const failed: string[] = [];
  for (let i = 0; i < argv.length; i += 2) {
    const [dir, test] = [argv[i]!, argv[i + 1]!];
    console.log(`${MARK}${dir}`);
    const r = Bun.spawnSync(["sh", "-c", test], { cwd: dir, stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) failed.push(dir);
  }
  if (failed.length) console.log(`::error title=failed::${failed.join(", ")}: bun scripts/ci-apps.ts lanes <app> runs one alone`);
  process.exit(failed.length ? 1 : 0);
}
