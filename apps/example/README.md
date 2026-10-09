# example

> **What it proves:** a whole Worker bundle (a `fetch` handler, a Durable Object, D1 and KV) runs under Bun unchanged, and a Rust cdylib loads over `bun:ffi` with a TypeScript path when it isn't built. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The framework's **worker-mode** test app, kept as small as possible. `build.ts` writes a one-page client and a plain Worker by hand, with no framework:

- `/api/hello` counts visits in D1 and stamps the time in KV
- `/ws` opens a WebSocket to a hibernating Durable Object that counts its own boots in storage

The config keeps the name `druids-curse` from the app it stands in for. On the desktop, every binding runs on sqlite.

```sh
cd apps/example
bun run desktop               # build the desktop binary
bun native-probe.ts           # call the sample Rust crate, or say it took the TS path
```

The probe loads `native/crates/rb_hello` (build it with `bun native/build.ts` from the repo root, which needs cargo) and sums a `SharedArrayBuffer` through a pointer. Without the crate, it prints that it took the TypeScript path and exits cleanly.
