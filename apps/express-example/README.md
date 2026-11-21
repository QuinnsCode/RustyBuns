# express-example

> **What it proves:** an Express server on Postgres, the server half of a Wasp app, runs as a desktop app with no edits: Bun runs Express, and PGlite in the data dir stands in for Postgres. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

Wasp compiles its spec into a React client, an Express server and Prisma on Postgres ([#4101](https://github.com/QuinnsCode/RustyBuns/issues/4101)). This example is that output shape, cut to the [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` shows `count: N` and a form posts to `/increment`. Prisma isn't in it yet; the table is a Prisma Migrate folder (`migrations/0001_init/migration.sql`), so the schema side already reads Prisma's layout.

| Part | What it is | On the desktop |
|---|---|---|
| `server/server.js` | Express on `node:http`, `pg` over `DATABASE_URL`, listening on `PORT` | `desktop.server`: bundled into the binary, run as the host's child, `/` and `/increment` proxied to it |
| `public/` | the client (one stylesheet here) | served by the host |
| `HYPERDRIVE` binding | Postgres | `DATABASE_URL` if set, else PGlite in `~/.express-example/pglite`, with `migrations/` applied at boot; the server gets its URL as `DATABASE_URL` |

There is no edge target: a Worker can't run a `node:http` server. `rustybuns.config.ts` is written by hand, because `init` doesn't read an Express app yet.

```sh
bun run start              # plain Node, against your own DATABASE_URL
bun run desktop:dev        # build the dev host and open it, on PGlite
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`, with `edge: false`.
