# codeSplitter catch-up, 2026-11-08 to 2026-11-20

> **Snapshot of 2026-11-20 (main at fa0373993), not current.** Check an issue's newest state before acting on its row.

This closes the catch-up log, #3922. The log has a line for each PR up to #4074 (2026-11-09). After that the PRs
kept landing but nobody wrote them on the log, so the owner asked: "check all codesplitter PRs we might have merged a
lot since two weeks ago". This page lists every merged PR that changed `apps/codesplitter` since the log began, and says
what is still open from the log's table. Manual runs stay with the owner (`bun run manual`), so they aren't listed here.

How it was checked: `git log origin/main --since=2026-11-06 -- apps/codesplitter` (92 commits), then the state of
each issue that the log, or one of those PRs, names.

## The log's table, where each row ended up

| Issue | What | Now |
|---|---|---|
| #3807 | delete the finished resource-move code | closed by #3925 |
| #3804 | named errors per endpoint | closed: #3933, the route-file PRs of #3940 (ending #4026), then #4038, #4042, #4047 |
| #3793 | keys people can rebind | closed by #3928 |
| #3737 | run cards take pushed run states | closed by #3926; the owner's look is MANUAL RUN #3927 |
| #3649 | deploy-check journey on seven framework examples | closed by #4808 (2026-11-16), after the owner first said to skip it |
| #3529 | landing: Ester and Dexter claims | closed by #3924 and #4184 |
| #3392 | private @rustybuns packages outside the monorepo | **open**: #3938, #3949 and #4059 make all 12 packages publishable. Left: the owner's npm step, MANUAL RUN #4058, and part 2, the folder-mirror deploy check |
| #3313 | pipeline hooks and lanes | closed: #3329, #3943, #3974, #3983, #3988, plus #4001 (the AI passes run off the request) |
| #3423 | Agent Office inside codeSplitter | **open**: slices 1 to 3 merged (#4061, #4074, #4069). The owner looks at #4062 before slices 4 to 7. #4072 (hire through POST) waits for that |
| #3923 | Ester's triage, opt-in Dexter | closed: #4060, #4065, #4067, #4070 |
| #2954 | GitHub as a mirror that can be down | **open, backburner**: slice 1 merged (#3939); steps 2 to 4 parked by the owner |
| #1141 | shadow --check over every git-only merge | **open, but done**: the full run (MANUAL RUN #3946, closed) found one real fail, #4133, and a blind spot, #4134. #4139 fixed #4133 and #4182 fixed #4134. Both are closed, so nothing is left on #1141 |
| #3102 | Blender in the container | **open, backburner**: priced, then parked. The owner wants renders on Bob instead |
| #840, #823 | the live-data move | **open**: they wait for the owner's MANUAL RUN #2580 |
| #740 | custom domain | **open, backburner**: codeSplitter stays on workers.dev |
| #1343, #3185 | avatar parts, UI kit mockups | **open, backburner**: taste, after functionality |

## What landed after the log stopped (2026-11-09 to 2026-11-20)

Each line says what changed for a person, then the PR and the issue it closed.

**Merges and mirrors**
- An edit both sides made to the same lines now reaches the lines each side added: #4139 (#4133).
- A new line that copies a line the other side rewrote now makes a card instead of merging quietly: #4185 (#4138).
- `shadow --check` gives `unclear`, not `fail`, for a merge commit that carried new work: #4182 (#4134). A conflicted binary file comes from what landed, byte for byte: #4132.
- Mirrors no longer lose work on a push, a folder send or an empty commit: #4775 (#4333). A fork's commits from before it became a mirror go up under this machine's git identity: #4823 (#4771).
- Merge cards: moved blocks, a way out of the lint, word blends, and Mergiraf's answer is kept: #4824 (#4772).
- Lines and picks: a granted waiter takes its lines by id, a pick lands beside a changed neighbour, a private-line revert reads the crew's copy, and runs that go over budget are noted: #4825 (#4773).
- Git: notes without a run, line endings kept, no forced pushes to the desktop remote, no leftover staging commit: #4833.

**Audits and security**
- Security round 13: report query strings and issue links, and the crew's fit verdict: #4188 (part of #3725, which stays open for the rest).
- The 2026-11-12 audit: private lines stay the crew's through cuts, moves and config (#4349); docs say what the code does (#4351, #4346); six fixes (#4354); round 14's security fixes (#4357, #4366, #4347); checks, the doctor, limits and API edges (#4777, #4334).
- Scripts: `--help` answers before any work, demos move off a taken port: #4763 (#4335).

**Run cards, release, copy**
- Run cards read once when a run starts or ends: #4128 (part of MANUAL RUN #3927).
- A failed release deploy says so and names a rate limit; a stray key no longer answers the y/N: #4073.
- Mirrors are called desktop-only, and the rename line says what `followRenames` does: #4184 (#3529).
- The desktop deploy journey runs on the examples a change touches: #4808 (#3649).
- The thread file test waits for the file in the agent's folder: #4124 (#3986).

**Guards and cuts** (no change a person sees)
- Replies read through guards, not `Record<string, unknown>`: CUTMAN rounds 6, 7, 14 to 18 (#4190, #4192, #4230, #4258, #4263, #4271, #4750), #4744 (#4581), #4868 (#4743).
- Shared helpers in place of local copies: #4742 (#4559), #4558 (util's three sides), #4594 (one list of ports).
- A cut of 31 tests: #5335 (#4734).

**Tests that bite and code mode**
- Property, contract and replay tests: #5358 (#5333), #5462 (#5356), #5475 (#5461). The real-CLI cassette is MANUAL RUN #5357.
- Code mode makes charts from a program with mpl and saves them to R2: #5455 (#5402).

**Outside codeSplitter, touching its folder**: #4100, #4102, #4105, #4106, #4127, #4153, #4678, #4820 (New game on the Studio tab), #4990 (office leftovers).

## Still open after this round

Not manual runs, so a worker could pick them up:

| Issue | What | State |
|---|---|---|
| #1141 | shadow --check full run | done (see above). Ready to close once the owner agrees |
| #3392 | private packages outside the monorepo | part 2, the folder-mirror deploy check, deploys to the account, so the owner says when |
| #3423 | Agent Office in codeSplitter | waits on the owner's look at #4062 |
| #4072 | hire a desk run through POST | waits on #3423's next pick |
| #3725 | security round 13 leftovers | open for the next security round |
| #4002 | the AI passes as `agent_runs` rows | future idea |
| #4800 | read `@alchemy.run/git` beside the merge code | future idea |
| #3944, #4762, #5482 | flaky tests seen once (demo caption, sealed-before-rename, wrecking-room budget) | filed; no fix yet |
| #2954, #3102, #740, #1343, #3185 | parked by the owner | backburner |
| #840, #823 | the live-data move | wait on MANUAL RUN #2580 |
