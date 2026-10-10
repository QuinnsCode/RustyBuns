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
