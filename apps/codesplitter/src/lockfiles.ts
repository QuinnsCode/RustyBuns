// The one list of lockfile names. buildfiles.ts (what a review calls out), checks.ts (what
// re-runs every workspace's checks) and deps.ts (which package manager, what an agent may not
// edit) each used to keep their own, and they had drifted apart. Imports nothing.

/** Lockfiles that say which package manager a repo uses. */
export const LOCK_PM = { "bun.lock": "bun", "bun.lockb": "bun", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "package-lock.json": "npm" } as const;

/** Every lockfile name: the ones above, npm's shrinkwrap and deno's. */
export const LOCKFILES: readonly string[] = [...Object.keys(LOCK_PM), "npm-shrinkwrap.json", "deno.lock"];

/** Is this path, at any depth, a lockfile? */
export const isLockfile = (path: string) => LOCKFILES.includes(path.slice(path.lastIndexOf("/") + 1));
