// Where a PR's before/after pictures live (#5951, the owner's pick): a `shots` branch of the private manual-run
// repo. `bun run probe <app> --before-after <dir> --push` pushes the two PNGs there and prints the markdown for the
// PR body. Free, and `gh` can't upload attachments; the catch is that the pictures load only for people who can
// read that repo (anyone else sees the alt text).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { MANUAL_REPO } from "./manual-runs-lib.ts";

const BRANCH = "shots";

/** Commit `files` into `folder` on the `shots` branch of `remote` and push, starting the branch if there is none.
 *  Each try is a fresh copy of the tip, so two agents pushing at once both land. */
export function pushShots(files: string[], folder: string, remote = `https://github.com/${MANUAL_REPO}.git`, tries = 3) {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  const git = (...args: string[]) => {
    const run = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=probe", "-c", "user.email=probe@localhost", "-c", "commit.gpgsign=false", ...args],
      { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" });
    return { ok: run.exitCode === 0, said: run.stderr.toString().trim() };
  };
  try {
    git("init", "-q");
    if (git("fetch", "-q", "--depth", "1", remote, BRANCH).ok) git("checkout", "-q", "FETCH_HEAD");
    mkdirSync(join(dir, folder), { recursive: true });
    for (const f of files) copyFileSync(f, join(dir, folder, basename(f)));
    git("add", "--", folder);
    git("commit", "-q", "-m", folder);
    const push = git("push", "-q", remote, `HEAD:refs/heads/${BRANCH}`);
    if (push.ok) return;
    if (tries <= 1) throw new Error(`could not push the shots to ${remote}: ${push.said}`);
    pushShots(files, folder, remote, tries - 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** The PR body's lines for the PNGs pushed to `folder`; a new app has no before.png. */
export function shotsMarkdown(folder: string, files: string[]) {
  const names = files.map((f) => basename(f, ".png"));
  const img = (n: string) => `![${n}](https://github.com/${MANUAL_REPO}/blob/${BRANCH}/${folder}/${n}.png?raw=true)`;
  const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return ["## Before / after", "", row(names), row(names.map(() => "---")), row(names.map(img)), "",
    `These load only for people who can read \`${MANUAL_REPO}\`.`].join("\n");
}
