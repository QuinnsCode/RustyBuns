---
name: rebuild-pr
description: Bring an open PR up to date with main by merging main into its branch and resolving the conflicts. Use for "rebuild #N on main", "PR #N conflicts with main", "resolve #N's conflicts", or when main moved under an open PR.
---

# Rebuild a PR on main

1. **Still open?** `gh pr view N --json state,headRefName`. Stop unless `OPEN`. If it waits on another
   PR merging, poll that one every 2–3 minutes, no faster: the GitHub API budget is shared.
2. **Check out.** `gh pr checkout N`. If the branch is checked out in another worktree:
   `git fetch origin <branch> && git checkout --detach FETCH_HEAD`, and later push to `HEAD:<branch>`.
3. **Merge main.** `git fetch origin main && git merge origin/main`. Merge, never rebase. No force push.
4. **Resolve so both sides survive.** Read the PR (`gh pr view N`, `gh pr diff N`) and the main commits
   that touched each conflicted file (`git log -p HEAD...origin/main -- <file>`).
   - Generated files get regenerated, not hand-merged. apps/codesplitter/REFERENCE.md's Layout table:
     take either side, then `cd apps/codesplitter && bun run layout`.
   - Registries stay one item per line, both items kept.
   - Numbered migrations: renumber the PR's to the next free number.
   - JSON stays valid.
5. **Check, narrowly.** Only the touched apps' tests (`cd apps/<app> && bun test test/<file>.test.ts`),
   `bun run docs --check`, and `bun scripts/conflict-markers.ts`. Not the whole suite.
6. **Ship.** Commit the merge, `git push` (or `git push origin HEAD:<branch>` from a detached HEAD), then
   `gh pr checks N --watch` until green. Fix a red check and rerun just its test. Don't merge; the owner does.
7. **Report**, caveman-terse:

   ```
   DONE  merged main into #N, 3 conflicts, CI green
   NEXT  owner merges
   BROKE nothing
   DONT  rebase, force push, merge
   ```
