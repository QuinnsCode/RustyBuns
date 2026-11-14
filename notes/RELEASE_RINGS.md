# Release rings (proposal)

The picture (the rings and their sweeps, the PR lanes, the express lane, the week simulator):
https://claude.ai/artifact/CLz7Z7hkcQYPVvg11PAsD2, built from [release-rings.html](release-rings.html). Publish that file
to the same URL to update it.

The rings are circles around a cave. Code is born in the tinkers' cave (PR and `main`), leaks out to the tunnels
(hourly), then the nightly market (daily), then the town (stable, everyone). Each ring has its own sweep, wider and
slower the further out.

A PR is a fast feature branch: it proves its feature and squash-merges to `main`. "Safe to ship" moves to three
clocks behind it. Each ring is a ref on `main` that only moves forward; no release branches.

| Ring | When | Runs | Promotes when |
| --- | --- | --- | --- |
| PR | every push | typecheck, touched-app tests, the feature's journey | green; Mervin merges |
| hourly (`ring/hourly`) | :00, only if `main` moved | every app's suite, desktop smoke, codeSplitter whole suite, `bun test packages` | its run is green |
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
5. Trim `apps.yml`: the all-apps sweep on `packages/` moves to hourly, after 1-4 have run clean for a week.
6. `daily-ring.yml` at 10:17 UTC: `rings.ts pick daily` (3 green hourlies in a row), phone smoke at every size, vite builds of changed web apps (no deploys). Bob's natives gate it once he can report back.
7. Stable: Monday pick, release notes from squash titles, one `MANUAL RUN:` taste issue, owner pushes the `v` tag.
   Built: `stable.yml` runs `scripts/stable.ts` (#4494); it picks nothing until the daily ring writes `ring/daily`.

Express lane (#4586): an owner-only `express` label runs every ring's sweep on that commit right away, with no clock and
no soak. Every sweep must still pass and stable still needs the owner's OK. A red sweep drops it into the normal lane at
that ring, where it soaks like any other commit.

Open: whether daily auto-deploys previews, and whether
"Ringo" (moves pointers, writes notes) is its own helper or a job inside Ester.
