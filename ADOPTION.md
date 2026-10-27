# Adopting Rusty Buns

Rusty Buns is a dev dependency. It never ships in your app: it boxes and deploys the app you already have. Everything it asks you to adopt is a plain shape you'd want anyway, so leaving is a `git rm`, not a rewrite. What it is and why: the [README](README.md#features).

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

### The same five, elsewhere

If you know another platform, here's roughly what each primitive maps to there. Rusty Buns doesn't deploy to these (Fly is [on the roadmap](notes/ROADMAP.md)); the table is for finding your bearings.

| Primitive | AWS | Vercel | Fly.io |
|---|---|---|---|
| **http** | Lambda behind a function URL or API Gateway | Vercel Functions | a Machine running your server |
| **comms** | API Gateway WebSockets, state in DynamoDB | none built in: Pusher, Ably or PartyKit | a long-lived process holding the sockets |
| **storage** | RDS or Aurora (SQL), DynamoDB (KV), S3 (blob) | Postgres and Redis from the Marketplace, Vercel Blob | sqlite on a volume, Fly Postgres, Tigris (blob) |
| **memory** | per-invocation, sized by the function's memory setting | per-invocation | the whole process |
| **identity** | Cognito, or IAM between services | middleware plus Clerk or Auth.js | your own auth, or a proxy in front |

The difference: on each of those the five pieces are separate products with separate APIs. Here they're the Cloudflare shapes everywhere, with a local twin for each, so the laptop, the edge and the box run the same code. Which framework feature lands on which primitive (Astro API routes, SvelteKit form actions, Nuxt's storage) is in [Each framework, as the five primitives](FRAMEWORKS.md#each-framework-as-the-five-primitives).

## It's a Bun app underneath

Anything Bun can reach, your app can reach:

- **Node:** your handlers and most npm packages run as they are. Native `.node` addons need a Bun rebuild or a swap ([agent-office](apps/agent-office/README.md) replaces node-pty with ~80 lines over `Bun.spawn`).
- **Rust:** a cdylib over `bun:ffi` on the host, or wasm in the page.
- **Other processes:** `Bun.spawn` a binary, stream its stdio, or talk to it on localhost. The host reaps it on exit.

## Questions people ask

**"No lock-in", but I have to install Bun?** To build, yes. The promise is about your app: `src/` never imports us, and leaving leaves a `fetch` handler, a Durable Object-shaped class and D1-shaped storage. The tool is a Bun program (`bun:sqlite`, `Bun.serve`, `bun build --compile`, `bun:ffi`), and the people who run your app never install it: it's inside the binary, or in the box's `oven/bun` image. A Node host for the box is [#2244](https://github.com/QuinnsCode/RustyBuns/issues/2244).

**Wrangler already gives me local twins, and they're more faithful.** For edge work, use them: `rustybuns dev` is `alchemy dev`, which runs workerd. The twins answer a different question. Miniflare is a simulator for your laptop while you develop; the twins are what runs the app for real on a laptop and on a box, in one file, with your users' data in it. What they hold to is the contract the edge enforces: its limits, with its errors, and the behaviour [borg](apps/borg/README.md) checks against a real deploy. Where they're stand-ins is listed below, so nothing differs quietly.

**Nitro already does multi-target deploys. Why another layer?** Nitro builds server output for a platform. It doesn't give you a one-file desktop app, local twins that refuse what the edge refuses, a `plan` that prices the deploy before `deploy` will run, or a typed stack. And it isn't a layer under or over Rusty Buns: a Nuxt app's Nitro `cloudflare-module` output is the Worker we deploy, as it is. When a deploy breaks, the layers are Nitro (your build), Alchemy (the resources) and us (the config that wires them), and `plan` names the resource before anything runs. The one patch we carry on Alchemy is four lines: deleting a queue consumer whose queue is already gone is a no-op.

**These are Cloudflare's shapes, so it's a Cloudflare tool with an offline mode.** The shapes are Cloudflare's on purpose: a `fetch` handler, a Durable Object and D1 are small, documented and already run in production, and workerd is open source. Inventing a sixth shape would be the lock-in. The twins are the proof they run off Cloudflare, on a laptop and a Hetzner or Railway box. Coming from AWS or Vercel, [The same five, elsewhere](#the-same-five-elsewhere) is the map.

**Is the desktop app a real desktop app?** It's your web app, runnable offline as one file: the backend on a local host, the UI in the user's Chrome. No native menus, tray or auto-update yet. You build on macOS or Linux (a Linux server will do), and it cross-compiles for Mac, Windows and Linux. Mac signing is built in and waits only on an Apple Developer ID; Windows signing isn't built yet. If you need a native window, use Electron or Tauri. The 60 to 110 MB is the Bun runtime, not the framework; any one file that carries a JS runtime (Node's single executable apps, `deno compile`) lands in that range. The Worker ships only your code, and the box is a small bundle on `oven/bun`.

**Alpha, one author, 30 examples. Breadth over depth?** It's alpha (`0.1.x`) and has one maintainer, so pin a version. The examples aren't a portfolio; they're the test bed. Each one is a real app that has to keep booting on every target, [borg](apps/borg/README.md) checks the twins against a deploy, and [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md) counts public apps that boot unchanged. Effect sits in the deploy layer, which is opt-in, and the host's background scheduler; the bindings and their twins are plain TypeScript, so most contributions never touch it.

**Why not have my agent write a 200-line Hono and sqlite server?** For one target, do. The cost comes with the second and third: a laptop build, an edge deploy and a box, each written for this app, drifting apart, each finding the edge's limits on its first deploy. Here it's one tested contract: the same config, the same limits, and a plan before any spend, and your agent gets those for free on the next app too.

### Where the twins differ from the edge

| Binding | Edge | Twin on the desktop and box |
|---|---|---|
| D1, KV, R2, DO storage, queues | Cloudflare's | sqlite and a folder, with the edge's limits and errors; borg checks both |
| CPU and memory | per isolate | per request: RSS growth past 128 MB or CPU past `worker.cpuMs` gets the edge's 503 |
| Vectorize | approximate nearest neighbour | a sqlite table queried by exact scan: same API, exact results |
| Workers AI | the models | `@cf/baai/bge-*` embeddings from a small built-in embedder (shared words land near each other, not meanings); every other model says it runs only on Cloudflare |
| Worker Loader | a sandboxed isolate | the host's own process: no sandbox, so load only code you trust |
| Images | transforms | the original image, `info()` from its header |
| Email sending | sent | written as an `.eml` file in the data dir |
| Rate limits, Containers | Cloudflare's | left out of the desktop; the app runs without them |

The full per-target table is [Where things run](REFERENCE.md#where-things-run).

### Where the same code stops being the same

A binding that swaps is easy. The hard cases are where the target changes what your app's own logic has to assume. None of these show up as a compile error, and most pass on the desktop first.

| Assumption | Desktop and box | Edge | What to do |
|---|---|---|---|
| **State lives as long as the process** | one long process: module globals, in-memory caches, `setInterval` and Durable Objects stay put (the shell never evicts a DO unless a test calls `evict()`; `RB_EDGE_LIKE=1`, or `rustybuns smoke --edge-like`, evicts one after 70 s idle and names every `process.env` key read while the Worker loads. and restarts the host on the same port every 100 requests (`RB_EDGE_RECYCLE=N`) so module globals reset) | isolates come and go, and an idle DO is evicted after a minute or two | keep anything that must survive in storage or DO storage; a cache in a global is a cache, not a record |
| **One copy of each Durable Object** | one per process, so a second box replica means two "singletons" | one per id, worldwide | run one box per app, or put the coordination on the edge |
| **Who the user is** | a per-launch token (one person) on the desktop, a guest id on the box | your Worker's auth or Cloudflare Access (many people) | write permission checks against `X-User-Id` from day one; a desktop app that never checks is a multi-user bug on the edge |
| **Where the data is** | a sqlite file on this laptop or volume | D1 in Cloudflare | they never sync. Desktop and edge copies of an app are separate databases unless the app syncs them itself |
| **Rust on the hot path** | the cdylib over FFI | no FFI: wasm, or the TypeScript twin | test the twin as hard as the Rust; on the edge it may be the only path that runs |
| **Settings at import** | `process.env` is there before your modules load | `env` arrives with the request | read config inside the handler, not at a module's top level ([#2278](https://github.com/QuinnsCode/RustyBuns/issues/2278) is what this looks like) |
| **What npm can do** | Bun: native addons (after a rebuild), `Bun.*`, `bun:sqlite`, `new Function` | Workers: none of those | keep `Bun.*` behind the host; check the edge with `rustybuns dev` before you lean on a package |

The frameworks add one more: a framework that doesn't build a Worker (Next.js without OpenNext, Angular on Express, Gatsby's Functions) has no edge column yet. See the [matrix](FRAMEWORKS.md#matrix).

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
