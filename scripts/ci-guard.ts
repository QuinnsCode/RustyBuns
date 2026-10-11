// The repo's GitHub Actions stay free (see COSTS.md): run on every PR by apps.yml's plan job.
// Actions minutes cost nothing on a public repo's standard GitHub-hosted runners. Two
// things would change that, and this fails the PR if either sneaks in:
//
//   - a runner that isn't a standard one: a larger runner (billed even on a public
//     repo) or a self-hosted one (anyone's fork PR runs code on that machine).
//   - a job without timeout-minutes: GitHub's default is 6 hours, so a hung job sits
//     there that long, and on a paid runner bills it.
//
// Matrix runners (`${{ matrix.runner }}`) come from scripts/ci-apps.ts, so its labels are checked too.
//
//   bun scripts/ci-guard.ts

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** GitHub's standard hosted runners, free on a public repo. */
export const FREE = new Set([
  "ubuntu-latest", "ubuntu-24.04", "ubuntu-22.04", "ubuntu-24.04-arm", "ubuntu-22.04-arm",
  "macos-latest", "macos-15", "macos-14", "macos-15-intel", "macos-13",
  "windows-latest", "windows-2025", "windows-2022", "windows-11-arm",
]);
/** The longest a job may be given; raise it here, on purpose, if a job needs more. */
export const MAX_MINUTES = 60;

type Job = { "runs-on"?: unknown; "timeout-minutes"?: unknown; uses?: string };

/** What's wrong with these workflows, one line each; none means they're fine. */
export function problems(workflows: Record<string, string>, matrixRunners: string[]): string[] {
  const out: string[] = [];
  for (const r of matrixRunners) if (!FREE.has(r)) out.push(`scripts/ci-apps.ts: runner ${r} isn't a standard GitHub-hosted one`);
  for (const [file, text] of Object.entries(workflows)) {
    const jobs = ((Bun.YAML.parse(text) as { jobs?: Record<string, Job> })?.jobs) ?? {};
    for (const [name, job] of Object.entries(jobs)) {
      const at = `${file}: job ${name}`;
      if (job.uses) continue;   // a reusable workflow's jobs are its own
      const t = job["timeout-minutes"];
      if (typeof t !== "number") out.push(`${at} has no timeout-minutes (GitHub's default is 6 hours)`);
      else if (t > MAX_MINUTES) out.push(`${at}: timeout-minutes ${t} is over ${MAX_MINUTES}`);
      const on = job["runs-on"];
      const labels = typeof on === "string" ? [on] : Array.isArray(on) ? on.map(String) : [JSON.stringify(on)];
      for (const l of labels) {
        if (/^\$\{\{\s*matrix\.runner\s*\}\}$/.test(l)) continue;   // from ci-apps.ts, checked above
        if (!FREE.has(l)) out.push(`${at} runs on ${l}, not a standard GitHub-hosted runner`);
      }
    }
  }
  return out;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const dir = join(root, ".github/workflows");
  const workflows = Object.fromEntries(readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [`.github/workflows/${f}`, readFileSync(join(dir, f), "utf8")]));
  const runners = [...readFileSync(join(root, "scripts/ci-apps.ts"), "utf8").matchAll(/runner:\s*"([^"]+)"/g)].map((m) => m[1]!);
  const bad = problems(workflows, runners);
  if (bad.length) {
    console.error(`GitHub Actions would stop being free:\n${bad.map((b) => `  - ${b}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`ci-guard: ${Object.keys(workflows).length} workflows, standard runners and timeouts throughout`);
}
