// #5523: hiring a worker on this repo (10,000+ files) failed with "Could not create a git worktree: Updating files: 45%".
// Upstream runs `git worktree add` with a 20 s timeout (60 s when a worktree is put back), which a full checkout can
// outrun; the killed git's last stderr line is its progress, so the error looked like a broken checkout. A checkout now
// gets 5 minutes, and a git the office stopped says it ran out of time.
import { once } from "./once.ts";

/** How long `git worktree add` may take, in ms. */
export const CHECKOUT_TIMEOUT_MS = 5 * 60_000;

/** server/worktrees.js: a longer timeout for `worktree add`, and a timed-out git said as one. */
export function slowCheckout(js: string) {
  const rel = "worktrees.js";
  const add = `(args[0] === 'worktree' && args[1] === 'add' ? ${CHECKOUT_TIMEOUT_MS} : `;
  js = once(js, rel, "stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 })", `stdio: ['ignore', 'pipe', 'pipe'], timeout: ${add}20_000) })`);
  js = once(js, rel, "encoding: 'utf8', timeout: 60_000, maxBuffer", `encoding: 'utf8', timeout: ${add}60_000), maxBuffer`);
  js = once(js, rel, "export function gitError(err) {\n    const e = err;\n",
    "export function gitError(err) {\n    const e = err;\n" +
    "    if (e?.code === 'ETIMEDOUT' || (e?.killed && e?.signal))\n" +
    "        return 'git ran out of time and was stopped';\n");
  return js;
}
