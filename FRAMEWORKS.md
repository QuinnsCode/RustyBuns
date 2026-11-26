# Frameworks roadmap

Goal: every supported framework has a sample app in [`apps/frameworks/`](apps/frameworks/README.md), a level down from the apps people play with. CI builds each one for desktop and plans it for the edge on every PR.

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

One row per framework. Every ✅ example below runs the [sample app contract](#the-sample-app-contract) in CI on every PR that touches it.

| Framework | Desktop mode | Server output to mount | Edge resource (Alchemy v2) | Status |
|---|---|---|---|---|
| Vite + React (SPA) | `spa` | none | `Cloudflare.Worker` + assets | ✅ `init` ([`apps/frameworks/spa-example`](apps/frameworks/spa-example), a fixture read as text) |
| Vite + Vue, Svelte, Solid (SPA) | `spa` | none | static assets only (desktop-only without RWSDK) | ✅ [`apps/frameworks/vue-spa-example`](apps/frameworks/vue-spa-example), [`apps/frameworks/svelte-spa-example`](apps/frameworks/svelte-spa-example), [`apps/frameworks/solid-spa-example`](apps/frameworks/solid-spa-example) on the contract, desktop |
| RWSDK | `spa` from `init`; `worker` by hand | `dist/worker/index.js` | `Cloudflare.Worker` | ✅ live; 153 of 180 GitHub apps ([coverage](FRAMEWORK_COVERAGE.md#rwsdk)) |
| TanStack Start | `worker` | `dist/server/server.js` | `Cloudflare.Website.Vite` | ✅ desktop ([`apps/frameworks/tanstack-start-example`](apps/frameworks/tanstack-start-example), D1 + KV, its own journey), 🧪 edge; 8 of 13 sampled GitHub apps ([coverage](FRAMEWORK_COVERAGE.md#tanstack-start)) |
| Astro | `worker` (adapter), `spa` (static) | @astrojs/cloudflare 14: `dist/server/entry.mjs` + `dist/client` | `Cloudflare.Worker` + assets | ✅ `init`, desktop, box and edge (Oct 9); [`apps/frameworks/astro-example`](apps/frameworks/astro-example) on the contract |
| SvelteKit | `worker` | adapter-cloudflare: `.svelte-kit/cloudflare/_worker.js` + assets | `Cloudflare.Worker` + assets | ✅ `init`, desktop with a form action and KV: [`apps/frameworks/sveltekit-example`](apps/frameworks/sveltekit-example) |
| Nuxt | `worker` | Nitro `cloudflare-module` preset: `.output/server/index.mjs` + `.output/public` | `Cloudflare.Worker` + assets | ✅ `init` and desktop: [`apps/frameworks/nuxt-example`](apps/frameworks/nuxt-example); 🧪 edge |
| React Router v7 | `worker` | `@cloudflare/vite-plugin`: `build/server/index.js` + `build/client` | `Cloudflare.Worker` + assets | ✅ `init` and desktop: [`apps/frameworks/react-router-example`](apps/frameworks/react-router-example); 🔧 `cloudflareDevProxy` |
| SolidStart | `worker` | SolidStart 2 (a Vite plugin) on Nitro 3's `cloudflare_module` preset: `.output/server/index.mjs` + `.output/public` | `Cloudflare.Worker` + assets | ✅ `init`, desktop: [`apps/frameworks/solidstart-example`](apps/frameworks/solidstart-example) |
| Qwik City | `worker` | `cloudflare-pages` adapter: `dist/_worker.js` (a module Worker over `server/entry.cloudflare-pages.js`) + `dist` | `Cloudflare.Worker` + assets | ✅ `init` and desktop: [`apps/frameworks/qwik-example`](apps/frameworks/qwik-example); 🧪 edge |
| Next.js | `worker` | `@opennextjs/cloudflare`: `.open-next/worker.js` + `.open-next/assets` | `Cloudflare.Worker` + assets | ✅ `init` and desktop: [`apps/frameworks/nextjs-example`](apps/frameworks/nextjs-example). vinext is the other route: [a soft try](#nextjs-on-vinext-a-soft-try). |
| Hono, Elysia, itty-router (a plain Worker) | `worker` | none: Alchemy bundles the wrangler `main` | `Cloudflare.Worker` | ✅ `init`, desktop: [`apps/frameworks/hono-example`](apps/frameworks/hono-example), [`apps/frameworks/elysia-example`](apps/frameworks/elysia-example); a real Elysia app: [`apps/frameworks/elysia-conduit`](apps/frameworks/elysia-conduit) |
| Express (and Wasp's server, which is Express) | `spa` with `desktop.server` | none: Bun bundles the server into the binary | none: a Worker can't run `node:http` | ✅ desktop on Postgres (PGlite): [`apps/frameworks/express-example`](apps/frameworks/express-example), written by hand (no `init` yet) |
| CRA, Vue CLI | `spa` after `init --port-vite` | none | same as Vite | ✅ `init` (Flame, Yacht, Oct 12) |
| custom webpack | `spa` after a Vite port by hand | none | same as Vite | ⏳ `init --port-vite` lists what to port and drafts the config |
| Angular | `worker` | `AngularAppEngine` fetch handler from `@angular/ssr` | `Cloudflare.Worker` + assets | ⛔ out of scope for `init`: [why](#out-of-scope-angular-and-gatsby) |
| Gatsby | `spa` | none: a static site in `public/` | `Cloudflare.Worker` + assets | ⛔ out of scope for `init`: [why](#out-of-scope-angular-and-gatsby) |

The server output paths come from each example's real build. "Edge" in the status means a real deploy was checked; the contract's step 5 checks every example's generated stack, which is the plan, not a deploy.

## Each framework, as the five primitives

The [five primitives](ADOPTION.md#the-five-primitives) are what Rusty Buns gives every target. This table is the other side: the framework feature you'd reach for, and which primitive it lands on. Every row reaches its bindings the same way, through `env` from `cloudflare:workers` or the framework's own handle on it (named below). So storage is D1, KV and R2 on the edge, and sqlite and a folder on the desktop or a box.

Two primitives are the same for every framework because the host owns them. **memory** is the Bun process (or the isolate on the edge). **identity** arrives as `X-User-Id` and `X-User-Name` request headers, which the framework's middleware or loaders read.

Support links to the row in the [matrix](#matrix), and to [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md) once a framework has had a real-app run. Known issues are this repo's open issues for the framework (there are no per-framework labels yet, so it's a name search plus the tracking issues).

| Framework | http | storage | comms | Support | Known issues |
|---|---|---|---|---|---|
| Vite SPAs (React, Vue, Svelte, Solid) | `"use server"` functions, run on the host | `env` from `cloudflare:workers` inside them | a Durable Object class the app exports | ✅ React ([`apps/frameworks/spa-example`](apps/frameworks/spa-example)), ✅ Vue, Svelte, Solid on the contract, desktop-only: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+vite) |
| RWSDK | `route()` handlers, middleware, `"use server"` functions | `env` from `cloudflare:workers` | Durable Objects, and its realtime layer built on them | ✅ [matrix](#matrix), [153 of 180 apps](FRAMEWORK_COVERAGE.md#rwsdk) | [what still fails](FRAMEWORK_COVERAGE.md#what-still-fails), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+rwsdk) |
| TanStack Start | server routes, `createServerFn` | `env` from `cloudflare:workers` | a Durable Object exported beside the handler | ✅ desktop, 🧪 edge: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+tanstack) |
| Astro, EmDash | pages, API routes (`src/pages/api/*`), Actions, middleware | `env` from `cloudflare:workers`; sessions on a KV binding; `/_image` on `IMAGES`; EmDash's content in D1 and R2 | a Durable Object exported beside the handler | ✅ `init`, desktop, box, edge: [matrix](#matrix) | [#845](https://github.com/QuinnsCode/RustyBuns/issues/845), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+astro) |
| React Router 7 | loaders, actions, resource routes | `context.cloudflare.env` | a Durable Object exported beside the handler | ✅ `init`, desktop; 🔧 `cloudflareDevProxy`: [matrix](#matrix) | [#2455](https://github.com/QuinnsCode/RustyBuns/issues/2455), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+%22react+router%22) |
| SvelteKit | `+server.ts` endpoints, `load`, form actions | `env` from `cloudflare:workers` (Kit 3 on adapter-cloudflare 8; `platform.env` before) | a Durable Object exported beside the handler | ✅ `init` and desktop ([`apps/frameworks/sveltekit-example`](apps/frameworks/sveltekit-example), Oct 27): [matrix](#matrix) | [#2455](https://github.com/QuinnsCode/RustyBuns/issues/2455), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+sveltekit) |
| Nuxt | Nitro `server/api` routes | `event.context.cloudflare.env`; Nitro's `useStorage()` on a KV binding | Nitro WebSocket handlers on a Durable Object | ✅ [matrix](#matrix) | [#2455](https://github.com/QuinnsCode/RustyBuns/issues/2455), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+nuxt) |
| SolidStart | API routes, `"use server"` functions | `env` from `cloudflare:workers` (Nitro's `useStorage()` untried) | Nitro WebSocket handlers | ✅ `init`, desktop: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+solidstart) |
| Qwik City | `routeLoader$`, `routeAction$`, `server$`, endpoints | `platform.env` | a Durable Object exported beside the handler | ✅ `init`, desktop: [matrix](#matrix) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+qwik) |
| Angular | `AngularAppEngine`'s fetch handler | `env` from `cloudflare:workers` in server code | a Durable Object exported beside the handler | ⛔ [out of scope](#out-of-scope-angular-and-gatsby) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+angular) |
| Next.js | route handlers, server actions, middleware | OpenNext's `getCloudflareContext().env`; its cache on R2 or KV | a Durable Object exported beside the handler | ✅ [matrix](#matrix), with `@opennextjs/cloudflare` | [#2455](https://github.com/QuinnsCode/RustyBuns/issues/2455), [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+next.js) |
| Gatsby | none: a static site (its Functions don't build for Workers) | none | none | ⛔ [out of scope](#out-of-scope-angular-and-gatsby) | [search](https://github.com/QuinnsCode/RustyBuns/issues?q=is%3Aissue+is%3Aopen+gatsby) |
| Express, Wasp's server | Express routes, as the app's own server beside the host | Postgres from `DATABASE_URL`: the app's, or PGlite in the data dir (a `hyperdrive` binding with `local: "pglite"`) | none yet | ✅ desktop: [matrix](#matrix) | [#5520](https://github.com/QuinnsCode/RustyBuns/issues/5520) |
| CRA, Vue CLI, custom webpack | as a Vite SPA, after `init --port-vite` | as a Vite SPA | as a Vite SPA | ✅ CRA and Vue CLI, ⏳ webpack: [matrix](#matrix) | [#849](https://github.com/QuinnsCode/RustyBuns/issues/849), [#850](https://github.com/QuinnsCode/RustyBuns/issues/850), [#851](https://github.com/QuinnsCode/RustyBuns/issues/851) |

The 🧪, 🔧 and ⏳ rows describe what each framework's Cloudflare build offers, not something Rusty Buns has run. Each row gets checked, and corrected here, when its sample app lands.

## Next.js on vinext: a soft try

[vinext](https://github.com/cloudflare/vinext) 1.4.0 reimplements the Next.js App Router as a Vite plugin, the other Cloudflare route besides OpenNext. A throwaway copy of `apps/frameworks/nextjs-example` (Oct 28) took the same `app/` folder, with `getCloudflareContext()` swapped for the binding object from `cloudflare:workers` and a `vite.config.ts` with `vinext()` plus `@cloudflare/vite-plugin`:

- `vinext build` finished in about 15 s and wrote `dist/server/index.js` (a module Worker), `dist/server/wrangler.json` and `dist/client`.
- `wrangler dev -c dist/server/wrangler.json` served `/` (200, server-rendered with the KV read) and `POST /increment` (303 back to `/`).
- Not tried: the desktop host, the compiled binary, a deploy, or a real app. It needs Vite 8, `@vitejs/plugin-rsc` and `react-server-dom-webpack` beside React 19.3.

So the build output is the shape the desktop already mounts. `init` still reads Next.js only with `@opennextjs/cloudflare`; teaching it vinext (a `vinext` dependency, `dist/server/index.js` plus `dist/client`) is a follow-up if people ask.

## Rat Stack: our toolchain, so install less

[Rat Stack](https://github.com/joelhooks/rat-stack) is a pnpm monorepo on Effect 4, XState, Alchemy 2 and varlock: the stack Rusty Buns prefers. Its web app (`apps/web`) is a Vite app, so `init` reads it as `vite`, and `fit` names it "Rat Stack (Vite)".

It already pins its own Alchemy and Effect (2.0.0-beta.87 and 4.1.4 in Nov 2026, the same as ours since #3436). So when an app lists both `alchemy` and `effect` at exact versions on the same majors as the pinned set (any app on this toolchain, not only Rat Stack), `rustybuns add deploy`:

- keeps those versions and writes no `overrides` (the pinned set would downgrade them);
- installs only the deploy packages the app lacks, at its own Alchemy and Effect versions (`--dry-run` shows the list, or "nothing to install");
- and `plan`/`deploy` then run that Alchemy instead of asking to re-pin.

A range (`^2.0.0-beta.87`), a pnpm `catalog:` or another major still gets the pinned set.

### A real clone (Nov 23, rat-stack `4869d23`)

Run on the builder Mac in a sandbox (empty HOME, dead Cloudflare creds), from `apps/web` ([#4803](https://github.com/QuinnsCode/RustyBuns/issues/4803)):

- **`init`** reads it as a Vite app and writes the desktop target plus a static Worker from `dist/web`. It used to pick npm, because the lockfile sits at the workspace root, and `add deploy` would then have run `npm i` inside a pnpm workspace. `init` now takes a workspace member's package manager from its root, so the build is `pnpm exec vite build` and `add deploy` runs `pnpm add -D`.
- **`add deploy --dry-run`** keeps alchemy 2.0.0-beta.87 and effect 4.1.4, writes no overrides, and lists only what is missing: the Hetzner, Railway, Neon and frontend-frameworks providers plus `@effect/platform-bun`. The real `add deploy` installs them in about 15 s and adds `plan` and `deploy` scripts.
- **`plan --offline`** loads our generated stack on Rat Stack's own beta.87 (typecheck 0.15 s, worker build 32 s): `+ Build`, `+ Worker`, 2 to create. No upper bound is needed on the own-pins rule.
- **`build desktop --dev`** builds (client build 31 s), and `run desktop` serves on 127.0.0.1.
- **What it took first.** The worker build fails on a fresh clone until Rat Stack's own content steps have run, because `apps/web` imports files that `apps/site` generates: `pnpm sources:fetch`, `pnpm --filter @rat-stack/capability build`, and `pnpm --filter @rat-stack/site generate` (its `predev`, and what turbo runs before `build`). On a shallow clone of that commit, `generate` also wanted `git fetch --unshallow` and `pnpm git-snapshot`. `init` doesn't infer these steps yet ([#5766](https://github.com/QuinnsCode/RustyBuns/issues/5766)).
- **`rustybuns smoke apps/web`** stops at install: it copies only the member, so the `workspace:*` deps don't resolve ([#5768](https://github.com/QuinnsCode/RustyBuns/issues/5768)).
- **Not on the office Mac.** Rat Stack's worker build (14 workspace packages, then vite) froze the 16 GB office Mac twice. Run it on the builder.

**Should `init` read `apps/infra/alchemy.run.ts`? No.** That stack is the whole project's cloud footprint: the `ratstack.sh` zone, DNS and mail records, email routing, four Workers, a Turbo cache and its own state store. Its `Website` is `Cloudflare.Website.Foldkit`, with server rendering and a service binding to the RPC backend. Taking it over would point `rustybuns deploy` at production DNS and mail. Rat Stack deploys itself (`pnpm deploy:*`, `pnpm infra:*`). What Rusty Buns adds is the desktop host. Our own static Worker from `dist/web` is a preview only: it has no server renderer and no `/rpc`, and it would upload `dist/web/server/` (the server bundle) as public files ([#5767](https://github.com/QuinnsCode/RustyBuns/issues/5767)).

## Out of scope: Angular and Gatsby

Both stay named in `stackOf()` (so `fit` says what they are) and neither gets an `init` reader.

- **Angular.** `@angular/ssr`'s `AngularAppEngine` is a fetch handler, but the Angular CLI builds it with its own esbuild pipeline and has no Cloudflare target, and the sampled apps serve it through Express (`node:http`), which no Worker runs. `init` would have to write the app's Worker entry, so it has nothing to infer. An Angular app that already has a Worker entry is read as a plain Cloudflare Worker.
- **Gatsby.** It builds a static site into `public/`. Its Functions and SSR don't build for Workers, and the top repos are Gatsby itself or libraries. A built `public/` folder is boxed as a static site already, so `init` adds nothing.

Reopen either if a real app asks and a sample app can be written on the contract.

## Beside Rusty Buns: RWSDK, Elysia and Wasp

Rusty Buns sits under a framework: it never edits `src/`, and `git rm` takes it out. These three are the frameworks people ask about most. Each one sits at a different distance from us.

| | What it is | How it fits | What `init` reads today |
|---|---|---|---|
| RWSDK | A React framework for Cloudflare, shipped as a Vite plugin | An input, not a rival: the app shape Rusty Buns was first built to box. RWSDK stops at Cloudflare and Miniflare; we take the same app to a desktop file and a rented box. Its Queues, Cron and outgoing Email have local twins ([five primitives](#each-framework-as-the-five-primitives)); incoming mail does not | `spa` from `init`, `worker` by hand; [153 of 180 GitHub apps](FRAMEWORK_COVERAGE.md#rwsdk) boot unchanged |
| Elysia | A Bun-first server framework that is also a `fetch` handler | Like Hono: a Worker already, so we mount `app.fetch` | `worker` mode with no client build, since `elysia` is one of the fetch servers it looks for ([`apps/frameworks/elysia-example`](apps/frameworks/elysia-example)). A real app runs on the desktop on PGlite but not on Workers yet ([coverage](FRAMEWORK_COVERAGE.md#elysia), [#2285](https://github.com/QuinnsCode/RustyBuns/issues/2285)) |
| Wasp | A framework with its own spec file that a compiler turns into a React client, an Express server and Prisma | Same aim, opposite method: Wasp owns the app's structure and picks Node, Prisma and Postgres; we own none of the code and pick the Cloudflare shapes. It has no Workers or desktop target of its own | Nothing Wasp-specific. A Wasp project (a `main.wasp` beside a `package.json` with `react` and `vite`) reads as a plain Vite React SPA, so `init` would box the client without Wasp's server. The server half, Express on Postgres, runs by hand: [`apps/frameworks/express-example`](apps/frameworks/express-example). Reading `main.wasp`: [#5520](https://github.com/QuinnsCode/RustyBuns/issues/5520) (back burner) |

Auth UI, background jobs and email stay with the framework. That is the part of "full-stack" that Wasp builds in and Rusty Buns leaves out ([ADOPTION.md](ADOPTION.md#the-five-primitives)).

## Real apps from GitHub

`scripts/trial-github.ts` boots public apps on each framework in both desktop modes. The numbers are in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md).

## Ranked: what to add next

Judged by each framework's Cloudflare build and a `fit` sweep over the five most-starred GitHub repos per framework (Oct 12). `fit` names every one of these, and the ones `init` doesn't read link the issue that tracks them. Ranks 1 to 6 and 8 are done; what's left is in each row.

| Rank | Framework | Where it stands |
|---|---|---|
| 1 | Astro, EmDash | Done. 2 of 5 sampled repos are ready as they are; the others are monorepo roots or use `sharp`. |
| 2 | React Router 7 | Done for `@cloudflare/vite-plugin`. Next: `cloudflareDevProxy` apps (2 of 5 sampled), where wrangler bundles `workers/app.ts` over `build/server`. |
| 3 | SvelteKit | Done. `adapter-auto` and other adapters are refused. |
| 4 | Nuxt | Done. 4 of 5 sampled repos are monorepo roots, so expect `init` to run in a subfolder. |
| 5 | SolidStart | Done (SolidStart 2 on Nitro 3). Most sampled repos are libraries. |
| 6 | Qwik City | Done. Since 1.x its `cloudflare-pages` adapter builds a module Worker, so no wrapper was needed. |
| 7 | Angular | Out of scope for `init` ([why](#out-of-scope-angular-and-gatsby)). |
| 8 | Next.js | Done on OpenNext. The sampled real apps carry native addons (`sharp`, Prisma), so the next step is a real one. |
| 9 | Gatsby | Out of scope for `init` ([why](#out-of-scope-angular-and-gatsby)). |
| 10 | CRA, Vue CLI, webpack | CRA and Vue CLI done: `init --port-vite`. Custom webpack configs are ported by hand from the list it prints (#849). |

## The happy path

What any framework app walks through to run on Rusty Buns, and the check that proves each step. A new framework is "in" when its example walks the whole path in CI with no hand edits to what `init` wrote.

| Step | Command | What proves it, and where it runs |
|---|---|---|
| 1. Read the app | `rustybuns init` | `init` writes `rustybuns.config.ts` from the app's own files. Unit tests in `packages/cli/test` per framework reader. |
| 2. Desktop, dev host | `rustybuns build desktop --dev` | **Tier 1** ([`scripts/boot.ts`](scripts/boot.ts)): builds it, boots it on the local twins, token gate, `/` is 200, cross-origin isolated. Every PR, each app with `boot: true` in `scripts/ci-apps.ts`. |
| 3. The app's own server works | the contract below | [`scripts/counter.ts`](scripts/counter.ts): a write through the framework's server mechanism lands in KV and survives a restart. Every PR, in each example's `test/desktop.test.ts`. |
| 4. The edge plan | `rustybuns plan` | The same journey's step 5: the generated stack declares the Worker and `COUNTER`. No account, under a second. |
| 5. The compiled binary | `rustybuns build desktop` | `boot.ts --bin` on each target's own runner, for apps with `bootOn` in `scripts/ci-apps.ts` (one app so far). |
| 6. A real deploy | `rustybuns deploy` | **Tier 2**: [`borg-edge.yml`](.github/workflows/borg-edge.yml), nightly, slim borg only, off until the owner turns it on ([apps/borg](apps/borg/README.md)). |
| 7. Strangers' apps | `rustybuns smoke <dir>` | One app, sandboxed, on a throwaway copy. Many: [`scripts/trial-github.ts`](scripts/trial-github.ts), scored in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md). |

Steps 1 to 4 are free and run on every PR. Steps 5 and 6 are where the gaps are.

## The sample app contract

The check is [`scripts/counter.ts`](scripts/counter.ts): one HTTP journey (no browser) that every example's `test/desktop.test.ts` calls in one line. On it: [`apps/frameworks/hono-example`](apps/frameworks/hono-example), [`apps/frameworks/elysia-example`](apps/frameworks/elysia-example), [`apps/frameworks/astro-example`](apps/frameworks/astro-example), [`apps/frameworks/react-router-example`](apps/frameworks/react-router-example), [`apps/frameworks/sveltekit-example`](apps/frameworks/sveltekit-example), [`apps/frameworks/nuxt-example`](apps/frameworks/nuxt-example), [`apps/frameworks/solidstart-example`](apps/frameworks/solidstart-example), [`apps/frameworks/qwik-example`](apps/frameworks/qwik-example), [`apps/frameworks/nextjs-example`](apps/frameworks/nextjs-example), and the client-only SPAs [`apps/frameworks/svelte-spa-example`](apps/frameworks/svelte-spa-example), [`apps/frameworks/vue-spa-example`](apps/frameworks/vue-spa-example) and [`apps/frameworks/solid-spa-example`](apps/frameworks/solid-spa-example) (`counterJourney` with `spa`: the count is in a `"use server"` action, and there is no edge step, because without RWSDK they are desktop-only), and [`apps/frameworks/express-example`](apps/frameworks/express-example) (`edge: false`: an Express server on PGlite, so its count is a Postgres row, not KV).

Every `apps/<fw>-example` does the same small thing, so one journey covers them all:

- A KV binding named `COUNTER`.
- A route `/` that renders `<h1 id="count">count: N</h1>`, with N read on the server.
- A `<form method="post">` that increments N through the framework's server mechanism (server function, form action, API route), then reloads the page.
- A committed `rustybuns.config.ts` and `wrangler.jsonc`, both as `init` wrote them.

The journey, in order: no token is a 403; `/` shows `count: 0` on a fresh data dir; two posts make it `count: 2`; after a restart on the same data dir it is still 2; and `rustybuns generate` writes a stack with a `Cloudflare.Worker` and the `COUNTER` namespace.

CI runs it on the dev host. Every few days, [`scripts/framework-check.ts`](scripts/framework-check.ts) runs it on each example's compiled binary (`--binary`, on the builder), takes the README thumbnail from the page in headless Chrome (`--shots`, which fails if the page throws), and prints what a deploy would create (`--plan`, offline, read only).

## Adding a framework

1. Copy the nearest example: `apps/frameworks/hono-example` for a plain Worker, `apps/frameworks/nuxt-example` for a built Worker plus assets, `apps/frameworks/svelte-spa-example` for a client-only SPA. For a Vite SPA with `"use server"` modules, `init` adds the boundary plugin to `vite.config.ts` and `rustybuns boundary` before its web build ([that README](apps/frameworks/svelte-spa-example/README.md#what-init-wires-in-for-the-action)).
2. Swap in the framework's starter, build the counter page and its form, and run `rustybuns init`. If `init` gets it wrong, fix `init` (with a test in `packages/cli/test`), not the config. A framework whose Cloudflare build writes the Worker and its assets (Nuxt, SolidStart, Qwik City, Next.js) is one row in `BUILT_WORKERS` (`packages/cli/src/index.ts`): the built Worker, its assets folder and the Worker build.
3. `test/desktop.test.ts` is one line: `test("...", () => counterJourney(join(import.meta.dir, "..")))`.
4. A row in `scripts/ci-apps.ts` with `test: "bun test test"` and `boot: true`, so tier 1 and the journey run on every PR that touches it.
5. A README that opens with "What it proves", a row in the [matrix](#matrix) and the [five primitives](#each-framework-as-the-five-primitives) table, then `bun run docs`.

## What's left

- **The compiled binary per framework**, and a screenshot for the README gallery: [#3341](https://github.com/QuinnsCode/RustyBuns/issues/3341) (a job for Bob).
- **A deploy per framework example**, not just slim borg: [#4790](https://github.com/QuinnsCode/RustyBuns/issues/4790).
- **D1 in the contract**: one table and one migration beside `COUNTER` ([#4790](https://github.com/QuinnsCode/RustyBuns/issues/4790) too, since a deploy is where a migration can go wrong).
- **Angular, bigger real apps, coverage numbers for the newer frameworks**: [#2455](https://github.com/QuinnsCode/RustyBuns/issues/2455).
- **Wasp**: [#5520](https://github.com/QuinnsCode/RustyBuns/issues/5520) (back burner). Its server half (Express on Postgres) runs: [`apps/frameworks/express-example`](apps/frameworks/express-example). Left: Prisma in that server, `init` reading `main.wasp`, then a `trial-github.ts` run of real Wasp apps. Where it stands beside RWSDK and Elysia: [Beside Rusty Buns](#beside-rusty-buns-rwsdk-elysia-and-wasp).
- **Elysia on Workers, and a `trial-github.ts` sweep**: [#2285](https://github.com/QuinnsCode/RustyBuns/issues/2285) (back burner).
- **More of Alchemy** (its test harness against preview stages, previews, rollout): [#2328](https://github.com/QuinnsCode/RustyBuns/issues/2328).
- **A faster loop for trials**: [#2329](https://github.com/QuinnsCode/RustyBuns/issues/2329); Bob, the builder Mac, is set up ([#3448](https://github.com/QuinnsCode/RustyBuns/issues/3448)).
- **`plan` emitting `Cloudflare.Website.<Fw>`** and a box column: [#4790](https://github.com/QuinnsCode/RustyBuns/issues/4790) too (every example plans as `Cloudflare.Worker` plus assets today, which deploys).
