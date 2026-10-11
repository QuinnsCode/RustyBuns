// PreToolUse hook (wired in .claude/settings.json): stops an agent reading secrets, printing the
// environment, or pushing to main or tags. The deny-list there matches command prefixes; this catches
// the same things inside `a && b`, `$(...)`, `FOO=1 env`, `git -C dir push`, and Read/Grep paths.
// A speed bump, not a sandbox: a script the agent writes can still read a file. Exit 2 blocks the
// call and shows stderr to the agent.
import { homedir } from "node:os";
import { basename, resolve } from "node:path";

export type HookInput = { tool_name: string; tool_input: Record<string, unknown>; cwd?: string };
type BranchOf = (cwd: string) => string | null;

const MAIN = new Set(["main", "master"]);
const SAFE_ENV = new Set([".env.schema", ".env.example"]);
// Commands that print a file they're given.
const READERS = new Set(["cat", "head", "tail", "less", "more", "bat", "grep", "rg", "egrep", "fgrep", "sed", "awk",
  "source", ".", "cp", "base64", "xxd", "od", "strings", "nl", "sort", "uniq", "cut", "jq", "diff", "tac", "open"]);

export function secretPath(p: string, cwd = process.cwd()): boolean {
  const abs = resolve(cwd, p.replace(/^~(?=\/|$)/, homedir()));
  const name = basename(abs);
  if (name === ".env" || (name.startsWith(".env.") && !SAFE_ENV.has(name))) return true;
  if (name.startsWith(".dev.vars")) return true;
  if (/^\/proc\/[^/]+\/environ$/.test(abs)) return true;
  if (/\/\.alchemy\/state(\/|$)/.test(abs)) return true;
  if (abs.startsWith(`${homedir()}/agent-office/.agent-office/`)) return true;
  return /\/\.agent-office\/[^/]+\.json$/.test(abs);
}

const unquote = (t: string) => t.replace(/^['"]|['"]$/g, "");

// Rough shell split: one token list per simple command. Good enough for a guard.
export function segments(cmd: string): string[][] {
  return cmd
    .replace(/\$\(|`|\(|\)|\{|\}/g, ";")
    .split(/&&|\|\||[;|\n&]/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean).map(unquote))
    .filter((s) => s.length);
}

// Drop `FOO=1`, `sudo`, `env [opts] FOO=1` etc. in front of the real command.
function strip(t: string[]): { rest: string[]; bareEnv: boolean } {
  let i = 0;
  for (;;) {
    const w = t[i];
    if (w === undefined) break;
    if (/^\w+=/.test(w) || ["sudo", "command", "exec", "time", "nohup", "bunx", "npx"].includes(w)) { i++; continue; }
    if (w === "env") {
      i++;
      while (t[i] !== undefined && (t[i]!.startsWith("-") || /^\w+=/.test(t[i]!))) i += t[i] === "-u" ? 2 : 1;
      if (t[i] === undefined) return { rest: [], bareEnv: true };
      continue;
    }
    break;
  }
  return { rest: t.slice(i), bareEnv: false };
}

function gitPush(t: string[], cwd: string, branchOf: BranchOf): string | null {
  let i = 1, dir = cwd;
  while (t[i]?.startsWith("-")) {
    if (t[i] === "-C") dir = resolve(dir, t[i + 1] ?? ".");
    i += t[i] === "-C" || t[i] === "-c" ? 2 : 1;
  }
  if (t[i] !== "push") return null;
  const pos: string[] = [];
  for (let j = i + 1; j < t.length; j++) {
    const a = t[j]!;
    if (a === "--force" || /^-[a-z]*f[a-z]*$/.test(a)) return "force push (use --force-with-lease on your own branch)";
    if (["--tags", "--follow-tags", "--mirror", "--all"].includes(a)) return `push ${a}`;
    if (a === "-o" || a === "--push-option" || a === "--repo" || a === "--receive-pack") { j++; continue; }
    if (!a.startsWith("-")) pos.push(a);
  }
  const refs = pos.slice(1);
  const current = () => branchOf(dir);
  if (!refs.length) return MAIN.has(current() ?? "") ? "push from main" : null;
  for (const r of refs) {
    if (r === "tag" || r.includes("refs/tags/")) return "push a tag";
    if (r.startsWith("+")) return "force push (+refspec)";
    const dst = (r.includes(":") ? r.slice(r.indexOf(":") + 1) : r).replace(/^refs\/heads\//, "");
    if (MAIN.has(dst) || (dst === "HEAD" && MAIN.has(current() ?? ""))) return "push to main";
  }
  return null;
}

function checkBash(cmd: string, cwd: string, branchOf: BranchOf): string | null {
  for (const seg of segments(cmd)) {
    const { rest: t, bareEnv } = strip(seg);
    if (bareEnv) return "print the environment (env)";
    const [c, a1, a2] = t;
    if (!c) continue;
    if (c === "printenv") return "print the environment (printenv)";
    if (c === "export" && (!a1 || a1 === "-p")) return "print the environment (export)";
    if (c === "op") return "1Password CLI: deploy secrets resolve through varlock, not agents";
    if (c === "gh" && a1 === "auth" && a2 === "token") return "print the GitHub token";
    if (c === "wrangler" && a1 === "secret") return "wrangler secret";
    if (c === "git") { const why = gitPush(t, cwd, branchOf); if (why) return why; }
    // A reader's file arguments, and any `< file` redirect.
    const inputs = t.slice(1).filter((x, k) => READERS.has(c) || x.startsWith("<") || t[k] === "<").map((x) => x.replace(/^<+/, ""));
    const f = inputs.find((x) => x && !x.startsWith("-") && secretPath(x, cwd));
    if (f) return `read ${f}`;
  }
  return null;
}

const gitBranch: BranchOf = (cwd) => {
  const r = Bun.spawnSync(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { stderr: "ignore" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
};

export function check(input: HookInput, branchOf: BranchOf = gitBranch): string | null {
  const cwd = input.cwd ?? process.cwd();
  const ti = input.tool_input ?? {};
  if (input.tool_name === "Bash") return checkBash(String(ti.command ?? ""), cwd, branchOf);
  const p = ti.file_path ?? ti.path;
  if ((input.tool_name === "Read" || input.tool_name === "Grep") && typeof p === "string" && secretPath(p, cwd)) return `read ${p}`;
  return null;
}

if (import.meta.main) {
  const why = check(JSON.parse(await Bun.stdin.text()));
  if (why) {
    console.error(`Blocked by .claude/hooks/guard.ts: ${why}. Secrets stay in 1Password and resolve through varlock at deploy; read .env.schema for names. main and tags change through pull requests. See AGENTS.md "Secrets and pushes".`);
    process.exit(2);
  }
}
