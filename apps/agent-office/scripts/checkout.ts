// #5523: hiring a worker on this repo (10,000+ files) failed with "Could not create a git worktree: Updating files: 45%".
// Upstream runs `git worktree add` with a 20 s timeout (60 s when a worktree is put back), which a full checkout can
// outrun; the killed git's last stderr line is its progress, so the error looked like a broken checkout. A checkout now
// gets 5 minutes, and a git the office stopped says it ran out of time.
import { once } from "./once.ts";

/** How long `git worktree add` (and `remove`, which deletes as many files: #5657) may take, in ms. */
export const CHECKOUT_TIMEOUT_MS = 5 * 60_000;

/** server/worktrees.js: a longer timeout for `worktree add` and `remove`, and a timed-out git said as one. */
export function slowCheckout(js: string) {
  const rel = "worktrees.js";
  const add = `(args[0] === 'worktree' && (args[1] === 'add' || args[1] === 'remove') ? ${CHECKOUT_TIMEOUT_MS} : `;
  js = once(js, rel, "stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 })", `stdio: ['ignore', 'pipe', 'pipe'], timeout: ${add}20_000) })`);
  js = once(js, rel, "encoding: 'utf8', timeout: 60_000, maxBuffer", `encoding: 'utf8', timeout: ${add}60_000), maxBuffer`);
  js = once(js, rel, "export function gitError(err) {\n    const e = err;\n",
    "export function gitError(err) {\n    const e = err;\n" +
    "    if (e?.code === 'ETIMEDOUT' || (e?.killed && e?.signal))\n" +
    "        return 'git ran out of time and was stopped';\n");
  return js;
}

// A worker started from 3-day-old code: upstream starts a worktree from origin's copy of the branch the floor's checkout
// is on. Agents in the floor checkout left it on `load-in-dress-cables`, reset to main; that branch's origin copy was
// its squash-merged PR's last commit, so `startPoint` saw the two diverged and handed every hire the stale branch, and
// their PRs undid work merged since (#5600 undid three PRs). Every PR here goes to main, so a worktree starts from
// origin's default branch (`origin/HEAD`), whatever the floor checkout is on; with no origin/HEAD, upstream's choice.

/** server/worktrees.js: new worktrees start from (and fetch) origin's default branch, not the checkout's branch. */
export function startFromDefault(js: string) {
  const rel = "worktrees.js";
  js = once(js, rel, "            const from = this.currentBranch();\n            const { base, note }",
    "            const from = this.baseBranch();\n            const { base, note }");
  js = once(js, rel, "        const from = this.currentBranch();\n        if (!from || !this.hasOrigin())",
    "        const from = this.baseBranch();\n        if (!from || !this.hasOrigin())");
  js = once(js, rel, "    /** The branch the project is on, or undefined when HEAD is detached. */\n",
    "    /** The branch new worktrees start from: origin's default branch, else the one the project is on. */\n" +
    "    baseBranch() {\n" +
    "        try {\n" +
    "            return this.gitSync(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\\//, '') || this.currentBranch();\n" +
    "        }\n" +
    "        catch {\n" +
    "            return this.currentBranch();\n" +
    "        }\n" +
    "    }\n" +
    "    /** The branch the project is on, or undefined when HEAD is detached. */\n");
  return js;
}

// 2026-11-22: the disk fell to 5.7 GB free and hires failed with "Could not create a git worktree: Updating files: 45%".
// A checkout that runs out of disk leaves git's `error:`/`fatal:` lines before (or among) its progress, and upstream
// kept only the last line. A hire now checks the free space first and says so in plain words (`lowDisk`, live/sweep.ts),
// and a failed git says its own error lines, progress dropped.

/** server/worktrees.js: a hire on a nearly full disk is refused before its checkout, and a git error keeps git's words. */
export function plainCheckout(js: string) {
  const rel = "worktrees.js";
  js = "import { lowDisk as __rbLowDisk } from './rb-sweep.js';\n" + js;
  js = once(js, rel, "    create(slug, sub, root = this.dir) {\n        try {\n",
    "    create(slug, sub, root = this.dir) {\n        const low = __rbLowDisk(root);\n        if (low)\n            return low;\n        try {\n");
  js = once(js, rel, "    return String(e.stderr || e.message || err).trim().split('\\n').filter(Boolean).pop() ?? 'git failed';\n",
    "    const lines = String(e.stderr || e.message || err).split(/[\\r\\n]+/).map((l) => l.trim()).filter((l) => l && !/^\\S[^:]*: +\\d+% \\(\\d+\\/\\d+\\)/.test(l));\n" +
    "    const said = lines.filter((l) => /^(fatal|error):/.test(l));\n" +
    "    return (said.length ? said.slice(-3).join(' · ') : lines.pop()) ?? 'git failed';\n");
  return js;
}

// Each hire wrote the whole checkout again (1.2 GB of this repo). The new worktree now clones the floor checkout's files
// instead (live/clone.ts); a fill that fails takes its worktree and branch with it, as a failed `worktree add` would.

/** server/worktrees.js: a hire's worktree is added without a checkout, then filled with copy-on-write clones. */
export function clonedCheckout(js: string) {
  const rel = "worktrees.js";
  js = "import { fillWorktree as __rbFill } from './rb-clone.js';\n" + js;
  return once(js, rel, "            this.gitSync(['worktree', 'add', '-b', branch, path.resolve(root, rel), base]);\n",
    "            const abs = path.resolve(root, rel);\n" +
    "            this.gitSync(['worktree', 'add', '--no-checkout', '-b', branch, abs, base]);\n" +
    "            try {\n" +
    "                __rbFill(this.dir, abs, " + CHECKOUT_TIMEOUT_MS + ");\n" +
    "            }\n" +
    "            catch (err) {\n" +
    "                this.gitSync(['worktree', 'remove', '--force', abs]);\n" +
    "                this.gitSync(['branch', '-D', branch]);\n" +
    "                throw err;\n" +
    "            }\n");
}
