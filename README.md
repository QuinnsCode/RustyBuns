# Rusty Buns (scaffold, slice 1)

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
                     bindings/: D1 and KV over bun:sqlite, DO-storage over sqlite
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
| `build desktop` -> compiled binary with embedded client | working (81 MB, Linux) |
| Alchemy generation | generated against 2.0.0-beta.77 docs; not yet run against a real account |
| Durable Object binding in async Workers | generated with a comment; API shape unverified |
| Hetzner target | generated as a draft; Bun-vs-Node on `Hetzner.Service` unverified |
| R2 -> directory adapter, DO -> in-process engine | slice 2 |
| Rust crate + loader | written; needs `cargo` to build (`bun native/build.ts`) |
| `--no-orphans` | not wired; launcher reaps children on exit instead |
| Cross-OS desktop builds, signing, installers | CI matrix, slice 3 |

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
