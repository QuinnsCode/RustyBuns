// How the CLI starts a desktop host it built: app code we may not have read, on this machine.
//
// Always, because the desktop host never needs a secret (build.ts gives it none):
//   --no-env-file   Bun won't load the project's .env into it
//   --no-install    a missing import fails instead of fetching from npm at run time
//   hostEnv()       tokens, keys and cloud credentials stay out of its environment
//
// With --sandbox or RB_SANDBOX=1, on macOS: a Seatbelt profile (sandbox-exec) that lets it do
// anything except read or write the places credentials live (~/.ssh, ~/.aws, ~/.alchemy, gh,
// wrangler, keychains...) and the project's .env, .dev.vars and .alchemy/. On Linux: bubblewrap (bwrap)
// with the same list covered by empty mounts (#897). Opt-in, because a host
// that pushes over SSH with your keys (codeSplitter's mirrors) needs ~/.ssh. Elsewhere it says so
// and runs without one.
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { wranglerLoginFiles } from "./cloudflare-auth.ts";
import { sharedStateBase } from "./state.ts";

export const HOST_FLAGS = ["--no-env-file", "--no-install"];

// RB_* is ours (RB_TOKEN is the launch token); SSH_AUTH_SOCK and GIT_SSH_COMMAND are how a host
// reaches git remotes, and Seatbelt is the lock for those.
const KEEP = /^(RB_|SSH_AUTH_SOCK$|GIT_SSH_COMMAND$)/;
// the deploy's own RB_ secrets (report-deploy.ts, drain.ts), which no host reads
const DEPLOY_ONLY = /^RB_(DEPLOY_REPORT_KEY|DRAIN_SECRET)$/;
const SECRET = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|ACCESS_KEY|AUTH|SESSION|COOKIE|^(AWS|AZURE|GCP|GOOGLE|GH|GITHUB|CLOUDFLARE|CF|OP|ANTHROPIC|OPENAI|NPM|ALCHEMY|HCLOUD|HETZNER|RAILWAY|VERCEL|DOCKER|STRIPE)_/i;

/** The environment minus anything that looks like a credential. */
export function hostEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !DEPLOY_ONLY.test(k) && (KEEP.test(k) || !SECRET.test(k))) out[k] = v;
  return out;
}

// The deploy's own logins: every Cloudflare variable (the account id too), Alchemy's, and the other
// providers' tokens. A Worker build needs none of them, and it runs the app's code: a stranger's, when
// you box someone else's repo (a Jekyll plugin, a Vite plugin, a postinstall). The rest stays, since a
// build may read the app's .dev.vars, NPM_TOKEN for a private package, or GITHUB_SHA for a version.
const DEPLOY_LOGIN = /^(CLOUDFLARE|CF|WRANGLER|ALCHEMY)_|^(HCLOUD|HETZNER|RAILWAY|OP|AWS|AZURE|GCP|VERCEL|DOCKER|GH|GITHUB)_.*(TOKEN|SECRET|PASSW|CREDENTIAL|KEY)/i;

// A repo whose package.json pins "packageManager": "pnpm@11.3.0" makes an older pnpm switch itself:
// it runs `pnpm add pnpm@11.3.0` in a child, and under an empty HOME or a sandbox that can't keep the
// result, each child switches again. On the office Mac that was 1,164 copies and 27 GB (#5764).
// The installed pnpm runs the repo instead (pnpm 10 reads npm_config_*, pnpm 11 pnpm_config_*).
export const NO_PM_SWITCH = { npm_config_manage_package_manager_versions: "false", pnpm_config_manage_package_manager_versions: "false" };

/** The environment plan, deploy and dev build the Worker in: everything but the deploy's logins (#1114),
 *  with pnpm's version switch off (#5764). */
export function buildEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = { ...NO_PM_SWITCH };
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !DEPLOY_LOGIN.test(k)) out[k] = v;
  return out;
}

/** env with every node_modules/.bin from `dir` up to / ahead on PATH, as `pnpm exec` and `npm run` give a
 *  script: a build of "vite build" fails with `vite: command not found` from a global `rustybuns plan`. */
export function withLocalBins(env: Record<string, string>, dir: string): Record<string, string> {
  const bins: string[] = [];
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "node_modules/.bin"))) bins.push(join(d, "node_modules/.bin"));
    if (dirname(d) === d) break;
  }
  return { ...env, PATH: [...bins, env.PATH].filter(Boolean).join(delimiter) };
}

// With --sandbox the build also gets an empty HOME (#1128), as scripts/trial-github.ts gives a stranger's
// repo: no ~/.wrangler, ~/.alchemy, ~/.npmrc, ~/.config/gh or ~/.aws to read. The package caches and the
// toolchains found through HOME point back at the real ones, so installs stay warm and rbenv, nvm, Volta,
// asdf, mise and cargo still find their versions. Opt-in, like run desktop --sandbox: a build that needs a
// login under HOME (a private registry in ~/.npmrc, Docker's context) loses it.
const HOME_CACHES: [string, string][] = [
  ["npm_config_cache", ".npm"],
  ["npm_config_store_dir", process.platform === "darwin" ? "Library/pnpm/store" : ".local/share/pnpm/store"],
  ["BUN_INSTALL", ".bun"],
  ["BUN_INSTALL_CACHE_DIR", ".bun/install/cache"],
  ["YARN_CACHE_FOLDER", process.platform === "darwin" ? "Library/Caches/Yarn" : ".cache/yarn"],
  ["YARN_GLOBAL_FOLDER", ".yarn/berry"],
  ["XDG_CACHE_HOME", ".cache"],
  ["BUNDLE_USER_CACHE", ".bundle/cache"],
  ["GEM_SPEC_CACHE", ".gem/specs"],
  ["RBENV_ROOT", ".rbenv"],
  ["NVM_DIR", ".nvm"],
  ["VOLTA_HOME", ".volta"],
  ["ASDF_DATA_DIR", ".asdf"],
  ["MISE_DATA_DIR", ".local/share/mise"],
  ["CARGO_HOME", ".cargo"],
  ["RUSTUP_HOME", ".rustup"],
];
/** Variables that point a tool at a config or login file instead of HOME: unset under an empty HOME. */
const HOME_POINTERS = /^(DOCKER_CONFIG|KUBECONFIG|CLOUDSDK_CONFIG|AWS_CONFIG_FILE|AWS_SHARED_CREDENTIALS_FILE|NPM_CONFIG_USERCONFIG|BUNDLE_USER_HOME|BUNDLE_USER_CONFIG|GNUPGHOME|XDG_DATA_HOME|XDG_STATE_HOME)$/i;

/** buildEnv's result with HOME swapped for `home` (an empty folder), keeping the package caches under the real one. */
export function emptyHome(env: Record<string, string>, home: string, realHome = homedir(), exists: (p: string) => boolean = existsSync): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (!HOME_POINTERS.test(k)) out[k] = v;
  for (const [k, rel] of HOME_CACHES) if (!(k in out) && exists(join(realHome, rel))) out[k] = join(realHome, rel);
  // Apple's system gitconfig still sets credential.helper=osxkeychain, and on a 401 git would ask a keychain
  // this HOME doesn't have: macOS pops "Keychain Not Found" on screen. An empty helper (appended to any
  // GIT_CONFIG_* list already set) and no prompt make it just fail.
  const n = Number(out.GIT_CONFIG_COUNT) || 0;
  Object.assign(out, { GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: "credential.helper", [`GIT_CONFIG_VALUE_${n}`]: "", GIT_TERMINAL_PROMPT: "0" });
  return { ...out, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), GH_CONFIG_DIR: join(home, ".config/gh") };
}

/** Under $HOME: where credentials live. */
const HOME_SECRETS = [
  ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".docker", ".netrc", ".npmrc", ".git-credentials", ".pypirc",
  ".alchemy", ".wrangler", ".op", ".config/op", ".config/gh", ".config/gcloud", ".config/.wrangler", ".config/hcloud",
  ".config/railway", ".railway", "Library/Preferences/.wrangler", "Library/Keychains", "Library/Group Containers/2BUA8C4S2C.com.1password",
];
/** In the project (and its repo root): what AGENTS.md keeps agents out of too. */
const PROJECT_SECRETS = [".env", ".env.local", ".env.development", ".env.production", ".dev.vars", ".alchemy"];

const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const q = (p: string) => JSON.stringify(p); // Seatbelt strings take the same escapes

/** The repo root above `dir`: the nearest folder with a .git (dir or worktree file). */
function repoRoot(dir: string): string | undefined {
  for (let d = dir; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return undefined;
  }
}

/** The credential paths a jailed host is kept out of: HOME_SECRETS, PROJECT_SECRETS in cwd and its repo root, wrangler's
 *  login wherever XDG_CONFIG_HOME puts it, and the deploy state every worktree shares in .git (state.ts), which
 *  `.alchemy/state` only links to. */
export function deniedPaths(cwd: string, home = homedir(), env: Record<string, string | undefined> = process.env): string[] {
  const root = repoRoot(cwd);
  const roots = [...new Set([cwd, root].filter((d): d is string => !!d).map(real))];
  const wrangler = wranglerLoginFiles(env, real(home)).map((f) => dirname(dirname(f)));
  const shared = root ? sharedStateBase(root) : null;
  return [...new Set([...HOME_SECRETS.map((p) => join(real(home), p)), ...wrangler,
    ...roots.flatMap((r) => PROJECT_SECRETS.map((p) => join(r, p))), ...(shared ? [real(dirname(shared))] : [])])];
}

/** A Seatbelt profile: everything allowed but the credential paths. */
export function seatbeltProfile(cwd: string, home = homedir()): string {
  return `(version 1)\n(allow default)\n(deny file-read* file-write*\n${deniedPaths(cwd, home).map((p) => `  (subpath ${q(p)})`).join("\n")})\n`;
}

/** Linux (#897): bubblewrap args that leave the whole system as it is (`--dev-bind / /`, network and all)
 *  but cover each credential path that exists: a folder with an empty tmpfs, a file with /dev/null, read
 *  only. A path that isn't there is skipped, since bwrap would make the mount point on the real disk; so
 *  unlike Seatbelt a host can create one (a new ~/.aws) — it just can't see the keys that were already there. */
export function bwrapArgs(cwd: string, home = homedir(), kind: (p: string) => "dir" | "file" | undefined = pathKind): string[] {
  const out = ["--dev-bind", "/", "/", "--die-with-parent"];
  for (const p of deniedPaths(cwd, home)) {
    const k = kind(p);
    if (k === "dir") out.push("--tmpfs", p);
    else if (k === "file") out.push("--ro-bind", "/dev/null", p);
  }
  return out;
}

function pathKind(p: string): "dir" | "file" | undefined {
  try { return statSync(p).isDirectory() ? "dir" : "file"; } catch { return undefined; }
}

let jail: "seatbelt" | "bwrap" | null | undefined;
/** Which jail works here: sandbox-exec on macOS (it can't nest inside another Seatbelt sandbox), bwrap on
 *  Linux (it needs unprivileged user namespaces, which some distros and containers turn off). */
function jailHere(): "seatbelt" | "bwrap" | null {
  if (jail === undefined) {
    const ok = (cmd: string[]) => { try { return Bun.spawnSync(cmd, { stdout: "ignore", stderr: "ignore" }).exitCode === 0; } catch { return false; } };
    const bwrap = process.platform === "linux" ? Bun.which("bwrap") : null;
    jail = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") && ok(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"]) ? "seatbelt"
      : bwrap && ok([bwrap, "--dev-bind", "/", "/", "true"]) ? "bwrap" : null;
  }
  return jail;
}

/** Was the sandbox asked for: --sandbox in the host args, or RB_SANDBOX=1. Strips the flag. */
export function wantsSandbox(args: string[], env: Record<string, string | undefined> = process.env): { on: boolean; args: string[] } {
  return { on: args.includes("--sandbox") || env.RB_SANDBOX === "1", args: args.filter((a) => a !== "--sandbox") };
}

/** The command that runs `script` (a built host) with `args`: Bun's locks on, jailed when asked. */
export function hostCommand(script: string, args: string[] = [], opts: { sandbox?: boolean; cwd?: string } = {}): string[] {
  const cmd = ["bun", ...HOST_FLAGS, script, ...args];
  if (!opts.sandbox) return cmd;
  const cwd = opts.cwd ?? process.cwd();
  switch (jailHere()) {
    case "seatbelt": return ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(cwd), ...cmd];
    case "bwrap": return [Bun.which("bwrap")!, ...bwrapArgs(cwd), "--", ...cmd];
    default: {
      const why = process.platform === "darwin" ? "no Seatbelt here (already inside a sandbox?)"
        : process.platform === "linux" ? "no working bwrap here (install bubblewrap; it needs unprivileged user namespaces)" : `no sandbox on ${process.platform}`;
      console.error(`[rustybuns] --sandbox: ${why}; the host runs without it`);
      return cmd;
    }
  }
}
