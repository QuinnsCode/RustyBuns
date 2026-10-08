# 🥐 Rusty Buns

**Write your app once. Ship it everywhere.**

Rusty Buns wraps the web app you already have so the same code ships as a desktop binary, a Cloudflare Worker, and a Linux server, with the same bindings and no rewrite.

You don't have to learn Rust or Bun to use it. (We use them underneath. Rust is there if you want it, Bun is the runtime that makes one-file binaries possible.) You write a Vite app. Rusty Buns is the abstraction that carries it to every place it needs to run.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>
pnpm exec rustybuns deploy              # Cloudflare, Hetzner, or both
```

Rusty Buns is a dev dependency. It never edits `src/` and never ships in your bundle. `init` reads `package.json`, `vite.config`, `tsconfig` and `wrangler.jsonc`, then writes one config file. Everything else is generated from it:

- a **Bun host** that runs your app on `Bun.serve()`, with sqlite standing in for D1, KV, R2 and Durable Object storage
- a typed **[Alchemy](https://alchemy.run) + [Effect](https://effect.website) stack** that creates the cloud resources your bindings describe

> **Alpha, `0.1.8`.** Desktop is verified on macOS and Linux. The Cloudflare deploy is verified end to end (Worker, D1 with migrations, KV, R2, Durable Objects). The Hetzner box builds and runs locally but hasn't been deployed to a real account yet. Fly and Railway come after. The happy path is a Vite + React app on Workers, but anything Vite builds should work.

## Why

### The problem

A Workers app is tied to Cloudflare by its bindings. Your code calls `env.DB.prepare()` and `env.KV.get()`, and those only exist inside workerd. A web app is tied to a browser tab. Getting either one onto a laptop, a VPS, and the edge usually means three codebases or three rewrites.

### The idea

Your app is five things: **http, comms, storage, memory, identity**. Each one has a real implementation on every target, so Rusty Buns gives every binding a local twin (sqlite and the filesystem) and runs your `fetch` handler under Bun. Once your app runs on a laptop that way, it runs on any Linux box too. The cloud deploy is generated from the same binding list, so the three targets never drift apart.

### Typed deploys, thanks to Effect

The deploy side is built on Alchemy, which is built on [Effect](https://effect.website). Your `rustybuns.config.ts` is typed, the generated stack is typed, and every provider (Cloudflare, Hetzner, soon Fly and Railway) is a typed Layer. Swap a target by changing one line of config, and the compiler tells you what's missing before anything is created. `plan` type checks the generated stack first, then shows the diff, and `deploy` refuses to run without a plan for that exact config. You get infrastructure-as-code that feels like writing a function, and you never have to write the Effect yourself unless you want to (`rustybuns eject` hands you the program).

### Type checking and per-step timing

`plan` and `deploy` type check the generated stack before Alchemy runs (`--no-check` skips). `build desktop --check` type checks your app before the client build, so a type error costs well under a second instead of a full build. The checker is picked automatically: [`bun check`](https://bun.com/docs/runtime/check) on Bun 1.4.3 or newer, else [tsc-rs](https://github.com/pingdotgg/ts-rust), else `tsc`. tsc-rs goes first when the tsconfig enables `@effect/language-service`, because only tsc-rs runs Effect's diagnostics (a stack step written without `yield*` silently never runs; tsc-rs flags it as TS377001). `--checker bun|tsc-rs|tsc` picks one yourself.

`build desktop`, `plan` and `deploy` print how long each step took and save it to `.rustybuns/profile/`. The next run shows the change per step, so you can see what a checker or Bun upgrade actually saved:

```
profile: build desktop  (bun 1.4.3)
  boundary glue             2ms    0%  =
  typecheck app            56ms    7%  -1.03s (19.4x faster)  [bun]
  client build            652ms   76%  +16ms
  compile darwin-arm64    138ms   16%  +14ms
  total                   858ms  -1.00s (2.2x faster)
```

### How it compares

Rusty Buns isn't a UI toolkit. It doesn't draw your window; your app does. That puts it in a different spot from the usual desktop options:

| | **Electron** | **Tauri** | **Rusty Buns** |
|---|---|---|---|
| What you write | web app + Node main process | web app + Rust backend (commands) | **the web app you already have**, plus optional Rust |
| Rendering | bundled Chromium | the OS webview | your installed Chrome, or your default browser |
| Backend language | Node | Rust | TypeScript (Workers-shaped `fetch`), Rust optional via FFI |
| Output | installer, ~100+ MB | installer, small | one self-contained binary (about 90 to 110 MB in our examples) |
| Ships to the cloud too | no | no | **yes**: Cloudflare Worker and Linux server from the same code |
| Backend code is portable to a server | rewrite | rewrite | same handler, same bindings |
| Native menus, tray, auto-update, signed installers | yes | yes | **not yet** (see roadmap) |
| Pixel-identical rendering everywhere | yes | no | no |

The honest trade: if you need a native window with menus and a tray, pick Electron or Tauri. If what you have is a web app with a backend, and you want that same app on a laptop, on the edge, *and* on a VPS, that's what Rusty Buns is for. Your users download one file and need no Node, no Bun and no install step.

### A full-stack framework, by accident

We set out to wrap apps, and ended up with the pieces of a full-stack framework anyway:

| A framework gives you | Rusty Buns gives you |
|---|---|
| a server runtime | the Bun host (`Bun.serve`, WebSockets, hibernating DO-style objects) |
| a database and migrations | D1-shaped sqlite with migrations applied at boot |
| KV, blob storage, secrets | KV on sqlite, R2-shaped directories, secrets by name |
| server actions / RPC | `"use server"` functions run for real against sqlite (`/__rb/action`) |
| build and bundling | Vite in, one binary out |
| deploy and infrastructure | a typed Alchemy + Effect stack, plan before deploy |
| native code escape hatch | Rust cdylibs over `bun:ffi`, with a TypeScript fallback |

The difference is that we don't ask you to adopt any of it. It's the shape Cloudflare already standardized (`fetch`, Durable Objects, D1, KV, R2), so leaving is a `git rm`, not a rewrite. Who it's for is in [ADOPTION.md](ADOPTION.md).

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

There are five flows. Each builds on the one before, and you can stop after any of them. The long version is in [GETTING_STARTED.md](GETTING_STARTED.md). What each flow can bill you for, and how to cap it, is in [COSTS.md](COSTS.md).

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

`worker` is only needed for the Cloudflare deploy. Leave it out for a desktop-only or Hetzner-only app.

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
| `targets.desktop` | `mode` (`spa` \| `worker`), `clientBuild`, `clientDir`, `world` (or `false`), `worldPath`, `identity`, `listen` (`hostname`, `port`), `guests` (`join`, `max`, `version`), `host`, `headers`, `native`, `actions` (`include` / `exclude`), `mounts`, `r2`, `storageCodec` (`json` \| `v8`), `targets` (list or `"all"`), `window` (`app` \| `tab`), `dataDir`, `define` |

Three desktop keys are for apps that aren't Workers apps at all, like [tscircuit-desktop](apps/tscircuit-desktop/README.md):

- **`host`** is a module whose default export is `{ fetch(req, ctx) }`. It's your backend routes (files, native calls, exports) without pretending to be a Worker. Return `null` to fall through.
- **`headers`** overrides response headers. The default is full cross-origin isolation for `SharedArrayBuffer`. Apps that load CDN assets without CORP headers want `{ "Cross-Origin-Embedder-Policy": "credentialless" }`.
- **`native`** names the Rust crates from `native/dist/` to embed. Leave it out to embed every built crate. Naming one that was never built is an error.

The box host reads the same keys, so `host` routes and `headers` work on Hetzner too.

## The host

The desktop host listens on `127.0.0.1` on a random port by default (`listen` in the config, `--listen host:port` or `RB_LISTEN` at launch), and every request needs the per-launch token. It sets COOP/COEP so `SharedArrayBuffer` works. `/__rb/info` shows runtime info, and `/__rb/action` runs your `"use server"` functions against sqlite. `cloudflare:workers` and `rwsdk/worker` are shimmed. D1 migrations apply at boot and are tracked in `d1_migrations`. `RB_VERSION` is `<package version>+<git sha>`. Data lives in `~/.<app-name>/`.

The box host is the same program, minus the token and the browser.

### Multiplayer on a LAN

A `spa` desktop can host its world for other copies of the app. Each guest runs its own binary, whose page is served from its own `127.0.0.1`, and opens one WebSocket to the host machine. Nothing else crosses the network: the SPA, assets, `/__rb/info` and `/__rb/action` stay behind the host's token, and a guest never gets that token.

```ts
desktop: { mode: "spa", guests: { max: 8 } }      // closed until the UI opens it
```

The host's page opens and closes the world at runtime, so there is no rebuild between "single player" and "host a world":

```ts
// "Host a world": listen on every interface (the port stays the same, so this page keeps working) and set a passphrase
await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: "orange-kettle" }) });
// "Stop hosting"
await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) });
// Who is here: `/__rb/info` has listen, lan (this machine's addresses, to show friends), sockets, and guests { open, connected, max, version }
```

A guest connects to the host's address with the join query; `worldSocket` from `@rustybuns/shell-bun/client` builds it:

```ts
import { worldSocket, playerId, wireVersion } from "@rustybuns/shell-bun/client";
worldSocket("http://192.168.1.20:4000/ws", { join: "orange-kettle", uid: playerId(), name: "Ada", v: await wireVersion() });
```

`RB_VERSION` is only defined in the host bundle, not in your client build. `wireVersion()` asks the guest's own host (`/__rb/info`) which version it checks guests against. The guest runs the same app, so a matching build sends what the remote host expects.

What the host checks before upgrading, in order, each with a JSON `{ error }` body:

| Check | Response |
|---|---|
| `join` missing or wrong, or the world is closed | `403` |
| `v` differs from the host's build (`RB_VERSION`, or `guests.version`) | `409 version_mismatch` with `expected` |
| `guests.max` sockets already connected | `503 full` |
| `uid` not `1-64` of `[A-Za-z0-9_-]`, equal to the host's id, or `name` not 1-32 printable characters | `400 bad_identity` |

The world then sees the same headers it would on Cloudflare: `X-User-Id` and `X-User-Name` from the guest's query, `X-World-Slug` and `X-World-Owner` from the host, and `X-RB-Principal: host | guest`. The host's own socket keeps the local identity, and its `?uid=` is ignored. Your world class can do its own checks before accepting the socket; the `host` module gets `ctx.shell` (`comms.sockets()`, `rebind()`) and `ctx.guests`.

The trust model is a join passphrase plus trust-on-first-use identity: a `uid` is whatever a guest says it is, so treat it as a stable handle, not proof. There is no TLS, so this is `ws://` on a network you trust. Guest pages are served over http from their own host, so a `ws://` target is not mixed content; a page served over https could only open `wss://`. Two instances on one machine coexist (the token cookie is named per port), which is the easy way to test. Running a world on a public box or through a relay is the same wire protocol, but not something this version sets up.

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
| [fm-daw](apps/fm-daw/README.md) | an FM groovebox: live Rust (wasm) or TS engine in an AudioWorklet, QWERTY + MIDI recording, a world that saves your groove |
| [hippo-tycoon](apps/hippo-tycoon/README.md) | four angry oil-baron hippos in a Victorian oil pan: solo, couch, LAN party (`guests`) and online rooms, one World class on Cloudflare and in the binary |
| [auto-rig](apps/auto-rig/README.md) | drop in a 3D model, get a skeleton, skin weights and draggable closed-chain IK; the rigger in Rust and TypeScript with identical output |
| [park-hide-seek](apps/park-hide-seek/README.md) | 3D hide and seek on real Yosemite terrain, campers vs park rangers, vs AI or on a LAN: one game run by the page or by the world, each player sent only what they can see |
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
