# RustyBuns

## Tests: CI runs the suite, you run the few you need

CI covers every PR. `typecheck.yml` runs `bun run typecheck` repo-wide, and `apps.yml` runs
the tests of each app the PR touched (all apps, plus `bun test packages`, when `packages/` or the
lockfile moved). The per-app commands are in `scripts/ci-apps.ts`.

So locally:

- Run only the test files for the code you changed, e.g. `cd apps/<app> && bun test test/foo.test.ts`.
  Typecheck just the app you touched if you like.
- Don't run `bun test` at the root, every app's suite or `bun run typecheck` "to be safe". Push
  and let CI do that.
- Don't rerun a passing test to double-check, and don't loop on a flaky one. Note it, and file an issue
  if it's real.
- After pushing, check with `gh pr checks <n>` (or `--watch`). If CI fails, fix that failure and
  rerun just its test locally.
- Don't kick off native builds (`build:native`, cargo) or `desktop-drop.yml` unless the change needs it.

## Secrets and pushes

Secret values live in 1Password and resolve through varlock at deploy time, behind the owner's
Touch ID. Agents never fetch them:

- Read `.env.schema` for the variable names. Don't read `.env`, `.env.*` (other than `.env.schema`
  and `.env.example`), `.dev.vars*`, `.alchemy/state/`, or Agent Office's own `.agent-office/*.json`.
- Don't print the environment (`env`, `printenv`, `export -p`, `/proc/*/environ`), and don't run
  `op`, `gh auth token` or `wrangler secret`. If a deploy needs a secret, say so and let the owner run it.
- Never push to `main` or push tags; those change through pull requests. On your own branch use
  `--force-with-lease`, never `--force`.

Claude Code enforces this with `.claude/settings.json` (a deny-list) and `.claude/hooks/guard.ts`
(a PreToolUse hook, tested by `bun test ./.claude/hooks`). On other harnesses, follow these rules
yourself. The hook is a speed bump, not a sandbox: it parses shell roughly, so a heredoc that just
mentions one of these commands can trip it (write such text with your editor tool). The GitHub
ruleset on `main` is what actually stops a push.
