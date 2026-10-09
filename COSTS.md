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
