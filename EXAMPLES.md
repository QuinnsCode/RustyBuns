# Examples

Each example lives in `apps/` and is not part of any published package: installing `@rustybuns/cli` never downloads them.

| Example | Shows | Install size |
|---------|-------|--------------|
| [tscircuit desktop](apps/tscircuit-desktop/README.md) | A real, heavy Vite app as one self-contained binary, with a Rust engine and a TypeScript fallback | Large (the tscircuit toolchain) |
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

## spa-example

An RWSDK app boxed for the desktop: its world Durable Object runs in-process, D1 and KV run on sqlite, and the client connects over the same WebSocket it uses on Cloudflare.

## example

The framework's worker-mode test app: the full Worker bundle running under Bun, with a native probe that loads the sample Rust crate.

## Coming next

A minimal `vite-desktop` template: the smallest app that shows every piece (a Vite page, a host route, and a Rust function with a TypeScript fallback). It installs and builds in seconds, and it's the one to copy.