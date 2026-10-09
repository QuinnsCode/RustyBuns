# Getting started

Rusty Buns wraps the web app you already have so the same code ships as a desktop binary, a Cloudflare Worker and a Linux server. You don't need to know Rust or Bun to use it. You write a Vite app, and Rusty Buns carries it to every place it needs to run. Why this and not Electron or Tauri: see the [README](README.md#the-questions-everyone-asks).

Five flows. Each builds on the last, but you can stop after any of them.

## 1. Setup

```
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init
```

Needs Bun 1.4+, an app that builds with `vite build`, and (for the deploy flow) a `wrangler.jsonc`.
In a pnpm workspace (your repo has a `pnpm-workspace.yaml`), install with `-Dw` instead of `-D`.

`init` prints its version, then what it detected: framework, package manager, source dir and aliases, the build
command it inferred from your `release` or `build` script, and a boundary report of which files
are client, `"use server"` actions, or server-only. It writes `rustybuns.config.ts` and
`.rustybuns/alchemy.run.ts`. Nothing in `src/` changes.

It also picks up D1 migrations from `./migrations`, secret names from `.dev.vars` (values stay
on your machine), and adds `.rustybuns/`, `wrangler.generated.jsonc` and `.alchemy/` to `.gitignore`.

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
- D1 migrations in `./migrations` are found automatically. If yours live elsewhere, set `migrationsDir` on the D1 binding.
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
In a monorepo the overrides go in the **workspace root's** `package.json`: Bun, npm and yarn ignore them in a member.
Effect is what makes the deploy typed: the config, the generated stack and each provider are checked
by the compiler before anything is created. You don't write any Effect yourself unless you `eject`.

The profile step runs once per machine: choose OAuth, All Scopes, then the account you want
to deploy to. It is saved in `~/.alchemy/`. If you manage several Cloudflare accounts, make a
named profile per account (`alchemy profile create <name>`) and pass `--profile <name>` to
`plan` and `deploy`. For CI, set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` instead.

On pnpm 10, packages published in the last 24h are held back. If `add deploy` complains,
add `minimumReleaseAgeExclude: ["alchemy", "effect", "@effect/*", "@rustybuns/*"]` to `pnpm-workspace.yaml`.

## 4. Deploy

Set a different `name` in `rustybuns.config.ts` than your live app the first time, so the
stack cannot touch existing resources. If a `var` holds your live app's URL (an auth base URL,
say), point it at the new one too: `https://<name>.<account>.workers.dev`. Secret values are
read from `.dev.vars` at deploy time.

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

## 5. Deploy to Hetzner

Add `box: { provider: "hetzner" }` under `targets`. Keep `edge` for both columns in one stack,
or remove it for a Hetzner-only stack. Then, once per machine:

```
pnpm exec alchemy profile edit --profile default --add Hetzner
```

It asks for a Hetzner Cloud API token with read & write access (Console → Security → API tokens).
In CI, set `HCLOUD_TOKEN` instead. Don't put it in `.dev.vars`, because `init` reads secret names
from there.

```
pnpm exec rustybuns plan
pnpm exec rustybuns deploy
```

Both run `rustybuns build box` first: your desktop host, compiled for Linux, with the token gate
off and `/health` on. It lands in `.rustybuns/box/` next to `launch.mjs`, a small Node launcher,
since Alchemy's `Hetzner.Service` starts every unit with `node`. `deploy` creates the server and a
10 GB volume, copies both files over SSH, starts a systemd unit, waits for `/health`, and prints
`http://<ipv4>:3000`. sqlite, KV and R2 directories live on the volume, so they survive
redeploys. Secret values from `.dev.vars` go into the unit's env file.

To pick a different server, set `location`, `serverType` (`cax*` types are ARM), `image`, `port`
or `volumeSize` on `targets.box`. Changing `location`, `serverType` or `image` replaces the server.
The volume lives on.

To try the box locally before paying for one, build it for your own machine and start the launcher:

```
pnpm exec rustybuns build box --target darwin-arm64
PORT=3000 DATA_DIR=/tmp/box node .rustybuns/box/launch.mjs
curl localhost:3000/health
```