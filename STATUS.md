# Status (slice 4)

Your RWSDK app, unchanged. Alchemy for the cloud. A Bun binary for the desktop.

```
rustybuns init            wrangler.jsonc -> rustybuns.config.ts -> .rustybuns/alchemy.run.ts
rustybuns deploy [stage]  alchemy deploy (Cloudflare; Hetzner when targets.box is set)
rustybuns dev             alchemy dev (workerd + local simulators)
rustybuns build desktop   vite build -> Bun shell + sqlite adapters -> one executable
rustybuns eject           copy alchemy.run.ts to the root; you own the stack now
```

## Layout

```
packages/ports       types only: Http, Comms, Storage, Memory, Reporter, App
packages/shell-bun   Bun.serve shell: token gate, embedded assets, Workers fetch(), WS
                     bindings/: D1, KV, DO-storage over bun:sqlite;
                     durable-object: in-process DOs, WebSocketPair -> 101 -> bridged socket
                     launcher: mint token, Chrome --app or default browser, reap children
packages/cli         init | generate | adopt | plan | deploy | destroy | dev | build | eject
packages/native      loadNative(name, symbols): dlopen with /$bunfs copy-out; null = TS path
native/              Cargo workspace; rb_hello proves cdylib + pointer-over-SAB
apps/example         RWSDK-shaped wrangler.jsonc and a stand-in worker/client build
```

## Status

| Piece | State |
|---|---|
| wrangler.jsonc -> config -> alchemy.run.ts + wrangler.jsonc | working, tested |
| Bun shell: token, COOP/COEP, assets, fetch(), WebSocket | working, tested |
| D1 / KV / DO-storage over sqlite | working, tested |
| `build desktop` spa mode: your Vite SPA + a DO-shaped world class, vouched identity at /ws, sqlite storage | working, proven in the binary across restarts |
| `build desktop` worker mode: full worker bundle + DO classes under Bun | working (plain fetch handlers; real RWSDK bundles need a `cloudflare:workers` shim, not started) |
| `targets: "all"` cross-compile (TS-only) | working (darwin-arm64 built from Linux) |
| D1 migrations dir applied to sqlite at boot, tracked in `d1_migrations`, embedded via `--asset` | working, tested, proven in the binary |
| DO storage codec `json` / `v8` (TypedArray-safe) | working, tested |
| `waitUntil` rejections logged | done |
| `RB_VERSION` define (`<pkg version>+<sha>`) | working |
| Inference from package.json + vite.config + tsconfig paths + wrangler (framework, pm, source dir, aliases) | working, tested on src/ and app/ + ~ layouts |
| `source: { dir, aliases, ignore }` config override, threaded through boundary, scaffold, and host build | working |
| Boundary analysis: client / action / server / leak, per-specifier stubs, action proxies | working, tested |
| `add desktop`: scaffolds packages/desktop + vite.desktop.config.ts + intro page | working |
| Host runs `"use server"` actions for real (`/__rb/action`) with `cloudflare:workers` + `rwsdk/worker` shims | working, proven in the binary against sqlite |
| `/__rb/info` runtime page | working |
| Alchemy generation | generated against 2.0.0-beta.77 docs; not yet run against a real account |
| Durable Object binding in async Workers | generated with a comment; API shape unverified |
| Hetzner target | generated as a draft; Bun-vs-Node on `Hetzner.Service` unverified |
| Durable Objects in-process: WebSocketPair, acceptWebSocket, hibernation handlers, blockConcurrencyWhile, storage, alarm | working, tested, proven in the compiled binary across restarts |
| R2 -> directory adapter | slice 3 |
| Rust crate + loader | written; needs `cargo` to build (`bun native/build.ts`) |
| `--no-orphans` | not wired; launcher reaps children on exit instead |
| Cross-OS desktop builds, signing, installers | CI matrix, slice 4 |

## Desktop modes

- **spa** (default): `desktop.clientBuild` + `desktop.clientDir` are your own Vite SPA build
  (`vite.desktop.config.ts`). `desktop.world` default-exports a class with a Durable Object's
  shape and no base class; the host binds it in-process with sqlite storage and vouches
  `desktop.identity` headers at `desktop.worldPath`. Replaces a hand-written desktop_host.ts.
- **worker**: the worker bundle itself runs under Bun with sqlite adapters for every binding.

## Dependency injection

There is no container. `serve()`, `d1()`, `kv()`, `storage()` are defaults you
call. To eject a service, pass your own object with the same method names.
Every port in `@rustybuns/ports` is structural.

## Run it

```
bun install
bun test packages/shell-bun
cd apps/example
bun ../../packages/cli/src/index.ts init
bun ../../packages/cli/src/index.ts build desktop
RB_NO_BROWSER=1 ./dist/druids-curse      # prints the token URL
```

## What the DO adapter does not emulate (yet)

- Eviction. The shell never evicts, so an app's eviction defenses are no-ops (correct).
- Cross-script DOs (`script_name`). No local twin; left unbound with a comment.
- Tags on `acceptWebSocket` / `getWebSockets(tag)`. Accepted, ignored.
- Storage transactions and `sql` (SQLite-backed DO API). Only get/put/delete/list/alarm.
