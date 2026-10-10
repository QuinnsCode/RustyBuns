# spa-example

> **What it proves:** `rustybuns init` can read a real RWSDK app (Workers, D1, KV, R2, Durable Objects, `"use server"` actions) without touching it. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

This is a **test fixture, not an app you run.** It's a small slice of Druids Curse, the live RWSDK game Rusty Buns was first built to box ([druids-curse-votv.notryanquinn.workers.dev](https://druids-curse-votv.notryanquinn.workers.dev)): its real `wrangler.jsonc`, a D1 migration, a world Durable Object with the base class removed, and a few components and actions picked to test the boundary analysis.

`packages/cli/test/glue.test.ts` reads it as text and checks that:

- `infer` finds the framework, source dir, aliases and migrations
- the boundary report sorts files into client (`Pure.tsx`), leaky client (`Leaky.tsx`, which pulls in server code through `Dashboard`), `"use server"` actions (`actions/social/`) and server-only (`db.ts`)
- the `wrangler.jsonc` parses into the same bindings a generated stack would create

It's never built, so it doesn't install rwsdk or the Workers runtime; `types/fixture.d.ts` stubs just enough of them for `src/` to type check.

```sh
bun test packages/cli/test/glue.test.ts     # from the repo root
```

The live game's only D1 database is `druids-curse-votv-db` (the `02a14450…` id in `wrangler.jsonc`). Any `druids-curse-votv-rb-DB-live-*` database on the account is a leftover from an Alchemy deploy that lost its state; four of them were checked for data and deleted in #142.

To see a Workers app with a Durable Object world actually run on the desktop and on Cloudflare, use [hippo-tycoon](../hippo-tycoon/README.md) or [park-hide-seek](../park-hide-seek/README.md).
