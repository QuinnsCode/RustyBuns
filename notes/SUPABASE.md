# Supabase apps and Rusty Buns

Research, October 2026: a friend builds mostly on Supabase. Can Alchemy provision it, and do we bring
him in with Supabase as it is, or move him off it? The easy order is two steps: adopt Rusty Buns first,
then leave Supabase later if he wants. This note covers both paths.

## Does Alchemy cover Supabase?

**No.** Alchemy v2 (we pin `2.0.0-beta.77`; `beta.81` is the newest in the local cache) ships providers
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

## Path A: adopt Rusty Buns, keep Supabase

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
  on the Worker. Alchemy can declare that. **Rusty Buns can't yet**: there's no Postgres or Hyperdrive
  binding, so no local twin either.

The catch is the desktop and offline story. Our local twins are sqlite and folders, but his data lives
in a hosted Postgres. So the desktop build is a thin client that needs the network, or it points at a
local stack (`supabase start`, which needs Docker). That's fine for a first step, but it isn't the
"runs anywhere, no cloud" pitch.

**Cost to him:** almost none. `rustybuns init`, add the env vars, done. Nothing in Supabase moves.

## Path B: leave Supabase

Each Supabase piece has a Cloudflare shape, and with it a Rusty Buns twin:

| Supabase | Moves to | Effort | Notes |
|---|---|---|---|
| Postgres | **D1** (sqlite) | high | Rewrite Postgres-only SQL (jsonb, arrays, `returning` quirks, extensions). RLS has no equivalent, so policies become checks in code. You get a local twin for free. |
| Postgres | **Neon + Hyperdrive** | low | Keeps Postgres and the SQL. `pg_dump` to restore. Alchemy has `Neon.Project`/`Neon.Branch`, wired straight into `Cloudflare.Hyperdrive`. No local twin until we add a Postgres binding. |
| Auth | **Better Auth** (or Cloudflare Access for internal tools) | medium | Better Auth has an official [Supabase migration guide](https://better-auth.com/docs/guides/supabase-migration-guide): it moves users and password hashes, logs every session out, and doesn't cover 2FA or RLS yet. Its script targets Postgres, so with D1 it needs adapting. |
| Storage | **R2** | low | Supabase Storage has an [S3-compatible endpoint](https://supabase.com/docs/guides/storage/s3/compatibility), so `rclone` copies buckets across. Bucket policies become checks in the Worker. |
| Realtime | **Durable Objects** | medium | This is our comms primitive. Postgres change feeds don't carry over: whatever writes the row broadcasts to the DO. Presence and broadcast map directly. |
| Edge Functions | **Worker routes** | low to medium | Deno to Workers is mostly import changes (`Deno.env` becomes `env`, `npm:`/`jsr:` specifiers become package imports). |
| Cron (`pg_cron`) | **Cron Triggers** | low | |
| Vectors (`pgvector`) | **Vectorize**, or keep pgvector on Neon | medium | |

The cheapest real exit is **Neon + Hyperdrive + Better Auth + R2**. The SQL and the RLS-free parts move
almost unchanged. D1 is the "full Rusty Buns" endpoint (sqlite everywhere, true offline desktop), but
it's a rewrite of the data layer, so it's only worth it if he wants that desktop story.

## Recommendation

Do it in that order. **Path A first**: it's a dev dependency and an afternoon of work, and he keeps
Supabase. Once his app runs as a Worker and a binary, the Supabase pieces he actually uses are easy to
see, and each one can move on its own (storage to R2 is the easiest first move, auth the riskiest). The
gap that makes path A rough is ours: **Rusty Buns has no Postgres/Hyperdrive binding** ([#1067](https://github.com/QuinnsCode/RustyBuns/issues/1067)). Adding one would
make "Supabase or Neon behind Hyperdrive" a first-class storage option, and it would serve the Neon exit
in path B too.
