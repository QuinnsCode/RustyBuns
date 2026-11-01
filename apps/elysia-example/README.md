# elysia-example

> **What it proves:** an Elysia Worker written the way Elysia's Cloudflare guide says (`aot: false`, bindings from `cloudflare:workers`) is a desktop app with no edits, and `rustybuns init` now reads it. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` shows `count: N` read from the `COUNTER` KV binding, and a form posts to `/increment`, which bumps it and redirects back. `src/` is 26 lines of Elysia and knows nothing about Rusty Buns. It reads `env` from `cloudflare:workers`, as a Worker does; on the desktop that import resolves to the local twins, so KV is a folder under `~/.elysia-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: a plain Worker (Alchemy bundles `src/index.ts` for the edge) and a `worker`-mode desktop that runs the same handler under Bun. Before this example `init` refused Elysia apps ([#2274](https://github.com/QuinnsCode/RustyBuns/issues/2274)); a wrangler `main` with no Vite config is now read as a Worker.

Two things from Elysia's own Cloudflare guide, and nothing else: `new Elysia({ aot: false })` because Workers forbid the compiler's `new Function`, and `export default { fetch: (req) => app.fetch(req) }` because Elysia's handler takes the request alone. The bigger Elysia app, [elysia-conduit](../elysia-conduit/RUSTYBUNS.md), skips both and so runs on the desktop only; [#2278](https://github.com/QuinnsCode/RustyBuns/issues/2278) lists what it would take.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (under a second)
bunx rustybuns plan --offline   # the edge: a Worker and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`.
