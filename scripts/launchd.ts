// A launchd job on the office Mac: a plist in ~/Library/LaunchAgents that runs one bun script on a calendar, with its
// output in a log. The ledger (apps/agent-office/ester/ledger-daily.ts) runs daily at 10:07; the releases page
// (scripts/releases.ts) at :17 past each waking hour. Imported, not run.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { esc } from "../packages/util/src/index.ts";

/** When it runs: launchd's StartCalendarInterval entries. `{ Minute: 17 }` alone is every hour at :17. */
export type When = { Hour?: number; Minute: number }[];

export type Job = { label: string; script: string; args?: string[]; cwd: string; when: When; log: string };

const plistOf = (label: string) => path.join(homedir(), "Library/LaunchAgents", `${label}.plist`);
const uid = () => process.getuid?.() ?? 501;

/** The plist launchd reads for `job`. */
export function plist(job: Job, bun = process.execPath, PATH = process.env.PATH ?? "/usr/bin:/bin"): string {
  const program = [bun, job.script, ...(job.args ?? [])].map((a) => `<string>${esc(a)}</string>`).join("");
  const times = job.when.map((t) => `<dict>${t.Hour === undefined ? "" : `<key>Hour</key><integer>${t.Hour}</integer>`}<key>Minute</key><integer>${t.Minute}</integer></dict>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>${esc(job.label)}</string>
 <key>ProgramArguments</key><array>${program}</array>
 <key>WorkingDirectory</key><string>${esc(job.cwd)}</string>
 <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(PATH)}</string></dict>
 <key>StartCalendarInterval</key><array>${times}</array>
 <key>StandardOutPath</key><string>${esc(job.log)}</string><key>StandardErrorPath</key><string>${esc(job.log)}</string>
</dict></plist>
`;
}

/** Write the plist and (re)load it. True when launchd took it. */
export function install(job: Job): boolean {
  const file = plistOf(job.label);
  mkdirSync(path.dirname(file), { recursive: true });
  mkdirSync(path.dirname(job.log), { recursive: true });
  writeFileSync(file, plist(job));
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid()}/${job.label}`]);
  return Bun.spawnSync(["launchctl", "bootstrap", `gui/${uid()}`, file], { stderr: "inherit" }).exitCode === 0;
}

export function uninstall(label: string): void {
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid()}/${label}`]);
  rmSync(plistOf(label), { force: true });
}

/** Hand a job's last step to a headless Claude: artifacts have no API, only Claude's own tools. Print mode leaves the
 *  Artifact tool off unless CLAUDE_CODE_ARTIFACT is set, and a publish of a file outside the working directory waits on
 *  an approval nobody can give unless its folder is `dir` (--add-dir). */
export function headless(prompt: string, tools: string, cwd: string, dir: string): void {
  const r = Bun.spawnSync(["claude", "-p", prompt, "--allowedTools", tools, "--add-dir", dir, "--model", "claude-sonnet-5-5"],
    { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, CLAUDE_CODE_ARTIFACT: "1" } });
  if (r.exitCode !== 0) throw new Error(`claude -p exited ${r.exitCode}`);
}
