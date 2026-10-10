// Files that run at build or deploy time. Branches come from crew and agents
// (and an agent can be prompt-injected), and the owner's commit after a merge
// can ship with this machine's real logins (deploy.ts), so a branch review
// calls these out, line by line, and a merge that would deploy waits for the
// owner to say they've read them.

import type { Doc, Op } from "./lines.ts";

const LOCKFILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "deno.lock"]);
const NAMES = [
  /^package\.json$/,
  /^rustybuns\.config\.[cm]?[jt]s$/,
  /^wrangler\.(toml|json|jsonc)$/,
  /^alchemy\.run\.[cm]?[jt]s$/,
  /^(Dockerfile|Containerfile)(\..+)?$/, /\.dockerfile$/i, /^(docker-)?compose\.ya?ml$/, /^\.dockerignore$/,
  /^build\.[cm]?[jt]s$/,
  /^vite\.config\.[cm]?[jt]s$/,
  /^\.gitlab-ci\.yml$/, /^\.travis\.yml$/, /^azure-pipelines\.yml$/, /^Jenkinsfile$/,
  /^\.npmrc$/, /^bunfig\.toml$/,
];
const DIRS = [".rustybuns", ".github", ".circleci", ".buildkite"];

/** Does this path run at build or deploy time? */
export function isBuildFile(path: string): boolean {
  const parts = path.split("/"), name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => DIRS.includes(d))) return true;
  return LOCKFILES.has(name) || NAMES.some((re) => re.test(name));
}

/** A merge's ops against main as a diff a person reads: `-` what goes, `+` what comes. */
export function changedLines(main: Doc, ops: Op[]): string[] {
  const text = new Map(main.lines.map((l) => [l.id, l.text]));
  return ops.flatMap((op) =>
    op.kind === "insert" ? [`+ ${op.text}`]
    : op.kind === "set" ? [`- ${text.get(op.line) ?? ""}`, `+ ${op.text}`]
    : [`- ${text.get(op.line) ?? ""}`]);
}
