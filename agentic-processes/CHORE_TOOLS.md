# Chore tools: one call, not a loop

Agents burn context on chores they do by hand: `gh pr checks` in a `sleep` loop, `gh run view --log-failed | grep`,
paging a 2,000-line file with `sed -n`. Each tool below turns one of those chores into one command that prints a short
answer sized for a context window. Find your own chores by reading session transcripts for repeated command
shapes (RustyBuns' reader for that is called Dexter), then build the tool for the biggest ones.

Each entry is a spec, so another repo can build it in any language. The links go to the RustyBuns
versions (Bun + TypeScript, each with tests).

| Tool | Replaces | Contract |
| --- | --- | --- |
| **PR checks** ([pr.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/pr.ts)) | `gh pr checks` + `sleep`, log grepping | `pr <n>` waits for checks and prints one line per outcome (pass, fail, skip) plus the tail of a failed step's log. `--no-wait` for now, `--minutes N` to cap the wait. Spots a push GitHub never attached a run to. |
| **Issue brief** ([issue.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/issue.ts)) | `gh issue view` + `gh pr list` | `issue <n> [n...]` prints the header, the PRs that close it, the body cut at a paragraph and the last three comments. `--full` for all of it. |
| **Outline** ([outline.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/outline.ts)) | paging a file | `outline <file>` lists symbols with line ranges and their first doc line. `outline <file> <name>` prints one symbol's source. `--api <package>` lists a package's exports as one-line signatures. |
| **Script help** ([help.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/help.ts)) | reading a script's source to learn its flags | Every script answers `--help` by printing its own top comment, so the comment is the manual. |
| **Test bites** ([test-bites.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/test-bites.ts)) | trusting that a new test tests the fix | Runs your changed test files against `origin/main`'s source and names the ones that pass there anyway. `--lines` lists changed lines no test ran. |
| **Preflight** ([preflight.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/preflight.ts)) | finding out about a collision at merge time | Before opening a PR, lists the open PRs that change the same files, so you can merge after them or ask their author. |
| **Conflict markers** ([conflict-markers.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/conflict-markers.ts)) | a bad merge slipping through | Fails CI when a tracked file still holds `<<<<<<<`, `=======` or `>>>>>>>` (skipping fenced code in markdown). Has an allow-list for files about merging. |
| **Migration numbers** ([migration-numbers.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/migration-numbers.ts)) | two PRs each taking the next migration number | Fails CI on two migrations with the same number in one folder. New migrations are named by timestamp, so they never clash. |
| **Boundary audit** ([boundary-audit.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/boundary-audit.ts)) | unchecked `as` casts creeping in | Counts unchecked values (casts, `any`) per file against an allowance file. Fails on a new one, and on a file that improved without lowering its count, so the allowance only goes down. |
| **Docs check** ([docs.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/docs.ts)) | stale tables, dead links | Rewrites the generated parts of the docs and checks every relative link and `#anchor`. CI runs `--check`. |
| **Manual runs** ([manual-runs.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/manual-runs.ts)) | the owner hunting for what to check | Starts each app on a free port, opens each `MANUAL RUN:` issue's jump-to-state links, and turns Yes or No into a comment (Yes also closes it). |
| **Climbs** ([climbs.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/climbs.ts)) | climbs going idle and getting lost | Lists open hill climbs with their last score, target and days idle. `--next` hands the next round, with its baton prompt, to a free worker. |
| **Probe** ([probe.ts](https://github.com/QuinnsCode/RustyBuns/blob/main/scripts/probe.ts)) | browser tabs + screenshots to read app state | Loads a page in headless Chrome and prints `window.<handle>.state()` as JSON plus any errors. Each app exposes a `state()` handle so agents ask instead of screenshotting. |

## Rules for writing one

- Output is for a context window: one line per fact, cut long text at a paragraph, name the next command on a failure.
- A failure prints the fix ("rebase onto origin/main and push with lease"), not just the error.
- It wraps a CLI the harness already has (`gh`, `git`), so it works under any agent tool.
- The top comment is the `--help` text. Write it for the next agent.
- Add a line for it to the repo's `AGENTS.md` so agents know it exists.
