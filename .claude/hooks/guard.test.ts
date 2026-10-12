import { expect, test } from "bun:test";
import { check } from "./guard";

const cwd = "/repo";
const bash = (command: string, branch = "feature") => check({ tool_name: "Bash", tool_input: { command }, cwd }, () => branch);
const read = (file_path: string) => check({ tool_name: "Read", tool_input: { file_path }, cwd });

test("blocks reading secret files, not their schema", () => {
  for (const p of [".env", "apps/x/.env.local", "/a/.dev.vars", "apps/x/.alchemy/state/prod/w.json", "~/agent-office/.agent-office/office.json", "/repo/.agent-office/tokens.json"])
    expect(read(p)).not.toBeNull();
  for (const p of ["apps/codesplitter/.env.schema", ".env.example", "README.md", "/repo/.agent-office/worktrees/b/package.json"])
    expect(read(p)).toBeNull();
  expect(check({ tool_name: "Grep", tool_input: { pattern: "x", path: "apps/a/.dev.vars" }, cwd })).not.toBeNull();
});

test("blocks secret reads and env dumps inside shell commands", () => {
  for (const c of ["cat .env", "cd apps/a && head -n 3 .env.production", "bun x.ts < .dev.vars", "source apps/a/.env",
    "env", "env | grep KEY", "FOO=1 env -0", "printenv", "echo $(printenv TOKEN)", "cat /proc/self/environ", "export -p",
    "op read op://vault/item", "ls && op item get x", "gh auth token", "bunx wrangler secret put X",
    "ps eww", "ps auxe", "ps -E -p 123", "ps -axE"])
    expect(bash(c)).not.toBeNull();
  for (const c of ["env FOO=1 bun test", "cat apps/codesplitter/.env.schema", "echo .env >> .gitignore", "export FOO=1", "gh pr view", "bun test",
    "ps aux", "ps -ef", "ps -e -o pid,user", "ps -p 123 -o command"])
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

test("blocks deleting shared branches and worktrees, and changing git hooks", () => {
  for (const c of ["git push origin --delete feat", "git push -d origin feat", "git push origin :other", "git branch -D other",
    "git branch --delete --force other", "git worktree remove ../x", "git worktree prune", "git config core.hooksPath /tmp/h",
    "cp evil .git/hooks/pre-commit"])
    expect(bash(c)).not.toBeNull();
  for (const c of ["git branch -d merged", "git branch", "git worktree list", "git config user.name"])
    expect(bash(c)).toBeNull();
  const write = (file_path: string) => check({ tool_name: "Write", tool_input: { file_path, content: "" }, cwd });
  expect(write("/repo/.git/hooks/pre-push")).not.toBeNull();
  expect(write("/repo/.git/config")).not.toBeNull();
  expect(write("/repo/src/git/config.ts")).toBeNull();
});

test("blocks gh calls that change merge gates, secrets or releases", () => {
  for (const c of ["gh pr merge 12 --admin", "gh api -X DELETE repos/o/r/rulesets/1", "gh api --method PUT /repos/o/r/branches/main/protection",
    "gh api repos/o/r/environments/drops -X PUT", "gh api repos/o/r -f visibility=private", "gh api -XPATCH repos/o/r",
    "gh secret set X", "gh variable delete X", "gh ruleset create", "gh repo edit --visibility private", "gh repo delete o/r",
    "gh release create v1", "gh workflow run desktop-drop.yml --ref feat", "gh workflow run npm-publish.yml", "gh workflow disable apps.yml"])
    expect(bash(c)).not.toBeNull();
  for (const c of ["gh pr merge 12 --auto --squash", "gh api repos/o/r/rulesets", "gh api repos/o/r/pulls/3/comments -f body=hi",
    "gh secret list", "gh ruleset view 1", "gh release view v1", "gh workflow run apps.yml", "gh pr checks 3", "gh api repos/o/r"])
    expect(bash(c)).toBeNull();
});
