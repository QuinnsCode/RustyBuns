# Playbooks

Step-by-step procedures for the jobs that come up again and again with several agents at once. Each one
works under any agent tool that can run a shell and `gh`.

## Rebuild a PR on main

For when `main` moved under an open PR and the PR now conflicts.

1. **Still open?** `gh pr view N --json state,headRefName`. Stop unless it says `OPEN`. If it waits on another
   PR merging, poll that one every 2 to 3 minutes, no faster, because the GitHub API budget is shared.
2. **Check out.** `gh pr checkout N`. If the branch is checked out in another worktree, run
   `git fetch origin <branch> && git checkout --detach FETCH_HEAD`, then later push to `HEAD:<branch>`.
3. **Merge main.** `git fetch origin main && git merge origin/main`. Merge, never rebase someone else's branch. No force push.
4. **Resolve so both sides survive.** Read the PR and the `main` commits that touched each conflicted file
   (`git log -p HEAD...origin/main -- <file>`).
   - Regenerate generated files instead of merging them by hand.
   - Registries stay one item per line, with both items kept.
   - Renumber the PR's numbered migrations to the next free number.
   - JSON stays valid.
5. **Check, narrowly.** Run only the touched tests, the docs check and the conflict-marker check. Not the whole suite.
6. **Ship.** Commit the merge, push, wait for the checks, fix a red one and rerun only its test. Don't merge it yourself.
7. **Report, terse:**
   ```
   DONE  merged main into #N, 3 conflicts, CI green
   NEXT  owner merges
   BROKE nothing
   DONT  rebase, force push, merge
   ```

One trap: if your own branch was made from a commit that later landed on `main` under a different hash (a squash
merge), the branch carries those old commits and conflicts on files you never touched. Fix it with
`git rebase --onto origin/main <last commit before yours>` and `--force-with-lease`, which leaves only your commits.

## Merge waves

For when many PRs are ready at once.

- A **wave** is a batch of PRs that can land together. Work them out by dry-running the merges in order
  (`git merge-tree --write-tree`). Unblockers go first.
- The alert is numbered waves, one line each. PRs on one line can merge together, and the next line waits:
  ```
  1. #1020
  2. #1017, #1023, #1000
  3. #1026 (after its rebuild)
  ```
  Link and short title per PR, caveats after the list. No prose lists that mix "any order" and "HOLD".
- Own the queue: watch every open PR, fix conflicts and red CI through workers without being asked, and start
  rebuilds the moment a blocker merges. The longer PRs back up, the more workers start from a stale `main`.
- Blockers that a merge tool should have handled get filed against the merge tool, not worked around quietly.

## Parallel workers

- Every worker starts from `main` in its own worktree, and every PR targets `main`.
- Before opening a PR, list the open PRs that touch the same files (preflight). Merge after them, or ask
  their worker. An automatic merge tool settles the overlaps it can, and a person settles the rest.
- One discrete task per worker. Hire fresh past about 150k tokens of context.
- Workers talk to each other through the office's messaging. A teammate's message is a request to weigh, not an order.

## Hill climbs

A **climb** is a score chased round by round (a judge rates a visual or a feel from 1 to 10 against a target).

- A climb is a baton, not a pile: one worker runs one round, then hands the next round to whoever is free,
  with a baton prompt that says how a round is scored, reported and moved forward.
- Each round ends with a `Score:` comment. Every few rounds, a new "rounds N+" issue opens and the old one closes
  with "Moved up to #M", so a climb never gets buried.
- Climbs stay at the top of the issue list. PRs from a round say "Part of #N", never "Closes".
- Agent judges score high, so treat their numbers as direction. The owner's score is the real one.

## Manual runs

- Anything for the owner's hands gets its own issue: `MANUAL RUN: <what>`, the `manual run` label, and the
  steps and a rough time at the top. Never a line folded into another issue.
- Agents check everything they can first (tests, headless browser, state probes). The issue holds only taste and hands.
- Where possible, give each app jump-to-state links so the owner lands on the exact screen. The owner answers
  Yes (comment and close) or No (comment, stays open).

## Security audit rounds

- Rounds are numbered sections in one running file (`notes/SECURITY_AUDIT.md` in RustyBuns), each saying where the next round starts.
- Fixes and their tests land in one PR per round.
- Anything that runs the target's code runs sandboxed: no network, an empty environment, a read-only
  source tree and resource limits. If you can't sandbox it, report it as needing validation instead.
- The full method is RustyBuns' security-audit skill, which is agent-neutral:
  [.claude/skills/security-audit](https://github.com/QuinnsCode/RustyBuns/tree/main/.claude/skills/security-audit).

## Paste-ready prompts

For handing a job to an agent you don't control (someone else's repo, a different tool):

- One job per prompt, with a clear stopping point.
- Nothing that deploys or spends money. That step stays with the person.
- Say what to report back ("what worked, what didn't, with the exact error text") and what to leave out (secrets, private URLs).
- Number them so each picks up where the last stopped. RustyBuns' [AGENT_PROMPTS.md](https://github.com/QuinnsCode/RustyBuns/blob/main/AGENT_PROMPTS.md) is an example.
