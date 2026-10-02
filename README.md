# 🥐 Rusty Buns

Take the Vite app you already have and ship it three ways: as a desktop binary, as a Cloudflare Worker, and on a Linux server. Same code, same bindings, no rewrite.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>
pnpm exec rustybuns deploy              # Cloudflare, Hetzner, or both
```

Rusty Buns is a dev dependency. It never edits `src/` and never ships in your bundle. `init` reads `package.json`, `vite.config`, `tsconfig` and `wrangler.jsonc`, then writes one config file. Everything else is generated from it:

- a **Bun host** that runs your app on `Bun.serve()`, with sqlite standing in for D1, KV, R2 and Durable Object storage
- an **[Alchemy](https://alchemy.run) stack** that creates the cloud resources your bindings describe

> **Alpha, `0.1.5`.** Desktop is verified on macOS and Linux. The Cloudflare deploy is verified end to end (Worker, D1 with migrations, KV, R2, Durable Objects). The Hetzner box builds and runs locally but hasn't been deployed to a real account yet. Fly and Railway come after. The happy path is a Vite + React app on Workers, but anything Vite builds should work.

## Why

A Workers app is tied to Cloudflare by its bindings. Your code calls `env.DB.prepare()` and `env.KV.get()`, and those only exist inside workerd.

Rusty Buns gives every binding a local twin on sqlite and the filesystem, and runs your `fetch` handler under Bun. Once your app runs on a laptop that way, it runs on any Linux box too. The cloud deploy is generated from the same binding list, so the three targets never drift apart.

## How it works

```
                    rustybuns.config.ts
          (inferred by `init`, then yours to edit)
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
    desktop              edge                  box
  ───────────        ─────────────        ──────────────
  Bun host           Alchemy stack        Bun host + Alchemy stack
  127.0.0.1 + token  Cloudflare.Worker    Hetzner.Server + Volume
  sqlite in ~/.app   D1, KV, R2, DOs      sqlite on the Volume
  one binary         your vite build      one binary under systemd
```

The desktop and box hosts are the same generated program. The desktop build binds to localhost, gates every request on a per-launch token and opens a browser. The box build listens on `0.0.0.0`, skips the token, serves `/health`, and keeps its data on an attached volume.

### Where things run

| Need | Cloudflare | Hetzner | Desktop |
|---|---|---|---|
| http | Worker | Bun `serve()` | Bun `serve()` |
| WebSocket state | Durable Object | in-process DO | in-process DO |
| SQL | D1 | sqlite on a Volume | sqlite |
| KV | KV | sqlite table | sqlite table |
| blob | R2 | directory on a Volume | embedded directory |
| secrets | Worker secrets | env file on the server | n/a |
| native (FFI, `SharedArrayBuffer`) | no | yes | yes |

## Getting started

There are five flows. Each builds on the one before, and you can stop after any of them. The long version is in [GETTING_STARTED.md](GETTING_STARTED.md).

You need Bun 1.4+, an app that builds with `vite build`, and a `wrangler.jsonc` if you want the Cloudflare deploy.

### 1. Setup

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init
```

In a pnpm workspace (your repo has a `pnpm-workspace.yaml`), install with `-Dw` instead of `-D`.

`init` prints what it detected (framework, package manager, source dir, aliases, build command) and a boundary report: which files are client code, which are `"use server"` actions, and which are server-only. It finds D1 migrations in `./migrations` and takes secret *names* from `.dev.vars`. The values never leave your machine. It also adds `.rustybuns/`, `wrangler.generated.jsonc` and `.alchemy/` to `.gitignore`.

### 2. Desktop binary

```sh
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in Chrome (or your default browser), running on a local Bun host. When it looks right:

```sh
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>
```

Set `targets: "all"` to cross-compile macOS, Linux and Windows from one machine. This only works when the build has no Rust; Rust cdylibs have to be built on each OS.

### 3. Deploy tooling

```sh
pnpm exec rustybuns add deploy
```

This installs a pinned Alchemy + Effect set and writes package manager overrides so transitive `@effect/*` versions can't drift. Effect is a release candidate, and loose version ranges break within days.

### 4. Deploy to Cloudflare

```sh
pnpm exec alchemy profile edit --profile default --add Cloudflare   # once per machine

pnpm exec rustybuns plan       # shows what would be created, creates nothing
pnpm exec rustybuns deploy     # refuses without a matching plan, then asks to confirm
pnpm exec rustybuns destroy    # removes everything the stack created
```

The first time, give the config a different `name` than your live app, so the stack can't touch existing resources. If a `var` holds your live URL (an auth base URL, say), point it at `https://<name>.<account>.workers.dev` too.

### 5. Deploy to Hetzner

Add a `box` target:

```ts
// rustybuns.config.ts
targets: {
  edge: { provider: "cloudflare" },   // drop this line for a Hetzner-only stack
  box: { provider: "hetzner" },
}
```

Then give Alchemy a Hetzner Cloud API token (Console → Security → API tokens, read & write):

```sh
pnpm exec alchemy profile edit --profile default --add Hetzner     # or: export HCLOUD_TOKEN=...
pnpm exec rustybuns plan
pnpm exec rustybuns deploy     # prints  box: http://<ipv4>:3000
```

`plan` and `deploy` run `rustybuns build box` first, which compiles the same host the desktop uses for Linux into `.rustybuns/box/`. Then `deploy`:

1. creates a server (`cpx12` in `nbg1` on Ubuntu 24.04 by default) and a 10 GB ext4 volume
2. copies the binary and a small Node launcher over SSH, using a deploy key Alchemy generates
3. installs a systemd unit and waits for `GET /health` to answer

The launcher exists because Alchemy's `Hetzner.Service` always starts `node <main>`. It finds the mounted volume, sets `DATA_DIR`, and execs the Bun binary next to it, passing signals through.

| `targets.box` key | Default | Notes |
|---|---|---|
| `location` | `nbg1` | `fsn1`, `hel1`, `ash`, `hil`, `sin`. Changing it replaces the server. |
| `serverType` | `cpx12` | `cax*` types are ARM, and the binary is built for `linux-arm64` to match. Changing it replaces the server. |
| `image` | `ubuntu-24.04` | |
| `port` | `3000` | |
| `volumeSize` | `10` | GB, minimum 10. `0` keeps data on the server's own disk in `/var/lib/<name>`. |

Current limits on the box:

- **Plain HTTP on the port.** No TLS or domain yet. Put Cloudflare in front, or wait for the load balancer and certificate support on the roadmap.
- **One identity in `spa` mode.** The host vouches the same local user for every visitor, just like the desktop does. That's fine for a shared world or a tool behind your own auth, but it isn't multi-user.
- **Secrets are plaintext at rest.** They go into `/opt/<unit>/env` on the server and into Alchemy's local state in `.alchemy/`. Don't keep `HCLOUD_TOKEN` in `.dev.vars`, or `init` will treat it as an app secret.
- **Rust crates need a Linux build machine.** If `native/` has crates, run `deploy` on Linux (or in CI), since cdylibs don't cross-compile.

## Commands

| Command | What it does |
|---|---|
| `init` | infer the app; write `rustybuns.config.ts`, `.rustybuns/alchemy.run.ts`, `wrangler.jsonc` |
| `add desktop [--entry file#Component]` | scaffold `packages/desktop/` and `vite.desktop.config.ts`; keeps files you already have |
| `add deploy [--dry-run]` | install the pinned Alchemy + Effect set and package manager overrides |
| `boundary` | classify `src/` as client / action / server / leak; regenerate stubs and proxies |
| `generate` / `adopt` | regenerate `.rustybuns/`; `adopt` accepts the generated `wrangler.jsonc` over a hand-written one |
| `build desktop [--dev] [--target os-arch]` | `--dev` bundles without compiling, for `run desktop` |
| `run desktop` | start the dev host |
| `build box [--target os-arch]` | Linux binary + Node launcher in `.rustybuns/box/`; `--target` your own OS to try it locally |
| `plan` / `deploy [--yes]` / `destroy` | Alchemy against the generated stack; `deploy` refuses without a plan for this exact config |
| `dev` | `alchemy dev`: workerd and local simulators for the edge |
| `eject` | copy `alchemy.run.ts` to the project root; from then on you own it |

`--profile <name>` and `--stage <name>` pass through to Alchemy. `RB_NO_BROWSER=1` prints the desktop URL instead of opening a browser.

## Config

`rustybuns.config.ts` is the one file you own. `init` writes it, and every generated file comes from it.

```ts
import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "my-app",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "vite build",
  },
  bindings: {
    DB: { type: "d1", databaseName: "my-app", migrationsDir: "migrations" },
    CACHE: { type: "kv" },
    UPLOADS: { type: "r2", bucketName: "my-app-uploads" },
    WORLD: { type: "durable_object", className: "World" },
    SESSION_SECRET: { type: "secret" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    box: { provider: "hetzner", location: "fsn1" },
    desktop: { mode: "spa", world: "packages/desktop/world.ts", targets: ["darwin-arm64", "linux-x64"] },
  },
});
```

| Key | Values |
|---|---|
| `source` | `dir`, `aliases`, `ignore` (inferred from tsconfig paths) |
| `bindings` | `d1` (+ `migrationsDir`), `kv`, `r2`, `durable_object`, `var`, `secret` |
| `targets.edge` | `provider: "cloudflare"`, `domain` |
| `targets.box` | `provider: "hetzner"`, `location`, `serverType`, `image`, `port`, `volumeSize` |
| `targets.desktop` | `mode` (`spa` \| `worker`), `clientBuild`, `clientDir`, `world`, `worldPath`, `identity`, `actions` (`include` / `exclude`), `mounts`, `r2`, `storageCodec` (`json` \| `v8`), `targets` (list or `"all"`), `window` (`app` \| `tab`), `dataDir`, `define` |

## The host

The desktop host only listens on `127.0.0.1`, and every request needs the per-launch token. It sets COOP/COEP so `SharedArrayBuffer` works. `/__rb/info` shows runtime info, and `/__rb/action` runs your `"use server"` functions against sqlite. `cloudflare:workers` and `rwsdk/worker` are shimmed. D1 migrations apply at boot and are tracked in `d1_migrations`. `RB_VERSION` is `<package version>+<git sha>`. Data lives in `~/.<app-name>/`.

The box host is the same program, minus the token and the browser.

Durable Objects run in-process with WebSocket hibernation handlers, `blockConcurrencyWhile`, alarms and storage. Not emulated yet: eviction, cross-script DOs, socket tags, and the SQLite-backed `ctx.storage.sql` API.

## Repo layout

```
packages/cli         init, add, build, plan/deploy; generates the host and the Alchemy stack
packages/shell-bun   Bun.serve shell, token gate, D1/KV/R2/DO bindings over sqlite and the fs
packages/ports       types only: Http, Comms, Storage, Memory, Reporter
packages/native      loadNative(name, symbols): dlopen a Rust cdylib, null means take the TS path
native/              Cargo workspace; rb_hello proves cdylib + pointer-over-SAB
apps/                example apps, see EXAMPLES.md
```

## Examples

| App | What it shows |
|---|---|
| [tscircuit-desktop](apps/tscircuit-desktop/README.md) | a heavy Vite app as one binary, with a Rust engine and a TypeScript fallback |
| [splat-desktop](apps/splat-desktop/README.md) | PlayCanvas' SuperSplat editor as a desktop app working on a folder of scenes |
| [splat-rooms](apps/splat-rooms/README.md) | a splat hunting game with a Durable Object world and a mount read from your disk |
| [motion-midi](apps/motion-midi/README.md) | one synth written in Rust and in TypeScript, checked sample by sample |
| [spa-example](apps/spa-example) | an RWSDK app with D1, KV and a world DO, all on sqlite |

More in [EXAMPLES.md](EXAMPLES.md).

## Roadmap

Done: desktop binaries, the Cloudflare deploy, the Hetzner box (built, not yet live-tested).

Next, roughly in order:

- a live Hetzner run, then TLS and a domain on the box (`Hetzner.LoadBalancer` + `Certificate`)
- Fly and Railway as more box-style columns
- `add worker` / `add rust` scaffolds: typed worker RPC over `SharedArrayBuffer`, a WASM or cdylib drop-in
- `rustybuns test`: one E2E gate over the desktop binary, local workerd and a preview stage
- installers and signing (`.app`/`.dmg`, `.msi`, AppImage) and auto-update
- frameworks beyond Vite + React; see [FRAMEWORKS.md](FRAMEWORKS.md)

Not planned: mobile, native menus or tray, pixel-identical rendering across browsers, consoles.

The full matrix is in [notes/ROADMAP.md](notes/ROADMAP.md), and who it's for is in [ADOPTION.md](ADOPTION.md).

## License

Apache-2.0. See [LICENSING.md](LICENSING.md).
