# codeSplitter test audit (2026-10-14)

> **Snapshot, not current:** the test and file counts below (1128 tests in 114 files) are from when it was written. `apps/codesplitter/test` now has 141 test files; rerun the suite for current numbers (#2979).

Question: codeSplitter boots itself in-process (`local()`: real git, D1, DOs, queues) and drives its own API. What tests can that replace?

## What the suite is

1128 tests in 114 files, 115 s wall with `bun test --parallel test` (about 6 CPU-minutes). Of 114 files, 65 boot the whole app through `local()` and speak HTTP to it. That is already the end-to-end shape the repo asks for, so the suite is not unit-test bloat. The pure-unit files (gitpath, release, mervin-board, sync, review, needs, blast, layout, ...) test parsers, merge edge cases and limits, which AGENTS.md keeps units for.

Per-file line coverage (each file run alone, `--coverage-reporter=lcov`, lines nobody else covers):

- 0 unique lines: bodies, data-guards, doc-store, timing, row-times, api, git-state, usage, journey, client, build, sync, review, blast, needs, layout, lockfiles, mervin-corpus. Every line they run is run by another file too. That is not the same as every assertion being duplicated, so none was deleted on this evidence alone. Each is small and states one rule.
- The cost is elsewhere: five `mirror*` files and `deploy-hosted`, `agent`, `sandbox`, `deps` are the slow ones (a single mirror test takes 7 to 16 s of real git). They carry per-issue regression cases (#464, #773, #1162, #1226, ...) with unique lines, so they are the opposite of redundant.

## Cut in this PR

- 39 files re-declared the same `opened` list, `afterAll` close loop and `setDefaultTimeout(20_000)` that `test/app-kit.ts` already provides. They import `local` from the kit now: 78 lines added, 290 deleted, same 345 tests passing.
- `client.test.ts`: dropped "play.html reads ?mode=wreck and ?room=", which only asserted source text (AGENTS.md rule). The link builder stays tested by evaluating it out of the page.

## Candidates, not cut (owner's call)

| Candidate | Why it might go | Why it stays for now |
|---|---|---|
| `api.test.ts` first three tests (scan `src/*.ts` comments and `client.html` for routes) | They read source text | They are a drift guard for the API reference; `tokens.test.ts` repeats the palette scan for the MCP spec, so one of the two could go |
| `features.test.ts` last test, `client.test.ts` "Getting started names a real tour step" | Source-text cross-references | They stop a silent dead link; a browser run (phone-smoke) would replace both |
| `timing`, `row-times`, `git-state`, `bodies`, `data-guards` as separate files | Each boots its own app for one rule | Fold into `journey.test.ts`'s single boot; saves about 1 s of boot each, loses parallelism |
| `scripts/demo-check.ts` vs the journey tests | Walks the same beats against `local()` | It is also the live-URL check, so keep and have it import the journey's steps |

## The bigger idea: self-test as the e2e

A `bun scripts/selftest.ts` that starts the built worker/CLI as a real process, pushes codeSplitter's own repo into it, and runs `codesplitter` CLI commands against it (the way a user or agent would) would cover what `local()` cannot: the CLI, the MCP server, the install path and the real HTTP socket. Once that exists, `cli.test.ts`, `mcp.test.ts` and the CLI half of `trust.test.ts` could shrink to their parsing corner cases. It is not built here; it needs a decision on what runs it in CI (it adds a process boot per PR).
