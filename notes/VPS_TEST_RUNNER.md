# A rented test box: what it costs (October 2026)

Follow-up to [local-build-monster.md](local-build-monster.md), which planned around the Macs we
already own. This one prices a rented Linux box, Hetzner first. Prices are from Hetzner's own
pages on 2026-10-24, excl. VAT. Hetzner raised prices on 15 June 2026, so blog posts quoting
AX41 at €39 or CCX13 at €16 are out of date.

## What CI actually spends time on

From the GitHub API, `apps.yml`, 40 runs between 2026-10-23 20:47 and 2026-10-25 00:24 UTC:

- 540 jobs, about 300 job-minutes. Roughly 13 jobs per PR.
- Each job spends about 20 s getting ready (checkout 2 s, setup-bun 2 s, `bun install` 13-16 s)
  before a test runs. 540 × 20 s is about 180 of the 300 minutes: **more than half the minutes
  are setup**, repeated on a fresh VM every time.
- Most suites take 25-60 s. The long poles: skate-tech-park (about 355 s of tests), two-fronts
  (about 70 s), codesplitter (about 70 s).
- Queueing is small but real: 39 of 540 jobs waited over a minute to start, the worst 234 s. That
  is the free public-repo cap of 20 concurrent jobs, hit when a `packages/` PR fans out to every app
  during a merge round.
- Volume: about 8,000-10,000 job-minutes a month across all workflows. That costs $0 today (public
  repo, standard runners). The same minutes on a private repo would be about $50-60 at $0.006/min.

So a box doesn't save money; GitHub is already free. What it buys is **speed**: warm
`node_modules`, a warm checkout, no 20-job cap, and 16 fast threads in place of a 2-vCPU runner.

## The options

| Option | Monthly | Setup | Cores / RAM | Notes |
|---|---|---|---|---|
| **Hetzner AX42** (dedicated) | €79-99 | €49 | Ryzen 7 PRO 8700GE, 8c/16t, 64 GB DDR5 ECC, 2× 1.92 TB NVMe | Best value. Zen 4. EU only (Falkenstein, Nuremberg, Helsinki). |
| Hetzner AX41 (dedicated) | €59 | €0 | Ryzen 5 3600, 6c/12t, 64 GB DDR4, 2× 512 GB NVMe | Older Zen 2, no setup fee. |
| Hetzner EX44-1-LTD (dedicated) | €57.30 | €0 | Intel i5-13500, 14c/20t, 64 GB | Only while stock lasts. |
| Hetzner AX102 (dedicated) | €159-259 | €129 | Ryzen 9 7950X3D, 16c/32t, 128 GB DDR5 ECC | More than we need now. |
| Hetzner Server Auction | about €30-60 | €0 | used, varies daily | Cheapest, but the stock changes every day. |
| Hetzner Cloud CCX33 (hourly) | €138.49, or €0.2219/h | €0 | 8 dedicated vCPU, 32 GB | Good for a trial week; pricier than AX42 if kept on all month. US: $165.99. |
| Hetzner Cloud CAX41 (hourly) | €40.99 | €0 | 16 Ampere vCPU (arm64), 32 GB | Cheap, but ARM; CI is x86 and Rust builds differ (#760). |
| Hetzner Cloud CX53 (hourly) | €29.49 | €0 | 16 shared vCPU, 32 GB | Cheapest cores; shared, so timings vary. |
| Ubicloud runners (managed, on Hetzner metal) | about $12-20 for our minutes | €0 | 2 vCPU per job | $0.00125-0.002/min. Still a cold VM per job, so the 20 s setup stays. |
| Blacksmith runners (managed) | about $20-30 | €0 | 2 vCPU per job | $0.004/min, 3,000 free min/month. Same cold-setup problem. |
| MacBook Pro M1 Max 64 GB (owned) | power only | €0 | 10 cores, 64 GB | macOS arm64, not Linux; Docker for Linux. Plan in local-build-monster.md. |

Bills to watch:
- A Hetzner Cloud server bills hourly until it is **deleted**; powering it off does not stop the bill (COSTS.md).
- Dedicated servers bill monthly with a setup fee, and Hetzner's notice period is monthly.
- One IPv4 is included; extra IPs are €1.70/month.

## The catch: this repo is public

`scripts/ci-guard.ts` fails any workflow that uses a runner other than a standard GitHub-hosted
one, and that is on purpose. On a public repo, a fork PR can edit the workflow to target a
self-hosted label, and its code then runs on the box. GitHub's own docs recommend self-hosted
runners only for private repos. That leaves two shapes:

1. **A builder we drive (recommended first).** The box is not a GitHub runner. Agents send a branch to it
   over Tailscale/SSH, it runs `scripts/ci-apps.ts`'s jobs sharded across 16 threads with a
   `node_modules` kept per lockfile hash, and it reports pass/fail on the PR as a comment or
   status. GitHub's free hosted runs stay the merge gate. No fork code ever reaches the box. This is
   the "builders we drive, never self-hosted runners" rule from local-build-monster.md, on rented
   hardware. The trust dial and tiers there (Part 2, Part 5) can later let a green box run stand in
   for most of the hosted suite.
2. **A self-hosted runner as the gate (later, only if the gate is still the wait).** Needs the owner,
   since these are repo settings: set fork PR workflows to *require approval for all outside
   collaborators*; run the runner `--ephemeral` inside a throwaway container or VM per job; keep no
   secrets on the box; and loosen `ci-guard.ts` for exactly one label. Every agent PR comes from a
   branch in this repo, so agents would never wait for approval; only forks would.

## Recommendation

1. **Trial on hourly cloud first:** one CCX33 for a week of real merge rounds, about 40 hours,
   about €9. Time the same `apps.yml` run there against GitHub, then delete the server.
2. If it pays off, **rent an AX42 at €79/month** (smallest storage option) plus €49 setup, about
   €1,000 for the first year. Same Zen 4 cores, twice the RAM of the CCX33, for a bit over half its
   monthly price.
3. Run it as shape 1 (a builder we drive). GitHub stays the free final gate.

Pick a hosted runner service (Ubicloud, Blacksmith) only if what we want is GitHub's own gate
running faster with no box to look after; it won't fix the setup time, which is the bigger cost.

## Sources

- Hetzner price adjustment, 15 June 2026: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner AX line (live prices and specs): https://www.hetzner.com/dedicated-rootserver/matrix-ax/
- Self-hosted runner fee announced, then postponed (Dec 2025; still not charged, and never for public repos): https://www.theregister.com/2025/12/17/github_charge_dev_own_hardware/
- Runner price comparisons (Ubicloud, Blacksmith, GitHub $0.006/min since 2026-01-01): https://runnerbench.com/ , https://craci.com/compare/github-actions-runner-providers
- Hetzner Cloud increase analysis: https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives
