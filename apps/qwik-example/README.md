# qwik-example

> **What it proves:** a Qwik City app on its own `cloudflare-pages` adapter (a `routeLoader$` and a `routeAction$` reading `platform.env`) is a desktop app with no edits, and `rustybuns init` reads it as it is. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` (`src/routes/index.tsx`) shows `count: N` read from the `COUNTER` KV binding in a `routeLoader$`, and its `<Form>` posts to a `routeAction$` on the same route (`/?qaction=<id>`, Qwik's own form shape), which bumps it; the page renders again with the new count. `src/` is the Qwik starter's four files plus that route and knows nothing about Rusty Buns: `platform.env` is what Qwik City's Cloudflare adapter hands every loader and action, so on the desktop `COUNTER` is a folder under `~/.qwik-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited. The adapter builds the client into `dist/` and writes `dist/_worker.js`, a module Worker over `server/entry.cloudflare-pages.js` (what Pages calls advanced mode, the same shape as SvelteKit's `adapter-cloudflare`), so `main` and `builtMain` are that file, `assets` is `dist`, the build is the two `vite build` passes `qwik build` runs, and a `worker`-mode desktop runs it under Bun. Static files reach the Worker's `env.ASSETS`, which the desktop host backs with the same `dist/`.

```sh
bun run desktop:dev        # both vite builds, then the dev host, then open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about 4 s)
bunx rustybuns plan --offline   # the edge: a Worker, the build, a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt: nothing in Rusty Buns. The Qwik City docs still describe the adapter as writing `functions/[[path]].js` (Pages Functions); since 1.x it writes `dist/_worker.js` instead, so the `wrangler.jsonc` here is a plain Worker (`main` plus `assets`), not a `pages_build_output_dir` one, and `wrangler pages deploy ./dist` keeps working from the same build. Qwik 1.20.3 was two days old when this was written, so the pin is 1.20.2 (the repo's `minimumReleaseAge`); bump it when you touch this.
