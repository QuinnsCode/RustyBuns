# Release rings (proposal)

The picture (the rings, four ring cards, three lane cards, where it stands):
https://claude.ai/artifact/CLz7Z7hkcQYPVvg11PAsD2, built from [release-rings.html](release-rings.html). Publish that file
to the same URL to update it.

How the rings test our agents (recordings on every PR, the real model each night):
https://claude.ai/artifact/1kQXq2dzf3avURzdTGZ5rG, built from [agent-testing.html](agent-testing.html).

The rings are circles around a cave. Code is born in the tinkers' cave (PR and `main`), leaks out to the tunnels
(hourly), then the nightly market (daily), then the town (stable, everyone). Each ring has its own sweep, wider and
slower the further out.

A PR is a fast feature branch: it proves its feature and squash-merges to `main`. "Safe to ship" moves to three
clocks behind it. Each ring is a ref on `main` that only moves forward; no release branches.

| Ring | When | Runs | Promotes when |
| --- | --- | --- | --- |
| PR | every push | typecheck, touched-app tests, the feature's journey | green; Mervin merges |
| hourly (`ring/hourly`) | :00 (GitHub starts it every 5-9 h), and on a push to `main` that moves `packages/` or the lockfile; only if `main` moved | every app's suite, desktop smoke, codeSplitter whole suite, `bun test packages` | its run is green |
| daily (`ring/daily`) | 10:17 | natives on Bob, phone smoke at every size, preview deploys, manual-run pre-checks | newest commit with 3 green hourlies in a row |
| stable (`ring/stable`, `v*`) | Monday after deps-doctor | deps-doctor, TerraViz, framework trials, owner taste walk, npm, desktop drop | newest daily green 3 days running, plus the owner's OK |

On red, `main` never freezes: the ring stops promoting, Ester bisects the squash commits since the last green on Bob
and tells the PR's worker, and Mervin opens a revert of that one commit if no fix lands in 60 minutes.

State: a `ring/<name>` commit status on each SHA, refs moved only by the ring workflows. `bun run rings` prints one
line per ring.

Saved builds (#4497): each hourly smoke row keeps the binary it built as the Actions artifact
`ring-<sha>-<app>-<target>` for 7 days (free on a public repo, no tags or releases). `bun scripts/rings.ts rollback
<ring> <app> <target>` downloads the newest green build older than the ring's current one: a download, not a rebuild.

## Build order (one PR each, off `main`)

1. `desktop-hourly.yml` skips when `main` hasn't moved, sweeps every app, writes `ring/hourly`, moves the ref on green.
2. Owner: let the ring workflows write `refs/ring/*` only (ruleset + `contents: write`).
3. `scripts/rings.ts` and `bun run rings`; Ester's card shows the same lines.
4. Bisect on red (Ester on Bob) and Mervin's 60-minute revert.
   Built: `scripts/ring-red.ts` (#4491), every 10 minutes on the office Mac (`scripts/mac/dev.rustybuns.ring-red.plist`).
   It checks the red SHA fails on Bob too (no blame for a flake or Linux-only red), bisects, tells the PR's worker, and
   marks the blame in a ci-hourly issue comment; 60 minutes on, still red and no commit naming the PR, it opens
   `ring-revert-<sha7>`. Bob runs a commit, not a working tree, through `main(argv, cwd, at)` in `scripts/remote-ci.ts`.
5. Trim `apps.yml`: the all-apps sweep on `packages/` moves to hourly, after 1-4 have run clean for a week.
   Built (#4492): a PR that moves `packages/` or the lockfile runs the packages' tests, the hooks and scripts tests and
   the apps it touched; only a pipeline change (`apps.yml`, `ci-apps.ts`'s machinery) still runs every app.
6. `daily-ring.yml` at 10:17 UTC: `rings.ts pick daily` (3 green hourlies in a row), phone smoke at every size, vite builds of changed web apps (no deploys). Bob's natives gate it once he can report back.
7. Stable: Monday pick, release notes from squash titles, one `MANUAL RUN:` taste issue, owner pushes the `v` tag.
   Built: `stable.yml` runs `scripts/stable.ts` (#4494); it picks nothing until the daily ring writes `ring/daily`.

Express lane (#4586): an owner-only `express` label runs every ring's sweep on that commit right away, with no clock and
no soak. Every sweep must still pass and stable still needs the owner's OK. A red sweep drops it into the normal lane at
that ring, where it soaks like any other commit.
Built: `express.yml` runs on a merged PR (or a manual run with its number). `rings.ts express <pr>` checks the owner
put the label on last (anyone else's is ignored) and gives the squash commit; then it calls `desktop-hourly.yml` and,
on green, `daily-ring.yml` with that SHA. Each writes a pending `ring/<name>` status while it runs (the hourly gate and
the daily pick skip that commit), and `bun run rings` adds an `express <sha7>  <ring> sweep running` line for it.

Lanes (#5429, proposal): three lanes side by side through the same sweeps, only the wait differs. A straight-through
score (0 to 100: what the PR touches, whether its tests fail on the old code, how many changed lines they run, its size,
its app's last 30 days) puts it in the fast lane (60 or more and no CI, deploy or secrets wiring: 1 green hour, 1 green
night, then the OK; a red drops it to standby) or standby (the full soak). Express stays owner-only, for a security
advisory, a hijacked package or Action in the build chain, or a host incident. A red sweep keeps it in express.

Built (fast and standby): `scripts/lane.ts` scores a PR and, in apps.yml's `bites` job, labels it `lane:fast` or
`lane:standby` with one comment giving the reason (test-bites writes its counts with `--facts`). The "last 30 days" part
counts reverts on main touching the PR's apps. `rings.ts pick daily` takes a newer commit after 1 green hourly when it
and every commit above the 3-green pick are `lane:fast`; a red in between holds them all to the normal soak. `bun run
rings` ends with each lane's open PR count. The 1 green night before stable waits for the stable ring itself.

Open: whether daily auto-deploys previews, and whether
"Ringo" (moves pointers, writes notes) is its own helper or a job inside Ester.
