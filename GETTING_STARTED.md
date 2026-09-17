# Getting started

## Install

```
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
```

Needs Bun 1.4+, `vite build`, and a `wrangler.jsonc`.

## See it run

```
pnpm exec rustybuns init
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev
pnpm exec rustybuns run desktop
```

`init` reads your app and writes `rustybuns.config.ts`. `add desktop` writes
`packages/desktop/` and `vite.desktop.config.ts`, skipping files you already
have. `run desktop` opens Chrome with your app on a local Bun host.

Add to `.gitignore`: `.rustybuns/` and `wrangler.generated.jsonc`.

## Point it at your app

- `packages/desktop/main.tsx` renders our intro page until you import your own component. Use one below the RSC boundary (a `"use client"` component).
- `packages/desktop/world.ts` is a template. If you have a Durable Object that owns a WebSocket, paste that class in and delete `extends DurableObject` and the `cloudflare:workers` import.
- If your D1 has migrations, set `"migrationsDir": "migrations"` on the `DB` binding in the config.
- If some `"use server"` modules should not run on the desktop (auth, social), set `desktop.actions: { include: ["src/app/actions/game/**"] }`.
- If assets live in R2, sync them to a folder in your client build step and set `desktop.mounts: { "/asset": "path/to/folder" }` and `desktop.r2: { ASSETS_BUCKET: "path/to/folder" }`.

## Build the binary

```
pnpm exec rustybuns build desktop
```

Output: `dist/<name>-<os>-<arch>`. `targets` in the config picks the OS list;
`"all"` cross-compiles from one machine when there is no Rust in the build.

## Deploy

```
pnpm add -D alchemy@latest effect@latest
pnpm exec rustybuns plan       # creates nothing
pnpm exec rustybuns deploy
pnpm exec rustybuns destroy
```

Use a different `name` in the config than your live app the first time.
Add `box: { provider: "hetzner" }` under `targets` for a VM column.
