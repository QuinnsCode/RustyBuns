# Trusting AI-written changes: testing options

> **Dates as written:** the 2026-10-14 submission and 2026-10-21 finalist dates below are past; the competition is over. The "this week" picks are from 2026-10-13 (#2979).

The problem: PRs arrive faster than anyone can read them, and a green check only means the tests that
exist passed. AI-written tests tend to confirm whatever the AI-written code does. So the goal is not
more tests, it is evidence that the tests can fail.

Written 2026-10-13. The codeSplitter submission closes 2026-10-14, so the "this week" picks come first.

## What CI already gives us

- `typecheck.yml`: repo-wide typecheck.
- `apps.yml`: only the touched apps' tests, plus a boot of the dev host for apps with `boot: true`
  (`scripts/ci-apps.ts`), plus the hung-test killer and pass/fail/skip counts (`scripts/ci-test-count.ts`).
- The gap: nothing checks that a PR's new tests fail without the PR's code, that changed lines are covered,
  or that the demo path still works end to end.

## This week (cheap, no new services)

1. **Fail-before / pass-after check.** For a PR that adds or edits `*.test.ts`, run those files against
   `origin/main`'s source. A new test that passes on old code proves nothing. About 30 lines of script:
   `git worktree add` the base, copy the PR's test files over it, run `bun test <files>`, expect failures.
   Biggest trust gain per hour. Run it locally on any PR before reading it.
2. **Changed-lines coverage.** `bun test --coverage --coverage-reporter=lcov` on the touched app, then list
   changed lines with no hits (`git diff -U0` against the lcov). It does not prove correctness, but it finds
   code nobody ran. Report only, do not gate yet.
3. **Demo smoke before the `contest-submission` tag.** The demo must match the video and `main` must keep
   working until 2026-10-21. One script that boots codeSplitter (the existing boot tier) and hits the demo
   path, run by hand before tagging and after each merge on submission day. Freeze other merges meanwhile.
4. **A second reviewer that did not write the code.** `/code-review high` on the diff, from a fresh session
   given the diff and the issue text, not the author's reasoning. Different model if you can. Treat findings
   as leads to check, not verdicts.
5. **Merge in waves, smoke between waves.** Fewer PRs landing at once means a red smoke points at one change.

## Next (a week or two)

- **Property tests with `fast-check`** (works under `bun:test`) for the pure engines: line splitting,
  range parsing, merge and conflict handling in codeSplitter. One property ("split then join returns the
  input") replaces dozens of AI-picked examples, and it finds inputs nobody thought of.
- **Mutation testing on changed files only.** Stryker has no Bun runner; its command runner works but is
  slow, so scope it to the files in the diff. A cheaper hand-rolled version: flip operators in changed
  lines and see whether any test notices. This is the direct answer to "do these tests bite".
- **Contract tests from `apps/codesplitter/src/openapi.ts`.** It already feeds the docs; generate
  request/response checks from it so an endpoint change cannot drift from its spec.
- **Record/replay for model calls.** Cassettes make agent-path tests deterministic and free, so they can
  run on every PR instead of being a manual run.
- **Stricter types as free tests.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, one app at a
  time, plus `knip` for dead exports that AI code tends to leave behind.

## Not worth it now

- Snapshot tests over AI output: they lock in whatever it produced.
- A coverage percentage gate: it rewards tests that call code without asserting anything.
- Playwright suites for every app: pick the one demo path (item 3) and stop.

## Suggested order

Items 1 and 3 today, 2 and 4 as habits, then property tests on the codeSplitter merge engine after the
deadline. Say the word and I will build item 1 as `scripts/test-bites.ts` with its own test.
