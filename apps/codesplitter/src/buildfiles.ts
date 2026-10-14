// Files that run at build or deploy time. Branches come from crew and agents
// (and an agent can be prompt-injected), and the owner's commit after a merge
// can ship with this machine's real logins (deploy.ts), so a branch review
// calls these out, line by line, and a merge that would deploy waits for the
// owner to say they've read them.

import { isLockfile } from "./lockfiles.ts";
import type { Doc, Op } from "./lines.ts";

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
  // Not run at build time, but they say what runs and how: the checks' commands (checks.ts), and each
  // path's policy (policy.ts), whose `codesplitter-check` and `codesplitter-live` an agent could loosen.
  /^codesplitter\.ci$/, /^\.gitattributes$/,
];
const DIRS = [".rustybuns", ".github", ".circleci", ".buildkite"];

/** Does this path run at build or deploy time? */
export function isBuildFile(path: string): boolean {
  const parts = path.split("/"), name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => DIRS.includes(d))) return true;
  return isLockfile(name) || NAMES.some((re) => re.test(name));
}

/** A merge's ops against main as a diff a person reads: `-` what goes, `+` what comes. */
export function changedLines(main: Doc, ops: Op[]): string[] {
  const text = new Map(main.lines.map((l) => [l.id, l.text]));
  return ops.flatMap((op) =>
    op.kind === "insert" ? [`+ ${op.text}`]
    : op.kind === "set" ? [`- ${text.get(op.line) ?? ""}`, `+ ${op.text}`]
    : [`- ${text.get(op.line) ?? ""}`]);
}
