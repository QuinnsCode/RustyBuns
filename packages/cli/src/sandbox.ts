// How the CLI starts a desktop host it built: app code we may not have read, on this machine.
//
// Always, because the desktop host never needs a secret (build.ts gives it none):
//   --no-env-file   Bun won't load the project's .env into it
//   --no-install    a missing import fails instead of fetching from npm at run time
//   hostEnv()       tokens, keys and cloud credentials stay out of its environment
//
// With --sandbox or RB_SANDBOX=1, on macOS: a Seatbelt profile (sandbox-exec) that lets it do
// anything except read or write the places credentials live (~/.ssh, ~/.aws, ~/.alchemy, gh,
// wrangler, keychains...) and the project's .env, .dev.vars and .alchemy/. Opt-in, because a host
// that pushes over SSH with your keys (codeSplitter's mirrors) needs ~/.ssh. Elsewhere it says so
// and runs without one.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HOST_FLAGS = ["--no-env-file", "--no-install"];

// RB_* is ours (RB_TOKEN is the launch token); SSH_AUTH_SOCK and GIT_SSH_COMMAND are how a host
// reaches git remotes, and Seatbelt is the lock for those.
const KEEP = /^(RB_|SSH_AUTH_SOCK$|GIT_SSH_COMMAND$)/;
const SECRET = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|ACCESS_KEY|AUTH|SESSION|COOKIE|^(AWS|AZURE|GCP|GOOGLE|GH|GITHUB|CLOUDFLARE|CF|OP|ANTHROPIC|OPENAI|NPM|ALCHEMY|HCLOUD|HETZNER|RAILWAY|VERCEL|DOCKER|STRIPE)_/i;

/** The environment minus anything that looks like a credential. */
export function hostEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && (KEEP.test(k) || !SECRET.test(k))) out[k] = v;
  return out;
}

// The deploy's own logins: every Cloudflare variable (the account id too), Alchemy's, and the other
// providers' tokens. A Worker build needs none of them, and it runs the app's code: a stranger's, when
// you box someone else's repo (a Jekyll plugin, a Vite plugin, a postinstall). The rest stays, since a
// build may read the app's .dev.vars, NPM_TOKEN for a private package, or GITHUB_SHA for a version.
const DEPLOY_LOGIN = /^(CLOUDFLARE|CF|WRANGLER|ALCHEMY)_|^(HCLOUD|HETZNER|RAILWAY|OP|AWS|AZURE|GCP|VERCEL|DOCKER|GH|GITHUB)_.*(TOKEN|SECRET|PASSW|CREDENTIAL|KEY)/i;

/** The environment plan, deploy and dev build the Worker in: everything but the deploy's logins (#1114). */
export function buildEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !DEPLOY_LOGIN.test(k)) out[k] = v;
  return out;
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
  ".config/railway", ".railway", "Library/Keychains", "Library/Group Containers/2BUA8C4S2C.com.1password",
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

/** A Seatbelt profile: everything allowed but the credential paths. */
export function seatbeltProfile(cwd: string, home = homedir()): string {
  const roots = [...new Set([cwd, repoRoot(cwd)].filter((d): d is string => !!d).map(real))];
  const paths = [...HOME_SECRETS.map((p) => join(real(home), p)), ...roots.flatMap((r) => PROJECT_SECRETS.map((p) => join(r, p)))];
  return `(version 1)\n(allow default)\n(deny file-read* file-write*\n${paths.map((p) => `  (subpath ${q(p)})`).join("\n")})\n`;
}

let seatbelt: boolean | undefined;
/** sandbox-exec is there and works here (it can't nest inside another Seatbelt sandbox). */
function seatbeltWorks(): boolean {
  if (seatbelt === undefined) {
    seatbelt = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")
      && Bun.spawnSync(["/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)", "/usr/bin/true"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
  }
  return seatbelt;
}

/** Was the sandbox asked for: --sandbox in the host args, or RB_SANDBOX=1. Strips the flag. */
export function wantsSandbox(args: string[], env: Record<string, string | undefined> = process.env): { on: boolean; args: string[] } {
  return { on: args.includes("--sandbox") || env.RB_SANDBOX === "1", args: args.filter((a) => a !== "--sandbox") };
}

/** The command that runs `script` (a built host) with `args`: Bun's locks on, in Seatbelt when asked. */
export function hostCommand(script: string, args: string[] = [], opts: { sandbox?: boolean; cwd?: string } = {}): string[] {
  const cmd = ["bun", ...HOST_FLAGS, script, ...args];
  if (!opts.sandbox) return cmd;
  if (!seatbeltWorks()) {
    console.error(`[rustybuns] --sandbox: no Seatbelt here (${process.platform === "darwin" ? "already inside a sandbox?" : "macOS only for now"}); the host runs without it`);
    return cmd;
  }
  return ["/usr/bin/sandbox-exec", "-p", seatbeltProfile(opts.cwd ?? process.cwd()), ...cmd];
}
