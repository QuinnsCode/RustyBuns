# Examples

Each example lives in `apps/` and is not part of any published package: installing `@rustybuns/cli` never downloads them.

| Example | Shows | Install size |
|---------|-------|--------------|
| [tscircuit desktop](apps/tscircuit-desktop/README.md) | A real, heavy Vite app as one self-contained binary, with a Rust engine and a TypeScript fallback | Large (the tscircuit toolchain) |
| [fm-daw](apps/fm-daw/README.md) | An FM groovebox: Rust as wasm in the audio thread, the same crate over FFI on the host, a world DO that saves the project | Small |
| [auto-rig](apps/auto-rig/README.md) | Drop in a model, get a skeleton, skin weights and draggable closed-chain IK; the rigger in Rust and TypeScript with identical results | Small |
| [spa-example](apps/spa-example) | An RWSDK / Cloudflare app on the desktop: a world Durable Object, D1 and KV on sqlite | Small |
| [example](apps/example) | Worker mode, plus a probe for the sample Rust crate in `native/crates/rb_hello` | Small |

## tscircuit desktop

[tscircuit](https://tscircuit.com) (React for electronics) as a desktop app: open a folder of boards, live preview, board analysis, Gerber and BOM export.

- **Build with Bun, ship without it.** The binary carries the UI, the backend, and both engines.
- **Two engines, same answers.** Rust is up to 22x faster on large boards; TypeScript takes over if Rust can't load.
- **Uses:** a plain Vite app (no Cloudflare), `desktop.host` for backend routes, `desktop.native` to embed a Rust library, `desktop.headers` for CDN assets.

```
cd apps/tscircuit-desktop
bun install
bun native/build.ts      # optional: the Rust engine
bun run desktop:dev
```

[Full guide →](apps/tscircuit-desktop/README.md)

## fm-daw

Five FM drums and three FM synths with a step grid, a piano roll, keyboard and MIDI recording, and quantize.

- **One Rust crate, two builds.** `wasm32` renders live audio in the AudioWorklet; the cdylib runs on the host over `bun:ffi`. Both match the TypeScript engine bit for bit, and you can switch engines mid-groove.
- **Speaker-safe by construction.** Params are clamped in the engine and a limiter holds every sample under −1 dBFS; the tests try to break it.
- **Uses:** spa mode with a world (`desktop.world`) that saves the project to sqlite, `"use server"` actions for bounces, and the same world class as a Durable Object for shared jam rooms on Cloudflare.

```
cd apps/fm-daw
bun run build:native     # optional: the Rust engine (cdylib + wasm)
bun run desktop:dev
```

[Full guide →](apps/fm-daw/README.md)

## auto-rig

Drop in a GLB (or a built-in sample) and get a skeleton, skin weights, and IK you can drag, with pinned feet, a free root, and clasped hands.

- **Rigging from geometry alone.** Voxelize, take geodesic slices from the thickest point (a Reeb graph), then bind skin weights by voxel distance.
- **Two engines, identical rigs.** The Rust cdylib (over bun:ffi) and the TypeScript twin agree bit for bit. *Race the engines* times both.
- **Uses:** a `"use server"` action that calls `desktop.native`, a Web Worker fallback in the plain browser, and [closed-chain-ik](https://github.com/gkjohnson/closed-chain-ik-js) for the IK.

```
cd apps/auto-rig
bun run build:native     # optional: the Rust rigger
bun run desktop:dev
```

[Full guide →](apps/auto-rig/README.md)

## spa-example

An RWSDK app boxed for the desktop: its world Durable Object runs in-process, D1 and KV run on sqlite, and the client connects over the same WebSocket it uses on Cloudflare.

## example

The framework's worker-mode test app: the full Worker bundle running under Bun, with a native probe that loads the sample Rust crate.

## Coming next

A minimal `vite-desktop` template: the smallest app that shows every piece (a Vite page, a host route, and a Rust function with a TypeScript fallback). It installs and builds in seconds, and it's the one to copy.