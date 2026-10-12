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
