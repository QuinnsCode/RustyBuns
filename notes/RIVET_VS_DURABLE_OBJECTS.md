# Rivet vs Cloudflare Durable Objects: price and horsepower at scale

Asked 2026-11-06: as we scale, does [Rivet](https://rivet.dev) save money, add usage room, or buy horsepower
over Durable Objects? Prices read from both vendors' pages that day; re-check before acting on them.

**Short answer: stay on Durable Objects.** For the way our rooms are written (hibernating sockets, clients
simulate, the room relays), DOs cost close to nothing when idle and Rivet Cloud has a higher floor. Rivet wins
in one case: a room that stays awake doing real work all day (a server-side sim tick), past roughly 30 such rooms.
That case is a better fit for our own Bun shell than for a rewrite onto Rivet's actor API.

## What each one charges

| | Cloudflare Durable Objects (Workers Paid) | Rivet Cloud |
|---|---|---|
| Floor | $5/mo | Free (1 node), Hobby $10, Team $120, Enterprise $900 per month control plane |
| Compute | $12.50 per million GB-s past 400k; every awake object billed as 128 MB; **hibernated = $0** | Per node, per month: R-5 (1/4 vCPU, 1 GB) $4.20, R-10 $8.40, R-20 (1 vCPU, 4 GB) $16.80, R-40 (4 vCPU, 8 GB) $27.30, R-160 (8 vCPU, 16 GB) $94.50. Bring your own nodes: control plane only |
| Requests | $0.15 per million past 1M; incoming WebSocket messages count 20:1; outgoing and auto-responded pings free | Not metered on the page |
| Storage (SQLite) | 25B rows read and 50M written included, then $0.001 and $1.00 per million; 5 GB-month, then $0.20/GB | Not listed (self-host stores actor data in S3/GCS/R2-style buckets) |
| Node caps | none (unlimited objects) | Free 1, Hobby 3, Team 10, Enterprise 50 actor nodes |
| Where it runs | every Cloudflare location | 6 Google Cloud regions (us-east4, us-central1, europe-west1/3, asia-southeast1, asia-east1) |
| Self-host | no (workerd is open, the platform is not) | Apache 2.0, one Rust binary or Docker image, no usage limits |

Rivet's page lists no egress, request or storage overage rates, so a Rivet Cloud bill past the node price is unknown.

## Horsepower

| | Durable Object | Rivet actor |
|---|---|---|
| Memory | 128 MB per isolate | whatever the node has (up to 16 GB on R-160) |
| CPU per event | 30 s default, up to 5 min (`limits.cpu_ms`) | unrestricted |
| Throughput | soft 1,000 requests/s per object | bounded by the node |
| Storage per object | 10 GB SQLite | bucket-backed |

Two caveats on the "more horsepower" pitch:

- A Rivet actor is still one JavaScript event loop, so a single room gets at most about one core either way.
  The gain is memory (128 MB to GBs) and no CPU cap per event, not a faster room.
- RivetKit's Cloudflare Workers driver (`@rivetkit/cloudflare-workers`) runs actors *inside* Durable Objects,
  so on that driver every DO limit and price above still applies. Only Rivet Cloud or self-hosted Rivet changes them.

## What our rooms cost on DOs

About 20 apps use DOs, most through `Sockets` in `@rustybuns/util/room`, which uses `ctx.acceptWebSocket`
(hibernation). Mythic Masters' region already answers pings with `setWebSocketAutoResponse`, which costs no
duration. The rooms are relays: clients simulate, the room fans out. Only a few set alarms or intervals
(`codesplitter/src/file-do.ts`, `excalibrawl/src/arena.ts`, `hippo-tycoon/src/engine/ports.ts`).

Napkin math, 30-day month:

- **One awake-all-month object** = 0.125 GB x 2.59M s = 324k GB-s, about **$4.05/mo** in duration.
  A hibernating lobby or player hub that wakes for a few seconds per message is cents.
- **1,000 players around the clock, rooms of 4, 20 incoming messages/s each** (a busy action game):
  52B messages / 20 = 2.6B requests = **~$389**; 250 rooms never get to hibernate = 81M GB-s = **~$1,008**.
  About **$1,400/mo**. The same load on Rivet Cloud: Team $120 plus a few R-40 nodes, roughly **$200-250/mo**
  if 250 light relay rooms fit on 4 vCPU (untested), plus unknown egress.
- **Crossover:** Rivet Team's $120 floor equals about 30 always-awake DOs. Below that, or with rooms that sleep
  between messages, DOs are cheaper. Real players don't play 24/7, so the 1,000-player case is a ceiling.

Where the DO bill grows is duration, not requests: a room that keeps a socket busy every second, or a server tick
loop, pays $4/mo per room whether it uses 5 MB or 128 MB. Cheaper fixes before any move:

1. Send fewer incoming frames (batch inputs to 10/s instead of 20-60/s; requests are already 20:1).
2. Keep hibernation everywhere (`acceptWebSocket`, never `accept()`), answer pings with `setWebSocketAutoResponse`.
3. Stop alarms and ticks when a room is empty.

## If a room ever needs real horsepower

We already have an exit that keeps our code: `packages/shell-bun/src/bindings/durable-object.ts` runs a DO class
unchanged on Bun (same constructor, `fetch`, hibernation handlers, storage and alarms). A heavy server-side sim
(more than 128 MB, or seconds of CPU per event) could run that way on a VPS or the builder Mac at a flat price,
with the rest of the app still on Cloudflare. Moving to Rivet means rewriting each room onto Rivet's actor API
and leaving `Sockets`, Alchemy deploys and the edge, for a gain we can get without that.

Not a candidate at all: codeSplitter stays on Workers and Artifacts (see `AGENTS.md`).

## Sources

- [Rivet pricing](https://rivet.dev/pricing)
- [Rivet vs Cloudflare Durable Objects](https://rivet.dev/compare/rivet-vs-cloudflare-durable-objects/) (Rivet's own comparison)
- [RivetKit Cloudflare Workers quickstart](https://rivet.dev/docs/actors/quickstart/cloudflare-workers/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
