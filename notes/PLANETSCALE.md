# When to move from D1 to PlanetScale

Research, October 2026. Nothing was deployed or load-tested. Prices are PlanetScale list prices for
AWS us-east-1 from [planetscale.com/pricing](https://planetscale.com/pricing); D1 limits are from
[Cloudflare's D1 limits page](https://developers.cloudflare.com/d1/platform/limits/).

## Short answer

Not yet. Move only when one of three walls is hit, and only the part of the data that hit it.
Moving everything early costs a SQL port and a network hop on every query, and buys nothing D1 isn't
already giving us for $0 to a few dollars a month.

## What we run on today

codeSplitter keeps one D1 (`codesplitter-db`, 110 migrations; the busiest tables are `agent_runs`,
`repos`, `branch_files`, `users`, `branches`, `check_runs`). File text, search and the op log
are already off D1, in Durable Object SQLite and R2. The walls are written up in
[`apps/codesplitter/src/scale.ts`](../apps/codesplitter/src/scale.ts) (`d1-writes`, `d1-size`).
Other apps use D1 for small data. The CLI can already put a Hyperdrive in front of Postgres
([PROVIDERS.md](PROVIDERS.md)), so the plumbing exists.

## The walls, in the order we would hit them

| Wall | D1 limit | Where we stand | PlanetScale answer |
|---|---|---|---|
| Size | 10 GB per database, cannot be raised | Unmeasured live; `scale.ts` reads it for admins. Search and docs are already out of D1 | Storage grows with the disk; no 10 GB cap |
| Write rate | One writer per database, single-threaded: about 1,000 queries/s at 1 ms each, 10/s at 100 ms. Past that, "overloaded" errors | Edits and traffic are already tallied once a second off the hot path (#623, #638); `scale.ts` estimates ~500 writes/s sitewide | Real concurrent writers, row locks, a sized CPU |
| Query shape | SQLite: no real joins on huge tables, 100 bound parameters, 30 s per query, 2 MB per row | Not a pain yet | Postgres or MySQL: full planner, extensions, `pgvector` |
| Operability | Time Travel to 30 days; no branching | Fine | Branches, online schema changes, backups, HA |

## Cost

D1 on Workers Paid includes 25 billion rows read, 50 million rows written and 5 GB a month, then
$0.001 per million reads, $1 per million writes and $0.75 per GB-month. There is no egress charge and
read replicas cost nothing extra. At our size this is inside the $5 Workers Paid fee.

PlanetScale Postgres on EBS storage, per month (the SKU only; storage beyond what is included,
backups and egress are extra, and the pricing page does not list their rates):

| Size | Single node | HA (1 primary + 2 replicas) |
|---|---|---|
| PS-5 (1/16 vCPU, 512 MiB) | $5 | $15 |
| PS-20 (1/4 vCPU, 2 GiB) | $17 | $50 |
| PS-80 (1 vCPU, 8 GiB) | $50 | $148 |
| PS-320 (4 vCPU, 32 GiB) | $190 | $570 |
| Metal M-10, HA, 10 GiB NVMe | not in the sample I read | $50 |

Prices are arm64; x86-64 costs a bit more. Vitess (MySQL) starts at $39 HA. There is no free plan.
Add Hyperdrive (100k queries a day free, unlimited on Workers Paid) in front of it from a Worker.

So the honest cost line is: D1 is about $0 to $5; a PlanetScale we can stand behind in production is
HA, so $50 to $150 a month for the size where it starts to beat D1, before storage. A single node at
$5 to $17 is fine for a dev branch, not for the site.

## Performance

- D1 sits next to the Worker (with read replicas, next to the reader). PlanetScale is in one region
  (us-east-1 for most setups), so every query pays a round trip from the Worker, softened by Hyperdrive's
  pooling and query cache. Chatty request paths (N+1 queries, many small `SELECT`s per request) get
  slower, not faster. Smart Placement can put the Worker near the database; it has to be measured.
- PlanetScale wins on throughput and heavy queries: a Postgres with a few real cores does a
  join over millions of rows that D1 would time out on, and takes many writers at once.
- PlanetScale's own Workers demo tells you not to put the write path in a Durable Object; ours already
  write to D1 from Workers, off the DO path.
- I found no published latency numbers for Workers → Hyperdrive → PlanetScale. Measure before deciding.

## Triggers: move when any one is true

1. `scale.ts` shows D1 past about 70% of 10 GB, and trimming or splitting per owner is no longer cheaper.
2. `overloaded` errors from D1 show up on a normal day (not a stress run) after the tally work is
   already in. Check `limit_hits` and Insights 5xx.
3. A feature needs what SQLite lacks and we would otherwise contort around it: heavy cross-repo
   analytics joins, `pgvector` instead of Vectorize, row-level security, or several services writing one
   database.
4. A customer or the owner wants schema branching with review (PlanetScale's deploy requests) for the
   database itself.

Not triggers: "it is a real database", a cold feeling about SQLite, or cost, since D1 is cheaper at every
size we have.

## Cost of moving

- The SQL is SQLite dialect across ~650 call sites in `apps/codesplitter/src`. Moving means porting
  placeholders, `INSERT OR REPLACE`/`ON CONFLICT`, `json_extract`, date functions, `AUTOINCREMENT`, and 110
  migrations, plus `batch()` becoming transactions. The `Env.DB` calls need an adapter, not a rewrite, if
  we move one table group at a time.
- Choose Postgres, not Vitess: it matches `hyperdrive` and `pglite` already in `packages/` and `PROVIDERS.md`,
  so the desktop twin keeps working. Vitess pays off only past a single primary's size (sharding), which
  is far off.
- Data move: dump from D1, load, then dual-write one release before the cut. D1 Time Travel is the
  rollback.

## Recommendation

1. Now: do nothing to the database. Keep `scale.ts` readings honest, and add a D1 size and
   `overloaded` count alert that tells the owner when a trigger is near.
2. Next, when asked: a spike on a $5 single-node PS-5 behind Hyperdrive, with the hottest read path
   (`repos` plus `branches` joined) ported behind a flag, to get real Worker → PlanetScale latency numbers. This
   is the only way to settle the performance question. It costs about $5 for a month.
3. At trigger 1 or 2: move the table that hit it (likely `line_events`, `limit_hits`, `check_runs`,
   `agent_runs`: append-heavy logs) to PlanetScale Postgres HA, and leave `users`, `repos` and the
   small config tables on D1. Splitting by owner on D1 is the cheaper first step if the wall is size.

## Not verified

- Included storage, backup and egress rates for PlanetScale (the pricing page points to a SQL catalog).
- Latency from a Worker through Hyperdrive to PlanetScale, and Smart Placement's effect.
- Our live D1 size and write rate. `scale.ts` reads them for admins; I did not have an admin session.
