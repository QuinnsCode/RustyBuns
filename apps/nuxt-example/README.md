# nuxt-example

> **What it proves:** a Nuxt 4 app set up the way Nuxt's own Cloudflare docs say (Nitro's `cloudflare-module` preset, a `wrangler.jsonc`, one KV binding) is a desktop app with no edits and no adapter: `rustybuns init` reads it, and the desktop host runs the Worker Nitro built. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` (`app/pages/index.vue`) shows `count: N`, fetched during server rendering from `server/api/count.get.ts`, which reads the `COUNTER` KV binding through `event.context.cloudflare.env`. A plain `<form method="post">` posts to `server/api/increment.post.ts`, which bumps the count and redirects (303) back to `/`. Nothing here knows about Rusty Buns; the desktop host backs the binding with a folder under `~/.nuxt-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: `nuxt build` runs first, then `.output/server/index.mjs` is the Worker (`builtMain`) and `.output/public` its assets, and the `worker`-mode desktop runs that same bundle under Bun.

```sh
bun run desktop:dev        # nuxt build, then the dev host opens
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about 10 s, mostly nuxt build)
bunx rustybuns plan --offline   # the edge: a Worker (with assets) and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt: nothing in the host. Nitro's bundle imports `cloudflare:workers` and `node:*` modules, and the desktop host already shims those. The one snag is the repo's `bunfig.toml` (`minimumReleaseAge`, three days), which is why `nuxt` is pinned one patch behind the newest release.
