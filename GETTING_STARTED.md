# Getting started

Four steps: set up, desktop, Cloudflare, a server. Each step builds on the one before, and you can stop after any of them. Why this and not Electron or Tauri: see the [README](README.md#the-questions-everyone-asks).

You need **Bun 1.4+** and an app that builds with `vite build`. For Cloudflare you also need a `wrangler.jsonc`.

## 1. Set up

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun     # -Dw in a pnpm workspace
pnpm exec rustybuns init
```

`init` reads your app and prints what it found: framework, package manager, source dir, aliases, build command, and which files are client code, `"use server"` actions or server-only. It writes `rustybuns.config.ts`, the one file you own, and nothing in `src/` changes.

It also finds D1 migrations in `./migrations`, takes secret *names* from `.dev.vars` (the values never leave your machine), and gitignores what it generates.

## 2. Desktop

```sh
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in Chrome on a local Bun host, with sqlite behind every binding. Data lives in `~/.<app-name>/`.

`add desktop` writes `packages/desktop/` and `vite.desktop.config.ts`, keeping any files you already have. To point it at your app:

- **`packages/desktop/main.tsx`** shows our intro page until you import your own component (a `"use client"` one, below any RSC boundary).
- **`packages/desktop/world.ts`** is a template. If you have a Durable Object that owns a WebSocket, paste the class in and drop `extends DurableObject` and the `cloudflare:workers` import.
- **Actions that shouldn't run on a laptop** (auth, social): `desktop.actions: { include: ["src/app/actions/game/**"] }`.
- **Assets in R2:** copy them to a folder in your build and set `desktop.mounts: { "/asset": "dir" }` and `desktop.r2: { ASSETS_BUCKET: "dir" }`.

When it looks right, build the real thing:

```sh
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>
```

`targets: "all"` in the config cross-compiles macOS, Linux and Windows from one machine, as long as there's no Rust in the build.

## 3. Cloudflare

```sh
pnpm exec rustybuns add deploy            # pinned Alchemy + Effect
pnpm exec rustybuns login cloudflare      # once per machine
```

**The first time, give the config a different `name` than your live app**, so the stack can't touch anything that already exists. If a `var` holds your live URL (an auth base URL, say), point it at `https://<name>.<account>.workers.dev`.

```sh
pnpm exec rustybuns plan       # shows what it would create; creates nothing
pnpm exec rustybuns deploy     # refuses without a plan for this exact config, then asks
pnpm exec rustybuns destroy    # removes everything the stack created
```

Your bindings become real resources with the same names: a Worker, D1 (migrations applied), KV, R2 and Durable Objects. Secret values are read from `.dev.vars` at deploy time. To have a test stack mint its own secrets, or to pull prod secrets from 1Password, see [who holds the keys](REFERENCE.md#who-holds-the-keys-experimental) (experimental). `plan` also lists what can bill you; see [COSTS.md](COSTS.md).

If something goes wrong here:

- **pnpm 10 holds back packages less than a day old.** Add `minimumReleaseAgeExclude: ["alchemy", "effect", "@effect/*", "@rustybuns/*"]` to `pnpm-workspace.yaml`.
- **In a monorepo,** `add deploy`'s version overrides go in the workspace root's `package.json`. Bun, npm and yarn ignore them in a member package.
- **Several Cloudflare accounts:** `rustybuns login cloudflare --profile <name>`, then pass `--profile <name>` to `plan` and `deploy`.
- **CI:** set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and pass `--yes`.

## 4. A server (a "box")

The same host the desktop uses, run on a Linux server. Add a `box` target next to `edge`, or replace `edge` with it:

```ts
targets: {
  edge: { provider: "cloudflare" },
  box: { provider: "railway" },      // or "hetzner"
}
```

| | Railway | Hetzner |
|---|---|---|
| Status | verified live | verified live |
| You get | `https://<service>.up.railway.app`, a Volume for sqlite | `http://<ipv4>:3000`, a 10 GB Volume for sqlite |
| Cost | by usage, sleeps when idle; **set a hard usage limit first** | hourly until destroyed |
| Rust crates | yes, built inside the image | yes, built in Docker when you're not on Linux |
| Log in | `rustybuns login railway` (an *account* token, or the browser) | `rustybuns login hetzner` (a read & write API token) |

Then the same three commands: `plan`, `deploy`, `destroy`. Both run `rustybuns build box` first.

Try a box locally before paying for one:

```sh
pnpm exec rustybuns build box --target darwin-arm64           # your own OS
PORT=3000 DATA_DIR=/tmp/box node .rustybuns/box/launch.mjs     # the Hetzner shape
curl localhost:3000/health
```

A box plays like the edge, not like the desktop: every visitor is their own guest, `?room=CODE` picks a room, and there's no login. Server keys, TLS, identity and the other limits are in [REFERENCE.md](REFERENCE.md#deploy-to-hetzner).
