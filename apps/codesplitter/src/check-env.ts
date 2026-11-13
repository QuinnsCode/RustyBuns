// Layout: what a check's command sees: a scrubbed environment, its own empty HOME and TMPDIR, and the sandbox user if one is set,
// else (on macOS) a sandbox profile that keeps it out of the owner's home
// What a check's command sees of the machine it runs on (#1010). Merged code is code that runs at
// home, so a check on the desktop or a runner of your own (scripts/runner.ts) gets none of the
// owner's logins: a scrubbed environment, an empty HOME and TMPDIR of its own, and, given a
// sandbox user (CODESPLITTER_CHECKS_USER, or the runner's --user), it runs as that OS user too. Without one it
// runs as the owner, so on macOS sandbox-exec holds it out of the owner's real home: it reads only the tools
// on PATH there and writes nothing there. Its package caches are its own (under the owner's temp dir), never
// the owner's ~/.bun or ~/.npm, so an install script can't plant a package the owner's own installs pick up.
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

/**
 * No keychain for git. macOS's own git config sets `credential.helper = osxkeychain`, so a fetch
 * that gets a 401 (GitHub's answer for a repo that isn't there) asks the login keychain, and under
 * an empty HOME there isn't one: macOS pops "Keychain Not Found" on the owner's screen, once per
 * fetch. An empty helper clears the list, and git fails quietly instead.
 */
export const NO_KEYCHAIN = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "", GIT_TERMINAL_PROMPT: "0" };

/** The directories a run gets under its own temp dir: the clone, and its own empty HOME and TMPDIR. */
/** A branch pushed upstream (or opened from there) keeps its commit under these refs (mirror.ts), which a plain clone
 *  leaves behind: a runner fetches them when the commit it is to check out isn't on a branch. */
export const UPSTREAM_BRANCHES = "+refs/upstream-branches/*:refs/upstream-branches/*";
export const runDirs = (base: string) => ({ repo: `${base}/repo`, home: `${base}/home`, tmp: `${base}/tmp` });

/**
 * The environment a check's command runs with: KEEP from `from`, an empty `home` and `tmp`,
 * CI=1 and NO_KEYCHAIN. Running as the owner, the package caches are one shared by every check (installs stay
 * fast) in the owner's temp dir, apart from the owner's own; a sandbox user gets its own under `home`.
 */
export function checkEnv(from: Record<string, string | undefined>, home: string, tmp: string, user?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of KEEP) if (from[k] !== undefined) env[k] = from[k]!;
  if (!user) {
    const cache = checkCache(from);
    env.BUN_INSTALL_CACHE_DIR = `${cache}/bun`;
    env.npm_config_cache = `${cache}/npm`;
  }
  return { ...env, ...NO_KEYCHAIN, HOME: home, TMPDIR: tmp, CI: "1" };
}

/** Where checks run as the owner keep their package caches: the owner's own temp dir, out of their home. */
export const checkCache = (from: Record<string, string | undefined>) => `${(from.TMPDIR ?? "/tmp").replace(/\/+$/, "")}/codesplitter-check-cache`;

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/**
 * The macOS sandbox profile for a command run as the owner: nothing under `home` (the owner's real one) is read or
 * written, but for the tools on `env.PATH` there (each bin folder and the lib beside it, rustup's toolchains), read
 * only, and the run's own folder and the check cache when those sit inside it. Later rules win.
 */
export function confineProfile(home: string, env: Record<string, string>) {
  // The sandbox matches real paths, and macOS's /var and /tmp are links into /private.
  const q = (p: string) => [p, ...(/^\/(var|tmp|etc)(\/|$)/.test(p) ? [`/private${p}`] : [])].map((x) => `(subpath ${JSON.stringify(x)})`).join(" ");
  const under = (p: string) => p === home || p.startsWith(home + "/");
  const tools = new Set<string>();
  for (const d of (env.PATH ?? "").split(":").filter((d) => d.startsWith("/") && under(d) && d !== home)) {
    tools.add(d);
    if (d.endsWith("/bin")) tools.add(d.slice(0, -4) + "/lib");
    if (d === `${home}/.cargo/bin`) tools.add(`${home}/.rustup/toolchains`);
  }
  const own = [env.HOME && env.HOME.replace(/\/[^/]+$/, ""), env.BUN_INSTALL_CACHE_DIR && env.BUN_INSTALL_CACHE_DIR.replace(/\/bun$/, "")].filter((p): p is string => !!p && under(p));
  return [
    "(version 1)", "(allow default)",
    `(deny file-read-data file-write* ${q(home)})`,
    ...[...tools].map((t) => `(allow file-read-data ${q(t)})`),
    ...own.map((p) => `(allow file-read-data file-write* ${q(p)})`),
  ].join("\n");
}

/**
 * `cmd` with `env`, as Bun.spawn should start it: as `user` through sudo, with only `env` (sudo resets the
 * rest) and umask 000, so the owner can still read and clean up what it leaves; with no user, as the owner, held out
 * of `home` (the owner's real one) by sandbox-exec where the machine has it (macOS).
 */
export function spawnAs(cmd: string[], env: Record<string, string>, user?: string, home?: string, sandbox = SANDBOX_EXEC): { cmd: string[]; env: Record<string, string> } {
  if (!user) {
    const fs = home && home !== "/" && typeof Bun !== "undefined" && Bun.file(sandbox).size > 0 ? sandbox : null;
    return fs ? { cmd: [fs, "-p", confineProfile(home!.replace(/\/+$/, ""), env), ...cmd], env } : { cmd, env };
  }
  const vars = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  return { cmd: ["sudo", "-n", "-u", user, "--", "/usr/bin/env", "-i", ...vars, "/bin/sh", "-c", 'umask 000; exec "$@"', "sh", ...cmd], env: { PATH: env.PATH ?? "/usr/bin:/bin" } };
}

/** A sandbox user's name, checked: letters, digits, `.`, `_` and `-`, never root. */
export function sandboxUser(name: string | undefined) {
  if (!name) return undefined;
  if (!/^[a-z_][a-z0-9._-]*$/i.test(name) || name === "root") throw new Error(`${name}: not a sandbox user name`);
  return name;
}
