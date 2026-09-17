# Getting started

Four flows. Each builds on the last, but you can stop after any of them.

## 1. Setup

```
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init
```

Needs Bun 1.4+, an app that builds with `vite build`, and (for the deploy flow) a `wrangler.jsonc`.

`init` prints what it detected: framework, package manager, source dir and aliases, the build
command it inferred from your `release` or `build` script, and a boundary report of which files
are client, `"use server"` actions, or server-only. It writes `rustybuns.config.ts` and
`.rustybuns/alchemy.run.ts`. Nothing in `src/` changes.

Add to `.gitignore`: `.rustybuns/` and `wrangler.generated.jsonc`.

## 2. Native binary

```
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev
pnpm exec rustybuns run desktop
```

`add desktop` writes `packages/desktop/` (`index.html`, `main.tsx`, `world.ts`) and
`vite.desktop.config.ts`, skipping files you already have. `run desktop` opens Chrome
with your app on a local Bun host. Data lives in `~/.<app-name>/`.

Point it at your app:

- `packages/desktop/main.tsx` renders our intro page until you import your own component. Use one below the RSC boundary (a `"use client"` component).
- `packages/desktop/world.ts` is a template. If you have a Durable Object that owns a WebSocket, paste that class in and delete `extends DurableObject` and the `cloudflare:workers` import.
- If your D1 has migrations, set `"migrationsDir": "migrations"` on the `DB` binding in the config.
- If some `"use server"` modules should not run on the desktop (auth, social), set `desktop.actions: { include: ["src/app/actions/game/**"] }`.
- If assets live in R2, sync them to a folder in your client build step and set `desktop.mounts: { "/asset": "path/to/folder" }` and `desktop.r2: { ASSETS_BUCKET: "path/to/folder" }`.

Then the real thing:

```
pnpm exec rustybuns build desktop
```

Output: `dist/<name>-<os>-<arch>`. `targets` in the config picks the OS list;
`"all"` cross-compiles from one machine when there is no Rust in the build.

## 3. Set up deployments

```
pnpm exec rustybuns add deploy
pnpm exec alchemy profile edit --profile default --add Cloudflare
```

`add deploy` installs the pinned alchemy + effect set and writes package manager overrides
so transitive `@effect/*` versions cannot drift (Effect is rc; carets break within days).

The profile step runs once per machine: choose OAuth, All Scopes, then the account you want
to deploy to. It is saved in `~/.alchemy/`. If you manage several Cloudflare accounts, make a
named profile per account (`alchemy profile create <name>`) and pass `--profile <name>` to
`plan` and `deploy`. For CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead.

On pnpm 10, packages published in the last 24h are held back. If `add deploy` complains,
add `minimumReleaseAgeExclude: ["alchemy", "effect", "@effect/*"]` to `pnpm-workspace.yaml`.

## 4. Deploy

Set a different `name` in `rustybuns.config.ts` than your live app the first time, so the
stack cannot touch existing resources.

```
pnpm exec rustybuns plan
pnpm exec rustybuns deploy
pnpm exec rustybuns destroy
```

`plan` shows what would be created and creates nothing. `deploy` refuses unless `plan` ran
for this exact config, then shows the same list, asks you to confirm, builds, uploads, and
prints the URL (`--yes` skips both prompts for CI). `destroy` removes everything the stack
created, in reverse order.

Your `wrangler.jsonc` bindings become the deployed resources: D1 (with migrations applied),
KV, R2, and Durable Objects, bound to the Worker under the same names.

Add `box: { provider: "hetzner" }` under `targets` for a VM column (draft).