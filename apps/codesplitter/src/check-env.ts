// Layout: what a check's command sees: a scrubbed environment, its own empty HOME and TMPDIR, and the sandbox user if one is set
// What a check's command sees of the machine it runs on (#1010). Merged code is code that runs at
// home, so a check on the desktop or a runner of your own (scripts/runner.ts) gets none of the
// owner's logins: a scrubbed environment, an empty HOME and TMPDIR of its own, and, given a
// sandbox user (CODESPLITTER_CHECKS_USER, or the runner's --user), it runs as that OS user too.
//
// The sandbox user runs through `sudo -n -u <user>`: make a standard user with no logins (say
// cs-checks, in System Settings > Users & Groups), and let the owner switch to it with no password:
//
//   echo "$USER ALL=(cs-checks) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/cs-checks
//
// Everything (the clone too) runs with umask 000 then, so the owner's process can still lay a
// branch's files over the clone, read its junit.xml and clean up after it.
//
// Imports nothing: the Worker bundles ci-runner.ts, which only reaches this on the desktop.

/** The variables a check keeps: enough to find its tools and speak the machine's language, nothing that logs anything in. */
const KEEP = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TERM", "TZ"];

/** The directories a run gets under its own temp dir: the clone, and its own empty HOME and TMPDIR. */
export const runDirs = (base: string) => ({ repo: `${base}/repo`, home: `${base}/home`, tmp: `${base}/tmp` });

/**
 * The environment a check's command runs with: KEEP from `from`, an empty `home` and `tmp`,
 * and CI=1. Running as the owner, the package caches still point at the owner's (installs stay
 * fast); a sandbox user can't read those, so it gets its own under `home`.
 */
export function checkEnv(from: Record<string, string | undefined>, home: string, tmp: string, user?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of KEEP) if (from[k] !== undefined) env[k] = from[k]!;
  const own = from.HOME;
  if (own && !user) {
    env.BUN_INSTALL_CACHE_DIR = from.BUN_INSTALL_CACHE_DIR ?? `${own}/.bun/install/cache`;
    env.npm_config_cache = from.npm_config_cache ?? `${own}/.npm`;
  }
  return { ...env, HOME: home, TMPDIR: tmp, CI: "1" };
}

/**
 * `cmd` with `env`, as Bun.spawn should start it: as is, or as `user` through sudo, with only
 * `env` (sudo resets the rest) and umask 000, so the owner can still read and clean up what it leaves.
 */
export function spawnAs(cmd: string[], env: Record<string, string>, user?: string): { cmd: string[]; env: Record<string, string> } {
  if (!user) return { cmd, env };
  const vars = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return { cmd: ["sudo", "-n", "-u", user, "--", "/usr/bin/env", "-i", ...vars, "/bin/sh", "-c", 'umask 000; exec "$@"', "sh", ...cmd], env: { PATH: env.PATH ?? "/usr/bin:/bin" } };
}

/** A sandbox user's name, checked: letters, digits, `.`, `_` and `-`, never root. */
export function sandboxUser(name: string | undefined) {
  if (!name) return undefined;
  if (!/^[a-z_][a-z0-9._-]*$/i.test(name) || name === "root") throw new Error(`${name}: not a sandbox user name`);
  return name;
}
