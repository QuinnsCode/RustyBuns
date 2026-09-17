# 🥐 Rusty Buns

**Bring your Vite Node web app -> get Native Binaries for FREE -> then get easy deployments that work local offline AND over all the big clouds!**

rustybuns is just a dev dependency. Your `src/` is never edited. Bun runs a local server beside the user's own browser; sqlite stands in for D1, KV, Durable Object storage, R2, all the fun services!

> Status: `0.1.4`, alpha. Desktop verified on macOS and Linux. Cloudflare deploy verified end to end (Worker, D1 with migrations, KV, R2, Durable Objects). Hetzner / Fly / Railway next. **We prioritize the happy path for a Vite React Node app, but this setup is flexible for many setups!**

## The four flows

1. Get us downloaded and set up
2. Get your native binary
3. Set up deployments
4. Deploy (Cloudflare for now)

Each one is a few commands. The long version is in [GETTING_STARTED.md](GETTING_STARTED.md).

## 1. Setup

Prereqs:
- Bun 1.4+
- an app that builds with `vite build`
- for the Cloudflare deploy flow: a `wrangler.jsonc`

```
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init
```

`init` reads your app and writes `rustybuns.config.ts`. Add `.rustybuns/` and `wrangler.generated.jsonc` to `.gitignore`.

## 2. Native binary

```
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in the browser, running on a local Bun host. When it looks right:

```
pnpm exec rustybuns build desktop        # dist/<name>-<os>-<arch>
```

## 3. Set up deployments

```
pnpm exec rustybuns add deploy
pnpm exec alchemy profile edit --profile default --add Cloudflare
```

`add deploy` installs the pinned Alchemy + Effect set. The profile step is once per machine: OAuth, All Scopes, pick your account.

## 4. Deploy

```
pnpm exec rustybuns plan       # shows what would be created, creates nothing
pnpm exec rustybuns deploy     # asks to confirm, then builds and uploads
pnpm exec rustybuns destroy    # removes everything the stack created
```

Use a different `name` in the config than your live app the first time.

## So... what's going on here?

- Infer the setup you need for deployment.
- Compile your app as a desktop binary for any or all of: macOS, Linux, Windows. Server actions run for real against sqlite. Assets and migrations are just embedded.
- Generate a typed Alchemy program (the plan of what the app needs to deploy) from your bindings, so you can take your app anywhere and deploy to many different providers as fast as they can provision.
- Opt into Rust (WASM in the tab, `bun:ffi` on the host) and `SharedArrayBuffer` workers in the web.

## What we aren't trying to do

- Mobile, native menus or tray, pixel-identical rendering across browsers, console targets.

## Later?

- Hetzner / Fly / Railway deploys
- installers + signing
- auto-update
- `add rust` / `add worker` scaffolds
- frameworks other than Vite + React

## Commands

| Command | What it does |
|---|---|
| `init` | infer the app, write `rustybuns.config.ts`, `.rustybuns/alchemy.run.ts`, `wrangler.jsonc` |
| `add desktop [--entry file#Component]` | scaffold `packages/desktop/` and `vite.desktop.config.ts`; keeps existing files |
| `add deploy [--dry-run]` | install the pinned alchemy + effect set and package manager overrides |
| `boundary` | classify `src/` as client / action / server / leak; regenerate stubs and proxies |
| `generate` / `adopt` | regenerate `.rustybuns/`; accept the generated `wrangler.jsonc` |
| `build desktop [--dev] [--target T]` | `--dev` bundles the host without compiling; otherwise builds binaries per target |
| `run desktop` | start the dev host |
| `plan` / `deploy [--yes]` / `destroy` / `dev` | Alchemy against the generated stack; `deploy` refuses without a matching `plan` |
| `eject` | copy `alchemy.run.ts` to the root; you own it |

`RB_NO_BROWSER=1` prints the token URL instead of opening a browser. `--profile <name>` passes through to Alchemy for multi-account setups.

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

## Desktop-only apps (no Cloudflare)

A plain Vite app works too. With no `wrangler.jsonc` (or with `--spa`), `rustybuns init` writes a desktop-only config and a `desktop/host.ts` for your backend routes:

```ts
desktop: {
  mode: "spa",
  clientBuild: "bun run build",
  clientDir: "dist/ui",
  world: false,                        // no world socket
  host: "desktop/host.ts",             // export default { fetch(req, ctx) }, null = not mine
  native: ["my_crate"],                // embed native/dist/my_crate in the binary
  headers: { "Cross-Origin-Embedder-Policy": "credentialless" },
}
```

The full example is [`apps/tscircuit-desktop`](apps/tscircuit-desktop): tscircuit as a single-file desktop app with a Rust analysis engine.
