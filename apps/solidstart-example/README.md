# solidstart-example

> **What it proves:** a SolidStart 2 app written the way its own template does (the `solidStart()` Vite plugin with Nitro behind it, Nitro's `cloudflare_module` preset, bindings from `cloudflare:workers`) is a desktop app with no edits, and `rustybuns init` reads it as it is. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` (`src/routes/index.tsx`) shows `count: N`, read on the server by a `"use server"` function the route preloads from the `COUNTER` KV binding, and its form posts to `/increment` (`src/routes/increment.ts`, an API route), which bumps it and redirects back. `src/` is SolidStart's template plus those two files, and knows nothing about Rusty Buns. They read `env` from `cloudflare:workers`, as a Worker does; on the desktop that import resolves to the local twins, so KV is a folder under `~/.solidstart-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: `main` and `builtMain` are Nitro's module Worker, `.output/server/index.mjs`, with `.output/public` as assets, `build` is `vite build` (from the `deploy` script), and a `worker`-mode desktop runs that build under Bun.

```sh
bun run desktop:dev        # vite build, then the dev host, then open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about 4 s)
bunx rustybuns plan --offline   # the edge: a Worker, the build, a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt:

- SolidStart's docs still describe v1 (`app.config.ts`, vinxi, `server: { preset }`). v2 is a Vite plugin: `vite.config.ts` with `solidStart()` and `nitro({ preset: "cloudflare_module" })` from `nitro/vite`, and the Nitro build is what makes a Worker of it. Its template pins Node >= 24; Node 22.21 built it fine here.
- Rolldown refuses `import { env } from "cloudflare:workers"` in the server build unless it is external: `environments.ssr.build.rolldownOptions.external: [/^cloudflare:/]` in `vite.config.ts`. (Nitro externalises its own `cloudflare:*` imports, not the app's.)
- Nitro writes its own `.output/server/wrangler.json` and warns that the app's `main` and `assets` are overridden; it keeps the bindings. `wrangler deploy` from the app folder still uses the app's file.
- `bun test` sets `NODE_ENV=test`, and Vite takes any `NODE_ENV` other than `production` to mean a dev build: SolidStart's dev overlay then pulls shiki and every grammar into the Worker, and the build fails on `onig.wasm`. `rustybuns build` now drops a `test` `NODE_ENV` before running the app's build.
- The page is rendered with `createHandler(..., { mode: "async" })` so the count is in the HTML, not streamed in after a Suspense fallback.
