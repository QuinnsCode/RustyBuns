# GitHub down: the office keeps working on codeSplitter

Plan for [#2954](https://github.com/QuinnsCode/RustyBuns/issues/2954). Goal: codeSplitter holds the repo the office works
on, GitHub is a mirror that keeps being pushed to and pulled from, and if GitHub is down while the internet is up, workers,
branches, PRs and Mervin merge waves carry on and sync back when GitHub returns. Not about CI or tests. Status: plan only,
nothing built by this page.

## What already exists (so we don't rebuild it)

- A two-way mirror with `primary: here | upstream`, `pullOnly`, and a standing of `ok | down | refused | clash | held |
  rewritten` with `ahead`, `behind` and `downSince` (`GET /api/repos/:o/:r/mirror`, `…/git-state`). `primary: here` makes
  codeSplitter's git the source of truth: syncs push first and GitHub is the backup.
- Hot backup and rollback (#1562), the merge engine and conflict agent, "checks run here while GitHub is down".
- The office's codeSplitter toggle and boards ([DOGFOOD.md](DOGFOOD.md)); hosted workers are the plan in [MOVE.md](MOVE.md).

## Parts, in build order

1. **Canonical here.** Set `primary: here` on the RustyBuns repo (an owner call, so a `MANUAL RUN:` issue). Add one
   "GitHub behind by N commits / down since T" line to the office header, read from the mirror standing, so an outage is
   visible and not a surprise. Smallest first PR.
2. **Workers on codeSplitter.** Stepping stone: one worker clones from and pushes to codeSplitter (the codeSplitter MCP
   server for edits, DOGFOOD.md). Then the hosted workers in MOVE.md. Worktree setup and `gh`-based hooks must stop
   assuming `origin` is GitHub.
3. **PRs and merge waves on codeSplitter.** The office boards read codeSplitter's branch/PR model first and GitHub second;
   Mervin waves and `rebuild-pr` run against codeSplitter. GitHub PRs are mirrored when up. Open question: how a GitHub PR
   opened while up and a codeSplitter PR made while down are matched (by branch name) so none is doubled.
4. **Outage drill.** A script in `scripts/` that blocks github.com (or points the mirror at a dead URL), finishes a PR and a
   merge wave on codeSplitter, restores the link, and asserts the mirror reaches `ok` with every commit present exactly
   once. It is the acceptance test for the issue.

## Decisions for the owner

- Is `primary: here` for RustyBuns acceptable while the competition is over (it is), and is the push target still the
  only place `main` may change (PR rule on GitHub vs. codeSplitter's own merge)?
- Order: header line and `primary: here` first, or go straight to hosted workers?

Not closed by this page; the issue stays open until the drill passes.
