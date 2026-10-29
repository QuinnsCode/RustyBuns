# Providers: the borg's next axis

The borg absorbs apps onto Rusty Buns. Frameworks were the first axis: [FRAMEWORK_COVERAGE.md](../FRAMEWORK_COVERAGE.md)
measures how many real RWSDK and TanStack Start apps boot unchanged. Providers are the next. An app also
leans on hosted services (a database, auth, storage, realtime), and absorbing it means taking those over
too. That's the "who hosts the data" choice from thick borg
([#856](https://github.com/QuinnsCode/RustyBuns/issues/856)): one adapter per provider, never one per
combination.

Each provider gets two adapter options:

- **keep**: the app still talks to the provider, and Rusty Buns runs the code around it.
- **swap**: the provider's pieces move to Cloudflare primitives that have Rusty Buns local twins.

Supabase is the first provider story.

## Supabase

Research, October 2026: a friend builds mostly on Supabase. Can Alchemy provision it, and do we bring
him in with Supabase as it is, or swap it out? The easy order is two steps: keep it while he adopts
Rusty Buns, then swap it out piece by piece if he wants. This section covers both adapters.

### Does Alchemy cover Supabase?

**No.** Alchemy v2 (we pin `2.0.0-beta.84`, providers as their own `@alchemy.run/*` packages) ships providers
for Cloudflare, AWS, GCP, Neon, PlanetScale, Prisma, Railway, Fly, Hetzner, Stripe, GitHub, Docker and
more. It has no Supabase provider. The v1 line (`0.93.12`) didn't have one either. Upstream there's an
open issue titled [Supabase](https://github.com/alchemy-run/alchemy/issues/674) with no body and no
replies. Alchemy's own advice (the beta.36 release notes) is to treat Supabase as an outside database and
put a `Cloudflare.Hyperdrive` in front of its connection string.

What does provision Supabase today:

- **The Supabase CLI**: `supabase link`, `db push` (migrations), `functions deploy`, `gen types`. This is
  what most Supabase users already run.
- **The official [Terraform provider](https://registry.terraform.io/providers/supabase/supabase/latest/docs)**
  (also wrapped by Pulumi). Supabase still calls it alpha. It manages projects, settings and branches,
  and it can import an existing project.
- **The [Management API](https://supabase.com/docs/reference/api/introduction)** at `api.supabase.com`,
  which both of those call.

If we ever want Supabase inside a Rusty Buns deploy graph, a small Alchemy v2 provider over the
Management API (project, secrets, maybe an Edge Function) is doable. It's not worth building before
someone actually needs it.

### Adapter: keep it (supabase-js and Hyperdrive)

His app keeps talking to Supabase. Rusty Buns takes over the parts Supabase doesn't do: the desktop
binary, the Worker and the Linux box.

- **http**: his frontend and any API routes become the `fetch` handler. Supabase Edge Functions run on
  Deno, so they either stay on Supabase or move into the Worker as plain routes. Both work.
- **storage**: `supabase-js` over HTTPS runs the same in a Worker, under Bun and on a box. Rusty Buns
  needs no binding for it, just `SUPABASE_URL` and the anon key, with the service key kept server-side.
  Those go in `.env.schema` and resolve through varlock like our other secrets.
- **identity**: Supabase Auth issues a JWT. The Worker (or host) verifies it against the project's JWKS
  and passes on `X-User-Id`, the shape the identity primitive already expects. RLS keeps working,
  because the queries still reach Postgres as that user.
- **Direct Postgres** (Drizzle, Prisma, raw SQL) needs [Hyperdrive in front of
  Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)
  on the Worker. A `hyperdrive` binding declares it (#1067), and `init` adds one when the app uses `pg`,
  `postgres`, or Drizzle or Prisma on postgresql. Off the edge its twin is the Postgres URL itself.

The catch is the desktop and offline story. Our local twins are sqlite and folders, but his data lives
in a hosted Postgres. So the desktop build is a thin client that needs the network, or it points at a
local stack (`supabase start`, which needs Docker). That's fine for a first step, but it isn't the
"runs anywhere, no cloud" pitch.

**Cost to him:** almost none. `rustybuns init`, add the env vars, done. Nothing in Supabase moves.

### Adapter: swap it out (D1, R2 and auth)

Each Supabase piece has a Cloudflare shape, and with it a Rusty Buns twin:

| Supabase | Moves to | Effort | Notes |
|---|---|---|---|
| Postgres | **D1** (sqlite) | high | Rewrite Postgres-only SQL (jsonb, arrays, `returning` quirks, extensions). RLS has no equivalent, so policies become checks in code. You get a local twin for free. |
| Postgres | **Neon + Hyperdrive** | low | Keeps Postgres and the SQL. `pg_dump` to restore. Alchemy has `Neon.Project`/`Neon.Branch`, wired straight into `Cloudflare.Hyperdrive`. The `hyperdrive` binding fronts a URL, or with `origin: { neon }` a Neon branch the stack makes and owns ([#1139](https://github.com/QuinnsCode/RustyBuns/issues/1139)). |
| Auth | **Better Auth** (or Cloudflare Access for internal tools) | medium | Better Auth has an official [Supabase migration guide](https://better-auth.com/docs/guides/supabase-migration-guide): it moves users and password hashes, logs every session out, and doesn't cover 2FA or RLS yet. Its script targets Postgres, so with D1 it needs adapting. |
| Storage | **R2** | low | Supabase Storage has an [S3-compatible endpoint](https://supabase.com/docs/guides/storage/s3/compatibility), so `rclone` copies buckets across. Bucket policies become checks in the Worker. |
| Realtime | **Durable Objects** | medium | This is our comms primitive. Postgres change feeds don't carry over: whatever writes the row broadcasts to the DO. Presence and broadcast map directly. |
| Edge Functions | **Worker routes** | low to medium | Deno to Workers is mostly import changes (`Deno.env` becomes `env`, `npm:`/`jsr:` specifiers become package imports). |
| Cron (`pg_cron`) | **Cron Triggers** | low | |
| Vectors (`pgvector`) | **Vectorize**, or keep pgvector on Neon | medium | |


### Own your auth: Better Auth

Better Auth is the proposal for auth with either adapter. It's a TypeScript library, not a service: users,
sessions and accounts are rows in *your* database (D1, sqlite, Postgres or PGlite), and it runs in the
`fetch` handler on all three targets. Supabase Auth bills per user over 100k MAU. Better Auth costs
nothing per user, because a user is a row. It covers email and password, OAuth, magic links, passkeys,
2FA and organizations as plugins. Alchemy's repo already has a `cloudflare-better-auth` example.

It also fits the identity primitive as it is. Better Auth checks the session, and the handler passes on
`X-User-Id`. You can switch over before the database moves: Better Auth's [Supabase migration
guide](https://better-auth.com/docs/guides/supabase-migration-guide) copies users and password hashes,
and the one cost is that everyone logs in again once.

### The simple database options

Not every app needs a hosted Postgres. From simplest up:

- **sqlite / D1**: what Rusty Buns already does. D1 in the cloud, a sqlite file on the desktop and box.
  Free up to 5GB on Workers Free. One D1 database tops out at 10GB, so a big app shards it or uses
  Postgres.
- **[PGlite](https://pglite.dev)**: real Postgres compiled to WASM (from ElectricSQL), a few MB, running
  inside Bun, Node or the browser and saving to a folder. It's the obvious **local twin for a Postgres
  binding**: the desktop build gets real Postgres offline, with no Docker and no `supabase start`, and
  the app's Postgres SQL keeps working. It allows one connection at a time and isn't a production
  server, so the cloud side still uses Hyperdrive. It also makes a good test database.
- **Postgres on the box**: Rusty Buns already deploys a Railway or Hetzner box. A Postgres next to the
  app on that volume costs nothing extra beyond the box.
- **Neon + Hyperdrive**: managed Postgres that scales to zero. Pay as you go, no minimum.

PGlite locally, Hyperdrive to Neon or Supabase in the cloud: that's the shape to end up with. #1067 shipped
the Hyperdrive half, with the Postgres URL itself as the twin; `local: "pglite"` ([#1138](https://github.com/QuinnsCode/RustyBuns/issues/1138)) added PGlite.

### The toolchain: an agent, `cf` and Rusty Buns

What used to sell Supabase is that one dashboard does everything. An agent with the right tools now
does that job, against primitives you own:

- **Rusty Buns** turns the app into a desktop binary, a Worker and a box from one config, and deploys
  it through Alchemy.
- **[`cf`](https://flaviocopes.com/cloudflare-cf/)**, Cloudflare's new agent-first CLI (open beta since
  Birthday Week, September 28 2026), covers about 2,900 API operations against Wrangler's 280. It prints
  JSON by default, has `cf cli search` to find a command from a plain-language task, offers `--dry-run`
  with no credentials, and supports scoped tokens per project. With it, an agent can inspect and fix the
  account (DNS, Access, R2 lifecycle, logs), not just deploy Workers. It reads `cloudflare.config.ts`.
  **Caveats:** it's beta, it needs Node 22.18+ and **doesn't support Bun**, and Wrangler gets 18 months
  of maintenance after the beta ends. Rusty Buns keeps deploying through Alchemy. `cf` is the agent's
  tool for everything around the deploy.
- **An agent** (Claude Code at an Agent Office desk) does the migration work: it rewrites Edge
  Functions as Worker routes, ports the SQL, runs the Better Auth user copy, and `rclone`s the buckets.
  Supabase's moat was the convenience; an agent covers the convenience.

### Napkin math

List prices as of October 2026 ([Supabase](https://supabase.com/pricing),
[Workers, D1, R2, DOs](https://developers.cloudflare.com/workers/platform/pricing/),
[Neon](https://neon.com/pricing)). Monthly, rounded, assuming 5ms CPU per request and that R2 traffic
mostly stays inside the free op counts. Nothing was deployed to get these numbers.

**1. Side project**: 2k MAU, 0.5GB DB, 2GB files, 10GB egress, 1M requests.

| Supabase | Cloudflare + Rusty Buns |
|---|---|
| Free fits, but it pauses after a week idle and caps you at 2 projects. To stay up: **Pro, $25** | Workers Free (100k requests/day), D1 and R2 free tiers: **$0** ($5 if one day tops 100k) |

**2. Small SaaS**: 20k MAU, 4GB DB, 50GB files, 300GB egress, 20M requests, prod plus staging.

| Line | Supabase | Cloudflare + Rusty Buns |
|---|---|---|
| Base | Pro $25 (covers 1 Micro) | Workers Paid $5 (covers every app and stage) |
| Second project | Micro $10 | $0 |
| Requests and CPU | — | 10M × $0.30 + 70M ms × $0.02 = $4.40 |
| DB | included | D1 included |
| Files | included | 40GB × $0.015 = $0.60 |
| Egress | 50GB × $0.09 = $4.50 | $0 |
| Auth | included | Better Auth, $0 |
| **Total** | **≈ $40** ($45 on Small compute) | **≈ $10** |

**3. Taking off**: 150k MAU, 40GB DB, 500GB files, 3TB egress, 200M requests, 20M realtime messages,
1,500 peak sockets.

| Line | Supabase | Cloudflare + Rusty Buns (Neon for the 40GB) |
|---|---|---|
| Base and compute | $25 + Medium $50 (after the $10 credit) = $75 | Workers $5 |
| Requests and CPU | — | 190M × $0.30 + 970M ms × $0.02 = $76 |
| DB | 32GB × $0.125 = $4 | Neon: 1 CU always on, 730h × $0.106 = $77, plus 40GB × $0.35 = $14 |
| Auth (MAU) | 50k × $0.00325 = **$163** | Better Auth, **$0** |
| Files | 400GB × $0.0213 = $9 | R2: 490GB × $0.015 = $7, plus ops ≈ $32 |
| Egress | 2,750GB × $0.09 = **$248** | **$0** |
| Realtime | 15M msgs × $2.50/M + 1k sockets × $10/1k = $48 | DOs: 20M msgs bill as 1M requests (20:1), hibernated: ≈ $5 |
| **Total** | **≈ $545** (≈ $645 with 7-day PITR) | **≈ $215** |

What the math says:

- **Small apps go from $25-45 to $0-10.** Every extra project costs nothing on Cloudflare, but costs at
  least $10 of compute on Supabase.
- **At scale, two lines are 75% of the Supabase bill: MAU ($163) and egress ($248).** Better Auth takes
  the first to zero, Cloudflare's free egress the second. That's about $400 a month back, the bulk of a
  2.5x saving.
- The Cloudflare side keeps its own sharp edge: request and CPU charges grow with traffic. A heavy
  5ms+ handler at 200M requests is real money, so profile it (and that's where Rust pays off).
- **The agent's cost** is the Claude plan he already pays for, plus a few sessions of migration. Keeping it,
  then swapping auth, then storage are small steps an agent can do in a day each. At the small-SaaS size the
  saving is about $30 a month, which won't move anyone by itself. The pitch for him is the desktop
  binary, owning his auth and data, and not getting a bill shock when the app takes off.

### Recommendation

1. **Keep it first.** Rusty Buns as a dev dependency, Supabase untouched. That's an afternoon's work, and
   he gets the binary and the Worker.
2. **Own the auth next: Better Auth.** It takes the biggest line at scale to zero, and it doesn't wait
   on the database.
3. **Storage to R2.** Easy, and it ends the egress bill.
4. **Database last, and only if it's worth it**: D1 if the data is small and he wants true offline
   desktop, Neon + Hyperdrive if he wants to keep Postgres. Either way, PGlite is the local twin.

The `hyperdrive` binding ([#1067](https://github.com/QuinnsCode/RustyBuns/issues/1067)) keeps his Postgres
on every target that can reach it. With PGlite as its offline twin
([#1138](https://github.com/QuinnsCode/RustyBuns/issues/1138)), "keep your Postgres" works with no network too.

## Next providers

Candidates only, nothing started. Each would get the same keep and swap adapters:

- **Firebase**: Firestore, Auth and Storage. Swap is the big one (documents to D1 or Durable Objects,
  Auth to Better Auth, Storage to R2).
- **Neon**: already Postgres, so keep is Hyperdrive ([#1067](https://github.com/QuinnsCode/RustyBuns/issues/1067)).
  Alchemy has `Neon.Project`, so it can sit inside the deploy graph.
- **PlanetScale**: MySQL or Postgres behind Hyperdrive. Alchemy has a provider.
- **Clerk**: auth only. Keep verifies its JWT and passes on `X-User-Id`, swap moves users to Better Auth.
