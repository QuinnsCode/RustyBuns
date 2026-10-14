# borg-postgres

> **What it proves:** a Postgres app keeps its database and moves its code: the same Worker runs on the desktop against PGlite, and on the edge through Hyperdrive. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

This is **thick borg**'s first story, "keep the database, move the code" ([#856](https://github.com/QuinnsCode/RustyBuns/issues/856)). Slim [borg](../borg/README.md) checks each primitive once; thick borg is a small app per migration story, run through a suite on each target.

`src/worker.ts` is a notes API written the way a Node app on Neon would be: `postgres` (postgres.js) over a connection string, no Cloudflare API in sight. The `HYPERDRIVE` binding hands it that string:

| Target | The connection string is | Postgres is |
|---|---|---|
| edge | Hyperdrive, in front of `DATABASE_URL` | your Neon, Supabase or RDS |
| desktop | `DATABASE_URL` itself, or with it unset | PGlite in the data dir (`local: "pglite"`) |

| Check | What has to hold |
|---|---|
| `insert` | `insert ... returning` with bound values reads back |
| `types` | `text[]` and `jsonb` round-trip as an array and an object |
| `transaction` | a failing statement rolls back the ones before it |
| `concurrent` | ten concurrent upserts land as ten counts |

The app makes its own tables (`POST /api/setup`, idempotent), so the suite runs against a database that already has data in it.

## Run it

```sh
cd apps/borg-postgres
bun test test                          # builds the desktop host, boots it on PGlite, runs every check
bun story.ts https://borg-postgres.<you>.workers.dev   # the same checks against a deploy
```

`bun test test` is what CI runs; it's free and offline. For the edge, set `DATABASE_URL` to a Neon branch's URL, then `rustybuns plan` and `rustybuns deploy`, run `bun story.ts <url>`, and `rustybuns destroy`.

## What's next for thick borg

The other stories in #856 (leave a PaaS for a box, go all-edge on D1, Lambda + DynamoDB, Mongo, Better Auth, one sync engine) get an app each, as this one did. A Hetzner box run of this story is next.
