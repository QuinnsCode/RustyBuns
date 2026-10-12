# Frameworks roadmap

Goal: every supported framework has a sample app in `apps/`. CI builds each one for desktop and plans it for the edge on every PR.

## The core idea

Most frameworks already have a Cloudflare build that outputs a module exporting `default { fetch }`. Desktop `worker` mode mounts exactly that shape, and the host shim answers `cloudflare:workers`. So for most frameworks the same build can serve both the edge and desktop, with no per-framework adapter.

- **Verified:** TanStack Start (probe on Sep 17: SSR, server function, KV persistence, compiled binary).
- **Verified:** Astro 7 with @astrojs/cloudflare 14 (Oct 9: SSR, API route, KV through `cloudflare:workers`, compiled binary, Railway box bundle, deploy). With no adapter it is a static site and `init` writes an `spa` config. `init` adds the `IMAGES` binding the adapter's `/_image` uses unless `imageService` doesn't need it (`compile`, `passthrough`); on the desktop it passes the original image through (Oct 10: `/_image` served from a dev desktop build).
- **Verified:** EmDash, Cloudflare's Astro CMS (Oct 12, blog-cloudflare template, emdash 1.2.0): `init` reads it as Astro and carries over its D1, R2 and cron. On a dev desktop build, setup seeds posts into D1 (sqlite) and images into R2 (a folder), and pages, RSS and `/_emdash/api/media/file/*` serve from them. Setup needs `EMDASH_SITE_URL`. Its sandboxed plugins need Worker Loader, which has no local twin (the template leaves it off). Edge and box are not verified yet.
- **Verified:** React Router 7 on `@cloudflare/vite-plugin` (Oct 12, Cloudflare's `react-router-starter-template`): `init` reads it with no flags, and the dev desktop build serves SSR (a loader reading a wrangler var) and the client assets from `build/client`. The older `cloudflareDevProxy` setup, Remix v2 and the Node server are still refused.
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
| RWSDK | `worker` | `dist/worker/index.js` | `Cloudflare.Worker` | ✅ live |
| TanStack Start | `worker` | `dist/server/server.js` | `Cloudflare.Website.Vite` | ✅ desktop, 🧪 edge |
| SvelteKit | `worker` | adapter-cloudflare `_worker.js` | `Cloudflare.Website.SvelteKit` | 🧪 |
| Astro | `worker` (adapter), `spa` (static) | @astrojs/cloudflare 14: `dist/server/entry.mjs` + `dist/client` | `Cloudflare.Worker` + assets | ✅ `init`, desktop, box and edge (sample app, Oct 9) |
| Nuxt | `worker` | Nitro `cloudflare-module` preset | `Cloudflare.Website.Nuxt` | 🧪 |
| React Router v7 | `worker` | `@cloudflare/vite-plugin`: `build/server/index.js` + `build/client` | `Cloudflare.Worker` + assets | ✅ `init` and desktop (Cloudflare template, Oct 12); 🔧 `cloudflareDevProxy` |
| SolidStart | `worker` | Nitro CF preset or Vite plugin output | `Cloudflare.Website.Vite` | 🔧 |
| Qwik City | `worker` | `cloudflare-pages` adapter (a Pages Functions shape) | `Cloudflare.Worker` + assets | 🔧 |
| Angular | `worker` | `AngularAppEngine` fetch handler from `@angular/ssr` | `Cloudflare.Worker` + assets | 🔧 |
| Next.js | `worker`, or sidecar | OpenNext `worker.js`; fallback: `standalone` server as a child process | `Cloudflare.Website.Nextjs` | ⏳ |
| Gatsby | `spa` | none: a static site in `public/` | `Cloudflare.Worker` + assets | ⏳ |
| CRA, Vue CLI, webpack | `spa` after a Vite port | none | same as Vite | ⏳ the port step |

The server output paths in this table come from each framework's usual layout. Record the real path when you build each sample app.

## Ranked: what to add next

Easiest first, judged by each framework's Cloudflare build and a `fit` sweep over the five most-starred GitHub repos per framework (Oct 12). `fit` names every one of these, and the ones `init` doesn't read link the issue that tracks them.

| Rank | Framework | Why here |
|---|---|---|
| 1 | Astro, EmDash | Done. 2 of 5 sampled repos are ready as they are; the others are monorepo roots or use `sharp`. |
| 2 | React Router 7 | Done for `@cloudflare/vite-plugin`. Next: `cloudflareDevProxy` apps (2 of 5 sampled), where wrangler bundles `workers/app.ts` over `build/server`. |
| 3 | SvelteKit | `adapter-cloudflare` builds a module Worker (`.svelte-kit/cloudflare/_worker.js`) plus assets, the shape the desktop already runs. 4 of 5 sampled repos are single apps. |
| 4 | Nuxt | Nitro's `cloudflare-module` preset builds `.output/server/index.mjs` plus `.output/public`. 4 of 5 sampled repos are monorepo roots, so expect `init` to run in a subfolder. |
| 5 | SolidStart | Nitro too (v1) or a Vite plugin (v2), so it follows Nuxt. Most sampled repos are libraries. |
| 6 | Qwik City | Its Cloudflare adapter targets Pages Functions, not a module Worker, so it needs a small wrapper. |
| 7 | Angular | `@angular/ssr`'s `AngularAppEngine` is a fetch handler, but 4 of 5 sampled apps serve it through Express. |
| 8 | Next.js | OpenNext works, but it's the heaviest build, and both sampled apps carry native addons (`sharp`, Prisma). |
| 9 | Gatsby | Static output only, so it fits the `spa` path. The top repos are mostly Gatsby itself or libraries, not apps. |
| 10 | CRA, Vue CLI, webpack | Not a Cloudflare build: a Vite port comes first (#404). |

## The sample app contract

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
- [ ] `apps/tanstack-start-example`, promoted from the probe.
- [ ] `apps/sveltekit-example`
- [ ] `apps/astro-example`
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