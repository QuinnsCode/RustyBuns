# Adopting Rusty Buns

Rusty Buns is a dev dependency. It never ships in your app: it boxes and deploys the app you already have. Everything it asks you to adopt is a plain shape you'd want anyway, so leaving is a `git rm`, not a rewrite. What it is and why: the [README](README.md#the-questions-everyone-asks).

## Who it's for

| You have | You want | What you do |
|---|---|---|
| a **Vite app** (React, Vue, Svelte, Solid, anything Vite builds) | a desktop binary and cloud deploys, no native UI work | `init`, `add desktop`, done |
| a **Workers app** (RWSDK, Hono, a plain Worker) | desktop and other clouds, without leaving Cloudflare | `init` reads your `wrangler.jsonc`; every binding gets a local twin |
| a **Node backend** (Express, Hono, Fastify, plain `fetch`) | the same thing on a laptop and in the cloud | mount it as the `fetch` handler |
| **hot paths in TypeScript** | Rust where it pays, without a rewrite | a cdylib over `bun:ffi` or wasm in the page, with the TS path as fallback (the `add rust` scaffold is planned) |
| a **local AI or media tool** (whisper.cpp, llama.cpp, ffmpeg) | one app with a web UI | `Bun.spawn` it from the host, talk over stdio, TCP or HTTP |

React is our reference because our examples use it. Nothing in the framework knows what the client is: it serves a directory and a WebSocket.

## The five primitives

Your app comes down to five things. Each one has a real implementation on every target, so choosing them isn't lock-in.

| Primitive | The shape | Cloud | Laptop or box |
|---|---|---|---|
| **http** | a Workers-style `fetch(request, env, ctx)` | Cloudflare Worker | `Bun.serve()` |
| **comms** | WebSockets in the Durable Object shape (`send`, `close`, attachments, hibernation) | Durable Object | the same class, in-process |
| **storage** | D1 (SQL), KV, R2 (blob), Durable Object storage | D1, KV, R2 | sqlite and directories |
| **memory** | in-process state, workers, `SharedArrayBuffer`, optional FFI | (no FFI on the edge) | all of it |
| **identity** | `X-User-Id`-style headers, vouched by whatever fronts the app | your Worker or auth | a launch token (desktop), a guest id (box) |

So one app runs as a Worker + Durable Object + D1 + R2 on the edge, as `Bun.serve()` + an in-process object + sqlite + a folder on the desktop, and the same way on a Hetzner or Railway volume. One config, three columns. The full provider matrix is in [notes/ROADMAP.md](notes/ROADMAP.md).

## It's a Bun app underneath

Anything Bun can reach, your app can reach:

- **Node:** your handlers and most npm packages run as they are. Native `.node` addons need a Bun rebuild or a swap ([agent-office](apps/agent-office/README.md) replaces node-pty with ~80 lines over `Bun.spawn`).
- **Rust:** a cdylib over `bun:ffi` on the host, or wasm in the page.
- **Other processes:** `Bun.spawn` a binary, stream its stdio, or talk to it on localhost. The host reaps it on exit.

## Adopting it in steps

1. **Infer.** `rustybuns init` reads your app and writes `rustybuns.config.ts`. Nothing in `src/` changes. You can stop here and have typed deploys.
2. **Desktop.** `add desktop`, then `build desktop`. Your app on a local Bun host, sqlite behind every binding, server actions running for real.
3. **A server.** Add `box: { provider: "railway" }` (or `"hetzner"`) to `targets`. Same host, same bindings.
4. **Compute, if you need it.** Profile first, then move the hot path to Rust. The TypeScript path stays as the fallback.
5. **Leave.** `rustybuns eject` copies the generated Alchemy program to your repo. Remove the config and the dev dependency, and what's left is a `fetch` handler, a Durable Object-shaped class, and D1-shaped storage.

## What you install

```
devDependencies:
  @rustybuns/cli         the commands
  @rustybuns/shell-bun   the host; bundled into the binary at build time
```

Your web app imports neither. `shell-bun` is imported only by the generated host, so it ships inside the binary, not in your production `node_modules`.
