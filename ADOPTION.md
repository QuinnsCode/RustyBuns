# Adopting Rusty Buns

Rusty Buns is a dev dependency. It never ships in your app; it boxes and
deploys the app you already have. Everything it asks you to adopt is a plain
primitive you would want anyway, so leaving is a `git rm`, not a rewrite.

## What it is

An abstraction that wraps your app so it ships everywhere: a desktop binary, a
Cloudflare Worker, a Linux server. You do not have to write Rust or use Bun
yourself; they are the engine underneath, and Rust is an opt-in escape hatch.

It is not a UI toolkit, so it does not compete with Electron or Tauri on native
windows, menus or tray. It competes on reach: the same app and the same backend
also deploy to the edge and to a VPS, and the deploy is typed through Alchemy
and Effect. Because it already has a runtime, storage, server actions, a build
and a deploy, it behaves like a full-stack framework, but it asks you to adopt
only the shapes Cloudflare already standardized. See the
[README](README.md#the-questions-everyone-asks) for the head-to-head.

## Who this is for

| You are | You have | You want | What you touch |
|---|---|---|---|
| A **web team** with a Vite app (React, Vue, Svelte, Solid, anything Vite builds) | a client, maybe a Workers/Node backend | a desktop binary, cloud deploys, no native UI work | `init`, `add desktop`, done |
| A **frontend dev** who wants Rust | a Vite app, hot paths in TS | Rust in a worker (WASM) or on the server (FFI) without a rewrite | `add rust <name> --front` or `--back` |
| A **Rust backend** with no UI | crates, maybe a CLI | a real web UI and a shippable app | `add rust --back` + any Vite frontend |
| A **Node backend** (Express, Hono, Fastify, plain `fetch`) | routes, a DB | the same thing on a laptop and in the cloud | mount it as the `fetch` handler |
| A **Workers app** (RWSDK, Hono on CF, plain Worker) | `wrangler.jsonc` with bindings | desktop + other clouds without leaving Cloudflare | `init` reads the wrangler; bindings get local twins |
| A **local-AI or media tool** | a Python/C++ process (whisper.cpp, llama.cpp, ffmpeg) | to ship it as one app with a web UI | spawn it from the Bun host, talk over stdio/TCP/HTTP |

React is our reference because our example app is React. Nothing in the
framework knows what the client is; it serves a directory and a WebSocket.

## The primitives

Your app is abstracted to five things. Each has a real implementation on every
target, so choosing them is not a lock-in; it is choosing the shape a
long-lived app has anyway.

| Primitive | What it is | Why it is not a regression |
|---|---|---|
| **http** | a Workers-shaped `fetch(request, env, ctx)` | the standard; Hono, RWSDK, plain handlers, Node via adapter |
| **comms** | WebSocket in, `send/close/attachment` out; TCP/UDP where the runtime allows | the DO socket contract, the Bun socket contract, same names |
| **storage** | `get/put/delete/list` + alarms (DO shape); SQL via D1 shape; KV; blob (R2 shape) | the CF shapes are small and sqlite/Postgres/dirs fit them |
| **memory** | in-process state, `Worker` threads, `SharedArrayBuffer`, optional FFI | a capability flag (`caps.ffi`, `caps.sab`), never assumed |
| **identity** | `X-User-Id`-style headers vouched by whoever fronts the app | edge middleware, box middleware, launch token: same downstream contract |

## The combinatorics

Any primitive can be satisfied by any provider in its row. Alchemy (A) provides
the managed ones; Rusty Buns (RB) provides the in-process ones. Mix per target.

| Primitive | Implementations |
|---|---|
| http | A Cloudflare Worker · A Hetzner Service · A Fly · A Railway Service/Function · RB `serve()` on any VM or laptop |
| comms | A Durable Object (hibernating WS) · RB in-process DO (WS) · RB TCP/UDP/Unix (server-to-server) · WebRTC/WebTransport (browser, planned) |
| storage: DO-shape | A DO storage · RB sqlite (json or v8 codec) · RB memory |
| storage: SQL | A D1 · A Neon · A PlanetScale · A Hyperdrive · RB sqlite (D1 shape, migrations) |
| storage: KV | A Cloudflare KV · RB sqlite table · Redis (planned via Alchemy) |
| storage: blob | A R2 · RB directory (embedded, beside, or lazy-fetched) |
| memory | RB Bun workers + SAB · RB Rust via `bun:ffi` · browser workers + SAB · Rust via WASM |
| identity | framework auth (Better Auth on any A database layer) · A Cloudflare Access · RB launch token |
| logs | A Pipelines · A Axiom · stdout |

So a realistic combination: **http** Cloudflare Worker, **comms** Durable Object,
**SQL** D1, **blob** R2 on the edge; the identical app with **http** `serve()`,
**comms** in-process DO, **SQL** sqlite, **blob** embedded dir on the desktop;
and with Postgres + a dir on a Volume on Hetzner. One config, three columns.

## Interop: it is a Bun app underneath

The host is a Bun process, so anything Bun can reach, your app can reach:

- **Node**: your handlers, libraries, most npm packages run as-is (native `.node` addons need a Bun rebuild or an FFI swap).
- **Rust**: cdylib via `bun:ffi` (pointer-over-SAB, nanosecond calls); WASM in the tab.
- **Python / C / C++ processes**: `Bun.spawn` a whisper.cpp or llama.cpp binary, stream stdio, or talk TCP/HTTP on localhost. The host owns its lifetime and reaps it on exit.
- **Anything with a socket**: TCP/UDP/Unix from the host, WebSocket from the tab.

## Phases of adoption

1. **Infer.** `rustybuns init` reads `package.json`, `vite.config.*`, `tsconfig` paths, `wrangler.*`. Writes `rustybuns.config.ts` and the Alchemy stack. Nothing in your source changes. You can stop here and just have typed deploys, which is the Effect payoff on its own.
2. **Desktop.** `rustybuns add desktop` scaffolds a plain-SPA entry and a world class; `build desktop --dev` + `run desktop` boots your app on a local Bun host with sqlite behind every binding, server actions running for real, and an intro page if you have not pointed at a component yet. `build desktop` gives you binaries.
3. **Move the server.** Add `box: { provider: "hetzner" }` (or fly, railway) to targets. Same engine, same bindings, different Layer. `rustybuns deploy box`.
4. **Opt into compute.** `add worker <name>` for a typed worker over SAB in the tab; `add rust <name> --front|--back` when TS is not enough. Profile first; the TS path always remains as the fallback.
5. **Eject.** `rustybuns eject` copies the generated Alchemy program to your root. Delete the config and the dev dependency; every primitive you adopted is still just a fetch handler, a DO-shaped class, and sqlite/D1-shaped storage.

## What you install

```
devDependencies:
  @rustybuns/cli         the commands
  @rustybuns/shell-bun   the host runtime; bundled into the desktop binary at build time
```

Neither is imported by your web app. `shell-bun` is imported only by the
generated host, so it is a dev dependency too: it ships inside the binary, not
inside your `node_modules` in production.
