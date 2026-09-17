# Frameworks roadmap

Goal: every supported framework has a sample app in `apps/`. CI builds each one for desktop and plans it for the edge on every PR.

## The core idea

Most frameworks already have a Cloudflare build that outputs a module exporting `default { fetch }`. Desktop `worker` mode mounts exactly that shape, and the host shim answers `cloudflare:workers`. So for most frameworks the same build can serve both the edge and desktop, with no per-framework adapter.

- **Verified:** TanStack Start (probe on Sep 17: SSR, server function, KV persistence, compiled binary).
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
| Astro | `worker` | @astrojs/cloudflare `_worker.js` | `Cloudflare.Website.Astro` | 🧪 |
| Nuxt | `worker` | Nitro `cloudflare-module` preset | `Cloudflare.Website.Nuxt` | 🧪 |
| React Router v7 | `worker` | server build wrapped in `createRequestHandler` | `Cloudflare.Website.Vite` | 🔧 |
| SolidStart | `worker` | Nitro CF preset or Vite plugin output | `Cloudflare.Website.Vite` | 🔧 |
| Next.js | `worker`, or sidecar | OpenNext `worker.js`; fallback: `standalone` server as a child process | `Cloudflare.Website.Nextjs` | ⏳ |

The server output paths in this table come from each framework's usual layout. Record the real path when you build each sample app.

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