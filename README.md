# 🥐 Rusty Buns

**Ship the web app you already have as a desktop binary, and deploy it anywhere Alchemy reaches.**

A dev dependency. Your `src/` is never edited. Bun runs a local server beside the user's own browser; sqlite stands in for D1, KV, Durable Object storage, and R2.

> Status: `0.1.0`, alpha. Desktop verified on macOS and Linux. Cloud deploys are generated but not yet verified against a live account.

## Quick start

Prerequisites: Bun 1.4+, an app that builds with `vite build`, a `wrangler.jsonc`.

```
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in Chrome, running on a local Bun host. Then:

```
pnpm exec rustybuns build desktop        # dist/<name>-<os>-<arch>
```

Add `.rustybuns/` and `wrangler.generated.jsonc` to `.gitignore`. Details in [GETTING_STARTED.md](GETTING_STARTED.md).

## What it does

- Reads `package.json`, `vite.config.*`, `tsconfig` paths, and `wrangler.*` to infer your setup.
- Runs your app as a desktop binary for macOS, Linux, Windows. Server actions run for real against sqlite. Assets and migrations are embedded.
- Generates a typed Alchemy program from your bindings for cloud deploys.
- Lets you opt into Rust (WASM in the tab, `bun:ffi` on the host) and `SharedArrayBuffer` workers.

## What it does not do

- Mobile, native menus or tray, pixel-identical rendering across browsers, console targets.
- Yet: verified cloud deploys, installers and signing, auto-update, `add rust` / `add worker` scaffolds, frameworks other than Vite + React as the tested reference.

## Commands

| Command | What it does |
|---|---|
| `init` | infer the app, write `rustybuns.config.ts`, `.rustybuns/alchemy.run.ts`, `wrangler.jsonc` |
| `add desktop [--entry file#Component]` | scaffold `packages/desktop/` and `vite.desktop.config.ts`; keeps existing files |
| `boundary` | classify `src/` as client / action / server / leak; regenerate stubs and proxies |
| `generate` / `adopt` | regenerate `.rustybuns/`; accept the generated `wrangler.jsonc` |
| `build desktop [--dev] [--target T]` | `--dev` bundles the host without compiling; otherwise builds binaries per target |
| `run desktop` | start the dev host |
| `plan` / `deploy` / `destroy` / `dev` | Alchemy against the generated stack |
| `eject` | copy `alchemy.run.ts` to the root; you own it |

`RB_NO_BROWSER=1` prints the token URL instead of opening a browser.

## Config reference (`rustybuns.config.ts`)

| Key | Values |
|---|---|
| `source` | `dir`, `aliases`, `ignore` (inferred from tsconfig paths) |
| `bindings` | `d1` (+ `migrationsDir`), `kv`, `r2`, `durable_object`, `var`, `secret` |
| `targets.edge` | `provider: "cloudflare"`, `domain` |
| `targets.box` | `provider: "hetzner"`, `region`, `serverType` (draft) |
| `targets.desktop` | `mode` (`spa` \| `worker`), `clientBuild`, `clientDir`, `world`, `worldPath`, `identity`, `actions` (`include` / `exclude`), `mounts`, `r2`, `storageCodec` (`json` \| `v8`), `targets` (list or `"all"`), `window` (`app` \| `tab`), `dataDir`, `define` |

## Where things run

| Need | Cloudflare | Any VM | Desktop |
|---|---|---|---|
| http | Worker | Bun `serve()` | Bun `serve()` |
| WebSocket state | Durable Object | in-process DO | in-process DO |
| SQL | D1 | sqlite or Postgres | sqlite |
| KV | KV | sqlite table | sqlite table |
| blob | R2 | directory | embedded directory |
| native (FFI, SAB) | no | yes | yes |

## Desktop host

Token-gated, `127.0.0.1` only, COOP/COEP set so `SharedArrayBuffer` works. `/__rb/info` shows runtime info; `/__rb/action` runs `"use server"` functions. `cloudflare:workers` and `rwsdk/worker` are shimmed on the host. D1 migrations apply at boot. `RB_VERSION` is `<package version>+<git sha>`. Data lives in `~/.<app-name>/`.

## License

Apache-2.0. See [LICENSING.md](LICENSING.md).
