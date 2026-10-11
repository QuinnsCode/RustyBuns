// PreToolUse hook (wired in .claude/settings.json): stops an agent reading secrets, printing the
// environment, pushing to main or tags, deleting shared branches and worktrees, or changing the repo's
// rulesets, secrets and release workflows through gh. The deny-list there matches command prefixes; this catches
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
  if (t.slice(i + 1).some((a) => a === "--delete" || a === "-d")) return "delete a remote branch";
  for (const r of refs) {
    if (r === "tag" || r.includes("refs/tags/")) return "push a tag";
    if (r.startsWith(":")) return "delete a remote branch";
    if (r.startsWith("+")) return "force push (+refspec)";
    const dst = (r.includes(":") ? r.slice(r.indexOf(":") + 1) : r).replace(/^refs\/heads\//, "");
    if (MAIN.has(dst) || (dst === "HEAD" && MAIN.has(current() ?? ""))) return "push to main";
  }
  return null;
}

// Every worktree shares one .git, so these reach other agents' work, or the hooks that run for them.
function gitShared(t: string[]): string | null {
  let i = 1;
  while (t[i]?.startsWith("-")) i += t[i] === "-C" || t[i] === "-c" ? 2 : 1;
  const [sub, a] = [t[i], t[i + 1]];
  if (sub === "worktree" && (a === "remove" || a === "prune")) return `git worktree ${a} (the office sends workers home)`;
  if (sub === "branch" && t.slice(i + 1).some((x) => x === "-D" || (x === "--force" && t.includes("--delete"))))
    return "force-delete a branch (git branch -d deletes a merged one)";
  if (t.some((x) => /^core\.hookspath/i.test(x))) return "change the shared git hooks";
  return null;
}

// gh calls that change who can merge, what gates a merge, or where secrets go. The owner makes these.
const GH_ADMIN = /\/(rulesets|protection|environments|secrets|variables|collaborators|hooks|keys)(\/|$)|^repos\/[^/]+\/[^/]+$/;
function ghAdmin(t: string[]): string | null {
  const [, a1, a2] = t;
  if (a1 === "pr" && a2 === "merge" && t.includes("--admin")) return "gh pr merge --admin";
  if ((a1 === "secret" || a1 === "variable" || a1 === "ruleset") && a2 !== "list" && a2 !== "view" && a2 !== "check")
    return `gh ${a1} ${a2 ?? ""}`.trim();
  if (a1 === "repo" && (a2 === "edit" || a2 === "delete" || a2 === "rename" || a2 === "archive")) return `gh repo ${a2}`;
  if (a1 === "release" && a2 !== "list" && a2 !== "view" && a2 !== "download") return `gh release ${a2 ?? ""}`.trim();
  if (a1 === "workflow" && (a2 === "disable" || (a2 === "run" && t.some((x) => /desktop-drop|npm-publish/.test(x)))))
    return `gh workflow ${a2} of a release workflow`;
  if (a1 === "api") {
    const path = t.slice(2).find((x) => !x.startsWith("-") && /\//.test(x))?.replace(/^\//, "").replace(/\?.*/, "") ?? "";
    const m = t.findIndex((x) => x === "-X" || x === "--method");
    const method = (m >= 0 ? t[m + 1] : t.find((x) => /^(-X|--method=)\w+/.test(x))?.replace(/^(-X|--method=)/, "")) ?? "";
    const writes = (method && method.toUpperCase() !== "GET") || t.some((x) => /^(-f|-F|--field|--raw-field|--input)/.test(x));
    if (writes && GH_ADMIN.test(path)) return `gh api write to ${path}`;
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
    // BSD-style `ps e` and macOS `ps -E` print each process's env, other workers' AGENT_OFFICE_HOOK_TOKEN among it (#642)
    if (c === "ps" && ((a1 && /^[a-z]*e[a-z]*$/i.test(a1)) || t.some((x) => /^-[a-zA-Z]*E/.test(x))))
      return "print other processes' environment (ps e / ps -E)";
    if (c === "op") return "1Password CLI: deploy secrets resolve through varlock, not agents";
    if (c === "gh" && a1 === "auth" && a2 === "token") return "print the GitHub token";
    if (c === "wrangler" && a1 === "secret") return "wrangler secret";
    if (c === "git") { const why = gitPush(t, cwd, branchOf) ?? gitShared(t); if (why) return why; }
    if (c === "gh") { const why = ghAdmin(t); if (why) return why; }
    if (t.slice(1).some((x) => /\.git\/hooks(\/|$)/.test(x))) return "change the shared git hooks";
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
  if ((input.tool_name === "Write" || input.tool_name === "Edit") && typeof p === "string" && /\/\.git\/(hooks\/|config$)/.test(resolve(cwd, p)))
    return "change the shared git hooks or config";
  return null;
}

if (import.meta.main) {
  const why = check(JSON.parse(await Bun.stdin.text()));
  if (why) {
    console.error(`Blocked by .claude/hooks/guard.ts: ${why}. Secrets stay in 1Password and resolve through varlock at deploy; read .env.schema for names. main, tags, rulesets and release workflows are the owner's. See AGENTS.md "Secrets and pushes".`);
    process.exit(2);
  }
}
