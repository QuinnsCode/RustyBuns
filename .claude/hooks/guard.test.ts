import { expect, test } from "bun:test";
import { check } from "./guard";

const cwd = "/repo";
const bash = (command: string, branch = "feature") => check({ tool_name: "Bash", tool_input: { command }, cwd }, () => branch);
const read = (file_path: string) => check({ tool_name: "Read", tool_input: { file_path }, cwd });

test("blocks reading secret files, not their schema", () => {
  for (const p of [".env", "apps/x/.env.local", "/a/.dev.vars", "apps/x/.alchemy/state/prod/w.json", "~/agent-office/.agent-office/office.json", "/repo/.agent-office/tokens.json"])
    expect(read(p)).not.toBeNull();
  for (const p of ["apps/codesplitters/.env.schema", ".env.example", "README.md", "/repo/.agent-office/worktrees/b/package.json"])
    expect(read(p)).toBeNull();
  expect(check({ tool_name: "Grep", tool_input: { pattern: "x", path: "apps/a/.dev.vars" }, cwd })).not.toBeNull();
});

test("blocks secret reads and env dumps inside shell commands", () => {
  for (const c of ["cat .env", "cd apps/a && head -n 3 .env.production", "bun x.ts < .dev.vars", "source apps/a/.env",
    "env", "env | grep KEY", "FOO=1 env -0", "printenv", "echo $(printenv TOKEN)", "cat /proc/self/environ", "export -p",
    "op read op://vault/item", "ls && op item get x", "gh auth token", "bunx wrangler secret put X"])
    expect(bash(c)).not.toBeNull();
  for (const c of ["env FOO=1 bun test", "cat apps/codesplitters/.env.schema", "echo .env >> .gitignore", "export FOO=1", "gh pr view", "bun test"])
    expect(bash(c)).toBeNull();
});

test("blocks pushes to main, tags and plain force", () => {
  for (const c of ["git push origin main", "git push origin HEAD:main", "git push origin feat:refs/heads/main", "git -C ../x push origin main",
    "git push --tags", "git push origin v1.2.3:refs/tags/v1.2.3", "git push origin tag v1", "git push --force origin feat",
    "git push -f", "git push origin +feat", "git push origin :main"])
    expect(bash(c)).not.toBeNull();
  expect(bash("git push", "main")).not.toBeNull();
  expect(bash("git push origin HEAD", "main")).not.toBeNull();
  for (const c of ["git push", "git push -u origin feat", "git push --force-with-lease origin feat", "git push origin HEAD", "git status"])
    expect(bash(c)).toBeNull();
});
