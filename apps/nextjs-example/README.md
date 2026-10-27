# nextjs-example

> **What it proves:** a Next.js 16 app set up the way OpenNext's Cloudflare docs say (`@opennextjs/cloudflare`, an `open-next.config.ts`, a `wrangler.jsonc`, one KV binding) is a desktop app with no edits and no adapter of ours: `rustybuns init` reads it, and the desktop host runs the Worker OpenNext built. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` (`app/page.tsx`, `force-dynamic`) shows `count: N`, read during server rendering from the `COUNTER` KV binding through OpenNext's own `getCloudflareContext().env`. A plain `<form method="post">` posts to the route handler in `app/increment/route.ts`, which bumps the count and redirects (303) back to `/`. Nothing here knows about Rusty Buns; the desktop host backs the binding with a folder under `~/.nextjs-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: `opennextjs-cloudflare build` runs first (it runs `next build` itself), then `.open-next/worker.js` is the Worker (`builtMain`) and `.open-next/assets` its static files, and the `worker`-mode desktop runs that same bundle under Bun.

```sh
bun run desktop:dev        # the OpenNext build, then the dev host opens
bun run desktop:build      # one binary in dist/ (90 MB for darwin-arm64: Bun, the Next.js server bundle and the assets)
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about 20 s, mostly next build)
bunx rustybuns plan --offline   # the edge: a Worker (with assets) and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt: nothing in the host. OpenNext's bundle imports `node:*` modules, reads `globalThis.process` and expects `nodejs_compat`, and the desktop host already provides those; `getCloudflareContext()` works because the bundle fills it from the `env` the host hands the fetch handler. The snags were all on the Next.js side:

- `opennextjs-cloudflare build` runs the app's `build` script to get `next build` done. Point that script at `opennextjs-cloudflare build` and it forks itself forever, so here `build` is `next build` and OpenNext's command is the Worker build in `rustybuns.config.ts` (`init` writes it that way).
- `next build` type-checks everything `tsconfig.json` includes. `test/` imports `scripts/counter.ts`, which Next's `lib` can't type (no `ReadableStream` async iterator), so `tsconfig.json` excludes `test/` and the repo's `tsconfig.check.json` checks it instead. Next also wants `@types/node` installed and rewrites `jsx` to `react-jsx` on first build.
- `@opennextjs/cloudflare` 1.20 asks for `wrangler ^4.148`; the repo pins 4.141, which only warns. The build does not use wrangler.
