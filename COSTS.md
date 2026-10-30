# Costs

What Rusty Buns can bill you for, and the switches that keep it small. The CLI
does what it can; the hard caps live in your provider accounts.

## What the CLI does

`rustybuns plan` and `rustybuns deploy` print the stack's billable resources
before they run, marked **fixed** (bills by the hour whether or not anyone uses
it) or **usage** (bills by traffic):

```
billable resources in this stack:
  Cloudflare Worker "hippo-tycoon"  usage  requests + CPU time
  Durable Object WORLD              usage  duration while awake: open sockets, timers, tick loops
  account-side caps and alerts: COSTS.md
```

One thing is a hard stop: a Hetzner box past the small shared tiers (anything
`ccx`, or tier 3 and up such as `cpx31`, `cax41`) is refused unless the config
says so:

```ts
targets: { box: { provider: "hetzner", serverType: "cpx31", allowLargeServer: true } }
```

`--yes` does not skip this; it only skips the plan-before-deploy check.

### What it would cost a month: `plan --usage`

The list says what bills, not how much. The bill comes from the fan-out: a
`* * * * *` cron whose tick runs twenty sweeps, each a few Durable Object calls
and queue sends, is 1,440 ticks a day times all of that. The desktop and box
hosts count every binding call per cause (each request, each cron tick, each
queue message): DO requests, the distinct objects a run touches and how long it
holds them, D1 rows read and written, KV reads/writes/lists, R2 class A/B
operations and queue sends. A box serves the counts at `/__rb/usage`; a desktop
writes them to `<data>/usage.json` once a minute. Run the app for a while, then:

```
rustybuns plan --usage ~/.my-app/usage.json          # or https://my-box.example
rustybuns plan --usage usage.json --requests-per-day 50000
```

```
estimated month from 1h 0m of counted usage (Workers Paid):
  cron * * * * *: 43k (ticks in 30 days), each 20 DB_DO.requests, 2 DB_DO.objects, 2 JOBS.sent
    ! keeps 2 DB_DO objects awake 24/7: ticks at most 60 s apart, and an idle object stays billed ~70 s
  request: 26k (864 a day, the rate this run saw), each 10 DB.rowsRead, 1 DB.rowsWritten
  queue JOBS: 86k (messages sent to JOBS), each 2 DB.rowsWritten
  DO duration, GB-s     664k  $3.29
  ...
  ~$3.29 a month past what Workers Paid includes, plus its $5
```

A cron multiplies by its ticks in 30 days, requests by `--requests-per-day`
(or the rate the run saw), and a queue's consumer by the messages the others
send it. A Durable Object stays in memory, and billed, for about 70 seconds
after its last event, so a cron that pokes one more often than that keeps it
awake around the clock; the estimate flags it. CPU time, storage and bindings
with no local twin (Workers AI among them) aren't counted. Prices are Workers
Paid's list prices; check them against Cloudflare's pricing pages.

## Account checklist

Do these once. They are what actually cap a bill.

**Cloudflare**
- [ ] Stay on the **Workers Free** plan while nothing needs Paid. On Free, going
      over a limit makes requests fail; it never bills. SQLite-backed Durable
      Objects (what every app here uses) work on Free.
- [ ] If you move to Paid: Notifications → add a **usage-based billing** alert
      so you hear about overage before the invoice does. Cloudflare has no
      spending cap on Paid, so the alert is the guard.
- [ ] R2 needs a card even on Free. Check R2 → usage now and then; storage is
      what grows quietly.

**Hetzner** (only if an app has `targets.box`)
- [ ] A server bills hourly until it is **deleted**. Powering it off does not
      stop the bill. `rustybuns destroy` deletes it and its Volume.
- [ ] Look at Cloud Console → your project now and then for servers, Volumes,
      and snapshots you forgot.

**Railway** (only if an app has `targets.box` with `provider: "railway"`)
- [ ] Railway bills by usage (vCPU and RAM by the minute, Volume storage by the
      GB-month) and has a real cap: Workspace → Usage → set a **hard usage
      limit**, and services stop when it is hit. Set it low, at the plan's
      included usage, before the first deploy.
- [ ] Keep `sleep` on (the default). An idle service sleeps and stops billing
      compute; `sleep: false` shows up as a **fixed** row in `plan`.
- [ ] `rustybuns destroy` deletes the Project, Service and Volume.

**GitHub Actions**
- [ ] Nothing to do while the repo is public: standard runners (including
      macOS) are free for public repos. If it ever goes private, set the
      Actions spending limit to $0 under Billing first; the motion-midi
      workflow runs a macOS job on every push to `packages/**`.
- [ ] Set the Actions **budget** to $0 with **Stop usage when budget limit is
      reached** (Settings → Billing → Budgets and alerts) anyway. It costs
      nothing while the repo is public and holds if that ever changes.
- `scripts/ci-guard.ts` runs on every PR (apps.yml) and fails it if a
  workflow uses a runner that isn't a standard GitHub-hosted one (a larger
  runner bills even on a public repo; a self-hosted one runs fork PRs' code
  on your machine) or a job has no `timeout-minutes` (GitHub's default is 6
  hours).

## Writing apps that stay cheap

A Durable Object bills for the time it is awake.

- Accept sockets with `ctx.acceptWebSocket` (hibernation), never `ws.accept()`.
  Every app here does.
- A tick loop or `setInterval` keeps the object awake. Stop it when the last
  player leaves (hippo-tycoon's `Room` does). An abandoned open tab still
  counts as a player, so a room that ticks should also time out idle players.
- Client pings wake a hibernated object on each message. Keep them slow, or
  use `ctx.setWebSocketAutoResponse` for a fixed ping/pong pair.
- Route only real rooms to Durable Objects: validate the room code in the
  Worker before `idFromName`, so junk URLs do not create objects.

## What is live

Check before you worry. `rustybuns plan` in an app shows what it would change;
the Cloudflare dashboard (Workers & Pages, D1, KV, R2), the Railway dashboard and Hetzner Cloud Console
show what exists. `rustybuns destroy` in an app removes everything its stack
created.

### Stages store builds call

The iOS/Android builds of Park Hide & Seek (the pilot; Hippo Tycoon next) call their edge's `/ws` and `/api`
for months after release. That stage must never be torn down in a cost sweep: an installed build would have
nowhere to go. It answers builds older than `MIN_PROTOCOL` with "Update to keep playing"
(`@rustybuns/util/protocol`), so raising the floor is how old builds retire, not destroying the stage.
`park-hide-seek` is already on the owner's live-deploys list; this is why it stays.
