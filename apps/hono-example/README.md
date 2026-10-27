# hono-example

> **What it proves:** a Hono Worker written from Hono's own docs (a `wrangler.jsonc`, one KV binding) is a desktop app with no edits and no adapter. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` shows `count: N` read from the `COUNTER` KV binding, and a form posts to `/increment`, which bumps it and redirects back. `src/` is 20 lines of Hono and knows nothing about Rusty Buns: `c.env.COUNTER` is the Worker's binding, which the desktop host backs with a folder under `~/.hono-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: a plain Worker (Alchemy bundles `src/index.ts` for the edge) and a `worker`-mode desktop that runs the same handler under Bun.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (under a second)
bunx rustybuns plan --offline   # the edge: a Worker and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.
