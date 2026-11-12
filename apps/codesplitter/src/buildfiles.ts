// Files that run at build or deploy time. Branches come from crew and agents
// (and an agent can be prompt-injected), and the owner's commit after a merge
// can ship with this machine's real logins (deploy.ts), so a branch review
// calls these out, line by line, and a merge that would deploy waits for the
// owner to say they've read them.

import { isLockfile } from "./lockfiles.ts";
import type { Doc, Op } from "./lines.ts";

// Matched against the lowercased name: a case-insensitive disk (macOS, Windows) runs `Package.json` and `DOCKERFILE` too.
const JS = String.raw`\.[cm]?[jt]s`;
const NAMES = [
  /^package\.json5?$/, /^package\.ya?ml$/,
  new RegExp(`^rustybuns\\.config${JS}$`), /^wrangler\.(toml|json|jsonc)$/, new RegExp(`^alchemy\\.run${JS}$`),
  /^(dockerfile|containerfile)(\..+)?$/, /\.(dockerfile|containerfile)$/, /^(docker-)?compose(\..+)?\.ya?ml$/, /^\.dockerignore$/,
  new RegExp(`^(build|vite\\.config|(pre|post)?install|prepare|prepack|postpack|prepublish(only)?)${JS}$`),
  // Package managers' own settings and hooks: registries, workspaces, plugins and code run on every install.
  /^\.npmrc$/, /^\.yarnrc(\.ya?ml)?$/, /^\.pnpmfile\.c?js$/, /^pnpm-workspace\.ya?ml$/, /^bunfig\.toml$/, /^\.bunfig\.toml$/,
  /^(gnu)?makefile$/, /\.mk$/, /^justfile$/, /^taskfile\.ya?ml$/, /^rakefile$/,
  // Other CI systems and hosts that build on push.
  /^\.gitlab-ci\.ya?ml$/, /^\.travis\.ya?ml$/, /^azure-pipelines\.ya?ml$/, /^jenkinsfile$/, /^\.drone\.ya?ml$/,
  /^\.woodpecker\.ya?ml$/, /^bitbucket-pipelines\.ya?ml$/, /^\.?appveyor\.ya?ml$/, /^\.cirrus\.ya?ml$/, /^cloudbuild\.ya?ml$/,
  /^buildspec\.ya?ml$/, /^codemagic\.ya?ml$/, /^netlify\.toml$/, /^vercel\.json$/, /^fly\.toml$/, /^render\.ya?ml$/, /^procfile$/,
  // Not run at build time, but they say what runs and how: the checks' commands (checks.ts), and each
  // path's policy (policy.ts), whose `codesplitter-check` and `codesplitter-live` an agent could loosen.
  /^codesplitter\.ci$/, /^\.gitattributes$/, /^codesplitter\.pipeline\.json$/,
];
// A folder at any depth: CI configs, git hooks an install sets up, patches applied to dependencies, and the
// scripts a package.json runs.
const DIRS = [".rustybuns", ".github", ".gitea", ".forgejo", ".circleci", ".buildkite", ".woodpecker", ".semaphore", ".tekton",
  ".husky", ".yarn", ".devcontainer", "patches", ".patches", "scripts"];

/** Does this path run at build or deploy time? */
export function isBuildFile(path: string): boolean {
  const parts = path.toLowerCase().split("/"), name = parts[parts.length - 1]!;
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
