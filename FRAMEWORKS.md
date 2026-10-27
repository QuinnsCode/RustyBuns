# Frameworks roadmap

Goal: every supported framework has a sample app in `apps/`. CI builds each one for desktop and plans it for the edge on every PR.

## The core idea

Most frameworks already have a Cloudflare build that outputs a module exporting `default { fetch }`. Desktop `worker` mode mounts exactly that shape, and the host shim answers `cloudflare:workers`. So for most frameworks the same build can serve both the edge and desktop, with no per-framework adapter.

- **Verified:** TanStack Start (probe on Sep 17: SSR, server function, KV persistence, compiled binary).
- **Verified:** Astro 7 with @astrojs/cloudflare 14 (Oct 9: SSR, API route, KV through `cloudflare:workers`, compiled binary, Railway box bundle, deploy). With no adapter it is a static site and `init` writes an `spa` config. `init` adds the `IMAGES` binding the adapter's `/_image` uses unless `imageService` doesn't need it (`compile`, `passthrough`); on the desktop it passes the original image through (Oct 10: `/_image` served from a dev desktop build).
- **Verified:** EmDash, Cloudflare's Astro CMS (Oct 12, blog-cloudflare template, emdash 1.2.0): `init` reads it as Astro and carries over its D1, R2 and cron. On a dev desktop build, setup seeds posts into D1 (sqlite) and images into R2 (a folder), and pages, RSS and `/_emdash/api/media/file/*` serve from them. Setup needs `EMDASH_SITE_URL`. Its sandboxed plugins need Worker Loader, which the template leaves off (the desktop's Worker Loader runs code in-process, without a sandbox, and isn't verified with EmDash). Edge and box are not verified yet.
- **Verified:** React Router 7 on `@cloudflare/vite-plugin` (Oct 12, Cloudflare's `react-router-starter-template`): `init` reads it with no flags, and the dev desktop build serves SSR (a loader reading a wrangler var) and the client assets from `build/client`. The older `cloudflareDevProxy` setup, Remix v2 and the Node server are still refused.
- **Verified:** Create React App and Vue CLI through `rustybuns init --port-vite` (Oct 12). It writes `vite.config.ts`, moves `public/index.html` to the root with a module script, maps `%PUBLIC_URL%` / `<%= BASE_URL %>`, `REACT_APP_*` / `VUE_APP_*` (`loadEnv` + `define`) and Vue's `@` alias, swaps the build scripts, then `init` goes on as a Vite app. It refuses to overwrite `vite.config.ts` or `index.html` without `--force`, and prints what's left by hand (`setupProxy.js`, `vue.config.js`, svgr, `~` imports). Two real apps, no source edits: Flame's client (CRA 5, React 17, TypeScript) and Yacht's frontend (Vue CLI 4, Vue 2 + Vuetify, bumped to Vue 2.7 for `@vitejs/plugin-vue2`). Both `vite build` with no `require()` left in the bundle, and `init` writes an `spa` config. On the way, the port learned to bump `@types/node` below 20 (Vite 7's peer, which stops `npm install`), bundle `require()` in `.tsx`/`.vue` files, and read `<template lang="html">`. Yacht's own install needed `--legacy-peer-deps` and a fresh lockfile (npm 10 crashes on its old one, ported or not). Neither was rendered against its backend. A custom webpack config gets a guided port: a printed list naming its aliases, defines, entries and proxies (read across the files it requires, variables followed), webpack-only features in `src/`, and a draft `vite.config.ts`.
- **Verified (desktop):** SvelteKit on `@sveltejs/adapter-cloudflare` (Oct 14, a minimal app with a `load` and an endpoint): `init` writes a worker-mode config (`.svelte-kit/cloudflare/_worker.js` + the same folder as assets, `vite build`), with or without a wrangler file, and `rustybuns smoke` boots it and gets a 200 from `/`. `adapter-auto` and other adapters are refused. The host installs `caches` when it loads, because SvelteKit's Worker reads `caches.default` while its module evaluates. Not yet checked: form actions, bindings, the compiled binary, the edge.
- **Still to verify:** every other framework below.

## Status key

✅ verified · 🧪 expected to work, needs a sample app · 🔧 needs a small adapter · ⏳ later

## Matrix

| Framework | Desktop mode | Server output to mount | Edge resource (Alchemy v2) | Status |
|---|---|---|---|---|
| Vite + React (SPA) | `spa` | none | `Cloudflare.Worker` + assets | ✅ `apps/spa-example` |
| Vite + Vue (SPA) | `spa` | none | same | 🧪 |
| Vite + Svelte (SPA) | `spa` | none | same | 🧪 |
| Vite + Solid (SPA) | `spa` | none | same | 🧪 |
| RWSDK | `spa` from `init`; `worker` by hand | `dist/worker/index.js` | `Cloudflare.Worker` | ✅ live; 153 of 180 GitHub apps ([coverage](FRAMEWORK_COVERAGE.md#rwsdk)) |
| TanStack Start | `worker` | `dist/server/server.js` | `Cloudflare.Website.Vite` | ✅ desktop, 🧪 edge; 8 of 13 sampled GitHub apps ([coverage](FRAMEWORK_COVERAGE.md#tanstack-start)) |
| SvelteKit | `worker` | adapter-cloudflare: `.svelte-kit/cloudflare/_worker.js` + assets | `Cloudflare.Website.SvelteKit` | ✅ `init`; 🧪 desktop run |
| Astro | `worker` (adapter), `spa` (static) | @astrojs/cloudflare 14: `dist/server/entry.mjs` + `dist/client` | `Cloudflare.Worker` + assets | ✅ `init`, desktop, box and edge (sample app, Oct 9); `apps/astro-example` on the contract, `init` unchanged (Oct 27) |
| Nuxt | `worker` | Nitro `cloudflare-module` preset | `Cloudflare.Website.Nuxt` | 🧪 |
| React Router v7 | `worker` | `@cloudflare/vite-plugin`: `build/server/index.js` + `build/client` | `Cloudflare.Worker` + assets | ✅ `init` and desktop (Cloudflare template, Oct 12); 🔧 `cloudflareDevProxy` |
| SolidStart | `worker` | Nitro CF preset or Vite plugin output | `Cloudflare.Website.Vite` | 🔧 |
| Qwik City | `worker` | `cloudflare-pages` adapter (a Pages Functions shape) | `Cloudflare.Worker` + assets | 🔧 |
| Angular | `worker` | `AngularAppEngine` fetch handler from `@angular/ssr` | `Cloudflare.Worker` + assets | 🔧 |
| Next.js | `worker`, or sidecar | OpenNext `worker.js`; fallback: `standalone` server as a child process | `Cloudflare.Website.Nextjs` | ⏳ |
| Gatsby | `spa` | none: a static site in `public/` | `Cloudflare.Worker` + assets | ⏳ |
| CRA, Vue CLI | `spa` after `init --port-vite` | none | same as Vite | ✅ `init` (Flame, Yacht, Oct 12) |
| Hono, Elysia, itty-router (a plain Worker) | `worker` | none: Alchemy bundles the wrangler `main` | `Cloudflare.Worker` | ✅ `init`, desktop, plan: `apps/hono-example`, `apps/elysia-example` (Oct 27) |
| custom webpack | `spa` after a Vite port by hand | none | same as Vite | ⏳ `init --port-vite` lists what to port and drafts the config |

The server output paths in this table come from each framework's usual layout. Record the real path when you build each sample app.

## Each framework, as the five primitives

The [five primitives](ADOPTION.md#the-five-primitives) are what Rusty Buns gives every target. This table is the other side: the framework feature you'd reach for, and which primitive it lands on. Every row reaches its bindings the same way, through `env` from `cloudflare:workers` or the framework's own handle on it (named below). So storage is D1, KV and R2 on the edge, and sqlite and a folder on the desktop or a box.

Two primitives are the same for every framework because the host owns them. **memory** is the Bun process (or the isolate on the edge). **identity** arrives as `X-User-Id` and `X-User-Name` request headers, which the framework's middleware or loaders read.

Support links to the row in the [matrix](#matrix), and to [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md) once a framework has had a real-app run. Known issues are this repo's open issues for the framework (there are no per-framework labels yet, so it's a name search plus the tracking issues).

| Framework | http | storage | comms | Support | Known issues |
|---|---|---|---|---|---|
| Vite SPAs (React, Vue, Svelte, Solid) | `"use server"` functions, run on the host | `env` from `cloudflare:workers` inside them | a Durable Object class the app exports | ✅ React ([`apps/spa-example`](apps/spa-example)), 🧪 the others: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+vite) |
| RWSDK | `route()` handlers, middleware, `"use server"` functions | `env` from `cloudflare:workers` | Durable Objects, and its realtime layer built on them | ✅ [matrix](#matrix), [153 of 180 apps](FRAMEWORK_COVERAGE.md#rwsdk) | [what still fails](FRAMEWORK_COVERAGE.md#what-still-fails), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+rwsdk) |
| TanStack Start | server routes, `createServerFn` | `env` from `cloudflare:workers` | a Durable Object exported beside the handler | ✅ desktop, 🧪 edge: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+tanstack) |
| Astro, EmDash | pages, API routes (`src/pages/api/*`), Actions, middleware | `env` from `cloudflare:workers`; sessions on a KV binding; `/_image` on `IMAGES`; EmDash's content in D1 and R2 | a Durable Object exported beside the handler | ✅ `init`, desktop, box, edge: [matrix](#matrix) | [#845](https://github.com/QuinnsCode/RustyBuns/issues/845), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+astro) |
| React Router 7 | loaders, actions, resource routes | `context.cloudflare.env` | a Durable Object exported beside the handler | ✅ `init`, desktop; 🔧 `cloudflareDevProxy`: [matrix](#matrix) | [#318](https://github.com/QuinnsCode/RustyBuns/issues/318), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+%22react+router%22) |
| SvelteKit | `+server.ts` endpoints, `load`, form actions | `platform.env` | a Durable Object exported beside the handler | ✅ `init`, 🧪 desktop run: [matrix](#matrix) | [#318](https://github.com/QuinnsCode/RustyBuns/issues/318), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+sveltekit) |
| Nuxt | Nitro `server/api` routes | `event.context.cloudflare.env`; Nitro's `useStorage()` on a KV binding | Nitro WebSocket handlers on a Durable Object | 🧪 [matrix](#matrix) | [#318](https://github.com/QuinnsCode/RustyBuns/issues/318), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+nuxt) |
| SolidStart | API routes, `"use server"` functions | Nitro's `useStorage()`, or `env` from `cloudflare:workers` | Nitro WebSocket handlers | 🔧 [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+solidstart) |
| Qwik City | `routeLoader$`, `routeAction$`, `server$`, endpoints | `platform.env` | a Durable Object in a wrapping Worker | 🔧 [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+qwik) |
| Angular | `AngularAppEngine`'s fetch handler | `env` from `cloudflare:workers` in server code | a Durable Object exported beside the handler | 🔧 [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+angular) |
| Next.js | route handlers, server actions, middleware | OpenNext's `getCloudflareContext().env`; its cache on R2 or KV | a Durable Object exported beside the handler | ⏳ [matrix](#matrix) | [#318](https://github.com/QuinnsCode/RustyBuns/issues/318), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+next.js) |
| Gatsby | none: a static site (its Functions don't build for Workers) | none | none | ⏳ [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+gatsby) |
| CRA, Vue CLI, custom webpack | as a Vite SPA, after `init --port-vite` | as a Vite SPA | as a Vite SPA | ✅ CRA and Vue CLI, ⏳ webpack: [matrix](#matrix) | [#849](https://github.com/QuinnsCode/RustyBuns/issues/849), [#850](https://github.com/QuinnsCode/RustyBuns/issues/850), [#851](https://github.com/QuinnsCode/RustyBuns/issues/851) |

The 🧪, 🔧 and ⏳ rows describe what each framework's Cloudflare build offers, not something Rusty Buns has run. Each row gets checked, and corrected here, when its sample app lands.

## Real apps from GitHub

`scripts/trial-github.ts` boots public apps on each framework in both desktop modes. The numbers are in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md).

## Ranked: what to add next

Easiest first, judged by each framework's Cloudflare build and a `fit` sweep over the five most-starred GitHub repos per framework (Oct 12). `fit` names every one of these, and the ones `init` doesn't read link the issue that tracks them.

| Rank | Framework | Why here |
|---|---|---|
| 1 | Astro, EmDash | Done. 2 of 5 sampled repos are ready as they are; the others are monorepo roots or use `sharp`. |
| 2 | React Router 7 | Done for `@cloudflare/vite-plugin`. Next: `cloudflareDevProxy` apps (2 of 5 sampled), where wrangler bundles `workers/app.ts` over `build/server`. |
| 3 | SvelteKit | `init` reads it (Oct 14). `adapter-cloudflare` builds a module Worker (`.svelte-kit/cloudflare/_worker.js`) plus assets, the shape the desktop already runs. 4 of 5 sampled repos are single apps. |
| 4 | Nuxt | Nitro's `cloudflare-module` preset builds `.output/server/index.mjs` plus `.output/public`. 4 of 5 sampled repos are monorepo roots, so expect `init` to run in a subfolder. |
| 5 | SolidStart | Nitro too (v1) or a Vite plugin (v2), so it follows Nuxt. Most sampled repos are libraries. |
| 6 | Qwik City | Its Cloudflare adapter targets Pages Functions, not a module Worker, so it needs a small wrapper. |
| 7 | Angular | `@angular/ssr`'s `AngularAppEngine` is a fetch handler, but 4 of 5 sampled apps serve it through Express. |
| 8 | Next.js | OpenNext works, but it's the heaviest build, and both sampled apps carry native addons (`sharp`, Prisma). |
| 9 | Gatsby | Static output only, so it fits the `spa` path. The top repos are mostly Gatsby itself or libraries, not apps. |
| 10 | CRA, Vue CLI, webpack | CRA and Vue CLI done: `init --port-vite`. Custom webpack configs are ported by hand from the list it prints (#849), which has been run on AdGuard Home, CyberChef and jellyfin-web. |

## The sample app contract

The check is [`scripts/counter.ts`](scripts/counter.ts): one HTTP journey (no browser) that every example's `test/desktop.test.ts` calls in one line. Done so far: [`apps/hono-example`](apps/hono-example), [`apps/elysia-example`](apps/elysia-example), [`apps/astro-example`](apps/astro-example).

Every `apps/<fw>-example` does the same small thing, so a single smoke test covers them all:

- A KV binding named `COUNTER`.
- A route `/` that renders `<h1 id="count">count: N</h1>`, with N read on the server.
- A `<button>` that increments N through the framework's server mechanism (server function, form action, API route, or `"use server"` for the SPAs), then reloads the page.
- A committed `rustybuns.config.ts` and `wrangler.jsonc`.

Later: add a D1 table with one migration to the contract.

## The smoke test (`scripts/smoke.ts`)

It takes a command that starts the host and passes if all of these hold:

1. A request with no token gets a 403.
2. `/` loads with the token and shows `count: N`.
3. Clicking the button twice makes it `N + 2`.
4. After restarting the host, the page still shows `N + 2`.
5. `crossOriginIsolated` is `true`.

It uses Playwright Chromium and is run against both the dev host and the compiled binary. The binary is started from a temporary directory so a working-tree fallback can't mask a missing embedded asset.

## Phases

### Phase 0: harness
- [ ] Add `framework` to `RustyBunsConfig`, filled in by `init`.
- [ ] Extend the `Framework` type in `infer.ts` with: `sveltekit`, `astro`, `nuxt`, `react-router`, `solidstart`, `nextjs`, `vite-vue`, `vite-svelte`, `vite-solid`.
- [ ] Write `scripts/smoke.ts`.
- [ ] Make the existing `apps/spa-example` follow the contract and pass the smoke test.
- [ ] Set up the CI workflow (below) running only `spa-example`.

### Phase 1: SPA trio
- [ ] `apps/vue-example`, `apps/svelte-example`, `apps/solid-example`.
- [ ] Give `add desktop` a per-framework entry template (`main.ts` using `createApp`, `mount`, or `render`).
- [ ] Verify that `"use server"` proxies resolve in non-React client bundles.

### Phase 2: frameworks that already have a Cloudflare build
- [x] `apps/tanstack-start-example`: TanStack Start on `@cloudflare/vite-plugin` with D1 and KV, `init` unchanged.
- [ ] `apps/sveltekit-example`
- [x] `apps/astro-example`: Astro 7 on `@astrojs/cloudflare` 14 (`output: "server"`, a page and an API route on KV through `cloudflare:workers`), `init` unchanged.
- [ ] `apps/nuxt-example`
- [ ] For each: `init` detects it and writes `worker.builtMain` and `worker.assets` automatically.

### Phase 3: frameworks that need an adapter
- [ ] `apps/react-router-example`, plus a generated entry that wraps the server build in a fetch handler.
- [ ] `apps/solidstart-example`

### Phase 4: Next.js
- [ ] `apps/nextjs-example`. Try the OpenNext `worker.js` in `worker` mode first.
- [ ] If that fails, fall back to the `standalone` server as a sidecar (this reuses the `caps.spawn` work).

### Phase 5: edge column
- [ ] Make `plan` emit `Cloudflare.Website.<Fw>` based on `framework`.
- [ ] Run `plan` on every PR; it needs no credentials to diff.
- [ ] Run a nightly `deploy` → curl the URL → `destroy` against a throwaway Cloudflare account.

### Phase 6: box column
- [ ] Emit `Hetzner.Website.<Fw>` for `targets.box`.

## Done criteria, per framework

- [ ] `init` detects it with no manual config.
- [ ] The smoke test passes on the dev host and on the compiled binary for linux-x64, darwin-arm64, and windows-x64.
- [ ] `plan` succeeds.
- [ ] Its row in the matrix above is ✅.
- [ ] Any limitation is noted in the README.

## CI outline (`.github/workflows/frameworks.yml`)

- **`desktop` job**
  - Matrix: `app` × `os` (ubuntu, macos, windows).
  - Steps: `bun install` → `rustybuns build desktop --dev` → smoke → `rustybuns build desktop` → smoke on the binary → upload the binary as an artifact.
- **`plan` job**
  - Matrix: `app`.
  - Steps: `rustybuns plan`.
- **`deploy-nightly` job**
  - Runs on a schedule only, with Cloudflare secrets.
  - Matrix: `app`.
  - Steps: `deploy --yes` → curl → `destroy`.

Keep the list of apps in one file (`apps/frameworks.json`) so the matrix, the README table, and the docs don't drift apart.