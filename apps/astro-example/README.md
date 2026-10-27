# astro-example

> **What it proves:** an Astro site written the way Astro's Cloudflare guide says (`output: "server"`, `@astrojs/cloudflare`, bindings from `cloudflare:workers`) is a desktop app with no edits, and `rustybuns init` reads it as it is. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` (`src/pages/index.astro`) shows `count: N` read from the `COUNTER` KV binding, and its form posts to `/increment` (`src/pages/increment.ts`, an API route), which bumps it and redirects back. `src/` is two small files and knows nothing about Rusty Buns. They read `env` from `cloudflare:workers`, as a Worker does; on the desktop that import resolves to the local twins, so KV is a folder under `~/.astro-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc` and `astro.config.mjs`, unedited: `main` is the adapter's entrypoint, `build` is `astro build`, `builtMain` is `dist/server/entry.mjs` with `dist/client` as assets, and a `worker`-mode desktop runs that build under Bun. `init` also adds the `SESSION` KV binding the adapter keeps sessions in. The config sets `imageService: "passthrough"`, so no `IMAGES` binding is needed.

```sh
bun run desktop:dev        # astro build, then the dev host, then open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about 10 s, most of it astro build)
bunx rustybuns plan --offline   # the edge: a Worker, the build, two KV namespaces, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt: Astro 7.4 refuses to build on Node older than 22.23.4 (`astro build` runs under Node, not Bun), newer than CI's runners carry, so this example pins Astro 7.3.5 with adapter 14.3.1 (Node >= 22.12). Bump both together once CI's Node moves.
