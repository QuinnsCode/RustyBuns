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

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
};

/** A job's own checkout: a detached, clean tree that only the job uses. Moves it to a fresh `origin/main` (and runs
 *  `bun install --frozen-lockfile` when the lockfile moved). Says what it did: "moved" means the running script is
 *  the old code, so run it again. A checkout on a branch or with changes is somebody's work and is left alone. */
export function catchUp(repo: string): "moved" | "current" | "skipped" {
  if (git(repo, "symbolic-ref", "-q", "HEAD").ok) return "skipped";
  if (git(repo, "status", "--porcelain").out) return "skipped";
  if (!git(repo, "fetch", "-q", "origin", "main").ok) return "skipped";
  const head = git(repo, "rev-parse", "HEAD").out, main = git(repo, "rev-parse", "FETCH_HEAD").out;
  if (head === main) return "current";
  const lockMoved = git(repo, "diff", "--quiet", head, main, "--", "bun.lock").ok === false;
  if (!git(repo, "checkout", "-q", "--detach", main).ok) return "skipped";
  if (lockMoved) Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: repo, stdout: "ignore", stderr: "inherit" });
  return "moved";
}

/** A checkout for a job to run from: `repo` itself, unless it is an office worktree (deleted when its worker goes home),
 *  then a detached worktree at `home` on `origin/main`, made once and installed. */
export function jobCheckout(repo: string, home: string): string {
  if (!repo.includes(`${path.sep}.agent-office${path.sep}worktrees${path.sep}`)) return repo;
  if (!git(home, "rev-parse", "--git-dir").ok) {
    mkdirSync(path.dirname(home), { recursive: true });
    git(repo, "fetch", "-q", "origin", "main");
    const r = git(repo, "worktree", "add", "-q", "--detach", home, "FETCH_HEAD");
    if (!r.ok) throw new Error(`git worktree add ${home}: ${r.err}`);
    Bun.spawnSync(["bun", "install", "--frozen-lockfile"], { cwd: home, stdout: "ignore", stderr: "inherit" });
  } else catchUp(home);
  return home;
}

/** Hand a job's last step to a headless Claude: artifacts have no API, only Claude's own tools. Print mode leaves the
 *  Artifact tool off unless CLAUDE_CODE_ARTIFACT is set, and a publish of a file outside the working directory waits on
 *  an approval nobody can give unless its folder is `dir` (--add-dir). */
export function headless(prompt: string, tools: string, cwd: string, dir: string): void {
  const r = Bun.spawnSync(["claude", "-p", prompt, "--allowedTools", tools, "--add-dir", dir, "--model", "claude-sonnet-5-5"],
    { cwd, stdout: "inherit", stderr: "inherit", env: { ...process.env, CLAUDE_CODE_ARTIFACT: "1" } });
  if (r.exitCode !== 0) throw new Error(`claude -p exited ${r.exitCode}`);
}
