# 🥐 Rusty Buns

**Write a web app once. Ship it as a desktop binary, a Cloudflare Worker and a Linux server.**

You already have a web app. Rusty Buns is a tool you add to the project, not to the app. From one small config file it packs that app three ways: a file anyone can double-click, a Cloudflare Worker, and a server you rent. Your code doesn't change, and nothing of ours ships inside it.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>: one file, double-click it
pnpm exec rustybuns deploy              # Cloudflare, plus a Hetzner or Railway box
```

> **Alpha, `0.1.12`.** Build on macOS or Linux (a Linux server will do); it cross-compiles the desktop binary for Mac, Windows and Linux. The Cloudflare deploy is verified end to end. The Railway and Hetzner boxes are verified live. A brand-new release not installing? Your package manager's minimum release age is holding it back; [Getting started](GETTING_STARTED.md) has the one-minute fix.

## The idea

1. **Every web app with a backend is five things.** A way in (http), a way to talk live (comms), a place to keep data (storage), a place to think (memory) and a way to know who's who (identity).
2. **Cloudflare already gave each of the five a small, standard shape.** A `fetch` handler, Durable Objects, D1, KV and R2.
3. **Rusty Buns gives each shape a local twin on Bun and sqlite.** So the same app runs on a laptop with no cloud account, on a rented server as the same binary, and on Cloudflare from a deploy generated from the same list of bindings.

That makes it a framework for frameworks. It doesn't replace Vite, React, RWSDK or TanStack Start; it sits on top of them, and on top of the three places your app can run. Underneath, it's a Bun program.

## Why a team can bet on it

- **Your app isn't locked in.** It's a dev dependency. It never edits `src/`, never ships in your bundle, and everything it asks you to adopt is a shape Cloudflare already standardized. Leaving is a `git rm`. The tool itself is a Bun program, so building needs Bun 1.4+ even on a Node team; your users never install it.
- **Nothing costs money until you say so.** The whole stack boots on your disk. `plan` prints every billable resource, `deploy` refuses to run without a matching plan, and `destroy` removes what it created.
- **Typed end to end.** The config types your bindings, and the deploy is a typed stack, so a missing piece fails the compiler before a server exists.
- **Tried on real apps.** The examples below are real apps, and [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md) counts how many public GitHub apps per framework boot unchanged.

## Features

Each feature is one line. Click **More** for the long version. The core comes first, then what keeps a team safe, then what else it can box.

### One config, three targets

Your app runs as a desktop binary, a Cloudflare Worker and a Linux server, all from `rustybuns.config.ts`.

<details><summary>More</summary>

`rustybuns.config.ts` is the only file you own. `init` reads your app and writes it. The host, the wrangler config and the infrastructure are generated from it, so the three targets can't drift apart.

```
                  rustybuns.config.ts
       ┌───────────────────┼────────────────────┐
    desktop              edge                  box
  Bun + sqlite      Worker + D1/KV/R2/DO    Bun + sqlite on a volume
  one binary        your vite build         Railway or Hetzner
```

More in [The five primitives](ADOPTION.md#the-five-primitives) and [How it works](REFERENCE.md#how-it-works).

</details>

### Five primitives, and where each one lands

Every app is http, comms, storage, memory and identity. Here's what each one becomes on each target.

<details><summary>More</summary>

| Primitive | Cloudflare | Railway or Hetzner box | Desktop |
|---|---|---|---|
| **http** | a Worker's `fetch` | `Bun.serve()` | `Bun.serve()` on localhost |
| **comms** | Durable Object WebSockets | the same class, in-process | the same class, in-process |
| **storage** | D1, KV, R2 | sqlite and a folder on a volume | sqlite and a folder in `~/.<app-name>/` |
| **memory** | per-request isolate, no FFI | the whole process, Rust over FFI | the whole process, Rust over FFI |
| **identity** | your Worker or Cloudflare Access | a guest id | a per-launch token |

You write against the left-hand shape once. What each primitive would be on AWS, Vercel or Fly is in [The five primitives](ADOPTION.md#the-five-primitives). Every binding per target (git, images, email, secrets) is in [Where things run](REFERENCE.md#where-things-run), and what each framework's features map to is in [Each framework, as the five primitives](FRAMEWORKS.md#each-framework-as-the-five-primitives).

</details>

### Every Cloudflare binding has a local twin

D1, KV, R2 and Durable Objects run on sqlite and a folder on your disk, so the whole stack boots with no cloud account and no bill.

<details><summary>More</summary>

Bun is the one runtime that has every piece built in:

| Bun gives us | So you get |
|---|---|
| `bun build --compile` | one self-contained file per OS, cross-compiled from one machine |
| `bun:sqlite` | D1, KV and Durable Object storage on a laptop, with no database to install |
| `Bun.serve` with WebSockets | Durable Objects with hibernating sockets, in-process |
| `bun:ffi` | Rust cdylibs called directly, with a TypeScript fallback |
| `Bun.spawn` with a terminal | real PTYs without node-gyp (see [agent-office](apps/agent-office/README.md)) |

**The twins refuse what the edge refuses**, with the edge's error: more than 100 bound parameters in a D1 query, a KV key over 512 bytes, a queue message over 128 KB, a Durable Object value over 2 MiB. A query that works locally doesn't fail on the first deploy. The desktop and box hosts also measure each request: one that grows the process by more than 128 MB, or uses more CPU than `worker.cpuMs` (`RB_CPU_MS=10` tries the Free plan's), gets the edge's 503.

**Postgres apps keep their database.** A `hyperdrive` binding puts Cloudflare Hyperdrive in front of it on the edge, and the desktop and box connect to the same `DATABASE_URL` directly. `init` adds one when the app uses `pg`, `postgres`, or Drizzle or Prisma on postgresql. With `local: "pglite"` an offline desktop gets Postgres too: PGlite runs in the data dir with your migrations applied at boot. Or the stack owns the database: `origin: { neon: { branch: "prod" } }` makes a Neon project and branch at deploy.

**An app already on wrangler keeps what its config declares.** `init` carries over its bindings (Workflows, Vectorize, Analytics Engine, Worker Loaders and Containers among them), queue consumers with their dead-letter queues, routes, custom domains and observability. Each `env.<name>` block becomes a stage, deployed with `--stage <name>`. On the desktop, Workflows run in-process with their steps, sleeps and events kept in sqlite, so a run cut off by a restart picks up where it was. A Vectorize index is a sqlite table queried by exact scan, Analytics Engine points land in `analytics.sqlite`, and the Worker Loader runs its code in the host's own process (not a sandbox). Workers AI has no model locally: `env.AI` answers `@cf/baai/bge-*` embeddings with a small built-in embedder (shared words and word stems land near each other, not meanings), and every other call says it runs only on Cloudflare. Email sending, rate limits and Containers are left out of the desktop, and the app runs without them. An outbound `fetch` with `cf: { cacheTtl }` or `cacheEverything` is answered from an in-process cache for that TTL, as the edge cache would.

D1 migrations apply at boot, and `"use server"` functions run for real against sqlite. It adds up to [a full-stack framework, by accident](REFERENCE.md#a-full-stack-framework-by-accident).

</details>

### A one-file desktop app in real Chrome

`build desktop` gives you one double-clickable file per OS. Your backend runs on a local Bun host and the UI opens in the user's Chrome.

<details><summary>More</summary>

**Why not Electron?** Electron makes you write two programs (a Node main process and a renderer) that talk over IPC, and ships a whole Chromium with every app. That backend can't go to the edge, and moving it to a server is a rewrite. Rusty Buns has no main process. Your backend is a plain `fetch` handler, the same one Cloudflare runs. On a laptop it serves your page to the Chrome you already have. On a server it serves it to everyone.

**Why not Tauri?** Tauri is lighter, but your backend becomes Rust commands, and your UI runs in whatever webview the OS has (WebKit on macOS and Linux, WebView2 on Windows), each with its own gaps. Rusty Buns keeps the backend in TypeScript and renders in real Chrome, so `SharedArrayBuffer`, WebGPU, AudioWorklets and Web MIDI just work.

The host binds to `127.0.0.1`, gates every request on a per-launch token, and keeps your data in `~/.<app-name>/`. Your users never install Bun: it's inside the binary. Details in [The host](REFERENCE.md#the-host).

**Bring your own server.** A Vite frontend whose dev server proxies `/api` to a Node server of its own keeps that server. `targets.desktop.server` bundles it into the binary, and the host runs it beside itself, with its data in the app's data dir, WebSockets included. A proxy that sends `/api` to one server and `/img` to another runs both. Native addons (`sharp`, `better-sqlite3`) ship with it, with a build for each target; one it can't carry stops the build with its name, not the app at launch. `init` sets it up when it finds the servers. Desktop and box only, since a Worker can't run a Node server.

**Opens on a Mac without a warning.** On a Mac with a Developer ID certificate, `build desktop --sign` signs the darwin binaries, and `--notarize <profile>` also sends a `.zip` of each to Apple. The profile is the one you saved with `xcrun notarytool store-credentials`, so your Apple password stays in the keychain.

</details>

### Your bindings are typed from the config

`EnvOf<typeof config>` gives your handler its bindings type, so deleting one from `rustybuns.config.ts` fails `bun run typecheck` wherever it was used.

<details><summary>More</summary>

`defineConfig` keeps the binding names and types you wrote. A var is a `string`, a secret a `string` (or `string | undefined` when `optional`), and any other binding is whatever you map its type to:

```ts
import type config from "../rustybuns.config";
import type { EnvOf } from "@rustybuns/cli/config";

type Bindings = EnvOf<typeof config, { d1: D1Database; kv: KVNamespace; r2: R2Bucket }>;
```

Types only: nothing is generated and nothing ships in your bundle.

</details>

### Things are functions

An operation is one function with a name, a schema and a permission. HTTP, MCP, WebMCP, a CLI and a skill file are thin views of it.

<details><summary>More</summary>

`@rustybuns/ops` has no dependencies. Auth happens at the edge, and `ops.call` checks the permission again on every run. See [OPS.md](OPS.md).

</details>

### Plan before anything costs money

`plan` typechecks the generated stack and shows what it would create and bill. `deploy` refuses to run without a plan for that exact config, then asks.

<details><summary>More</summary>

The deploy side is a typed Alchemy + Effect stack. Cloudflare, Hetzner and Railway are each a typed Layer, so swapping a target is one line of config and the compiler tells you what's missing before anything is created. `plan` and `deploy` print every billable resource, marked fixed or usage, and a large Hetzner box is refused unless the config says so. `destroy` removes everything it created.

`plan` only diffs your config against Alchemy's state. `drift` goes the other way: it re-reads the live account and shows what changed outside the stack (a dashboard edit, a `wrangler deploy`, a deleted resource). It changes nothing; `drift --repair` puts the account back to the last deploy, after the same two-step yes as a real destroy, and is refused with no terminal.

Trying someone else's repo? `plan --offline` builds and typechecks with no login at all and lists the whole stack as creates, so neither their account nor yours is touched.

The monthly bill comes from the fan-out, so the desktop and box hosts count every binding call per request, cron tick and queue message. `plan --usage` turns a run of that into a monthly estimate and flags a cron that keeps a Durable Object awake around the clock ([COSTS.md](COSTS.md#what-it-would-cost-a-month-plan---usage)). See [Typed deploys](REFERENCE.md#typed-deploys-thanks-to-effect), [Deploy to Hetzner](REFERENCE.md#deploy-to-hetzner), [Deploy to Railway](REFERENCE.md#deploy-to-railway) and [COSTS.md](COSTS.md).

</details>

### Smoke test an app without touching it

`rustybuns smoke [dir]` copies your app to a throwaway folder, installs, inits, builds and boots it on the local twins, and says whether `GET /` answered.

<details><summary>More</summary>

The copy has no `.env` or `.dev.vars`, gets a fake for every secret the app names, runs with an empty HOME and no cloud logins, and the host runs in Seatbelt on macOS. It tries the mode `init` picks, then the app's own Worker build if it has one, prints where it stopped when it fails (`install`, `init`, `build`, `boot` or `request`), and deletes everything afterwards unless you pass `--keep`. Nothing is deployed and no account is read, so it costs nothing. The same steps run over public GitHub repos in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md).

</details>

### Keys you can take back (experimental)

Test stacks mint their own secrets on create and drop them on destroy. Prod secrets come from 1Password behind your Touch ID.

<details><summary>More</summary>

Set `experimental.wheel` to `"agent"` and CI and agents can spin stacks up as often as they like with nothing to rotate. Set it to `"human"` and prod secrets resolve from 1Password at deploy time. Either way a committed `.env.schema` lists every secret by name, never value, so any machine knows what's needed. The 1Password path is untested so far; see [Who holds the keys](REFERENCE.md#who-holds-the-keys-experimental).

</details>

### Leaving is a `git rm`

Rusty Buns is a dev dependency. It never edits `src/`, never ships in your bundle, and everything you adopt is a shape Cloudflare already standardized.

<details><summary>More</summary>

There's no framework API to unwind: your app stays a `fetch` handler with D1, KV, R2 and Durable Object bindings. Adopt it one target at a time, and drop it the same way. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Defaults you can take over

The defaults are a starting point, the way a copied component is: swap a piece, or `eject` the deploy program and own it.

<details><summary>More</summary>

Rusty Buns generates the host, the wrangler config and the Alchemy stack from `rustybuns.config.ts`. When a default stops fitting, change that piece and keep the rest: Postgres for D1, your own server beside the host, Rust or TypeScript for the hot path. `rustybuns eject` copies the Alchemy program to your repo, and from then on you own it. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Bun and Vite are the stack, the rest swaps out

Bun runs your app and Vite builds it. Everything else (Alchemy, Effect, Rust, Hetzner, Railway) is an option you add when you want it and drop when you don't.

<details><summary>More</summary>

Bun is the host on the desktop and on a box, and Vite builds the client. That's the whole floor. Deploy tooling is opt-in: a project that only builds the desktop binary never runs `add deploy`, so it never gets Alchemy or Effect. Rust is an optional engine with a TypeScript twin. Each deploy target is one Layer you can swap for another or leave out. Nothing here is a thing your `src/` imports, so any of it can go without touching your app. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Static sites box too, no app needed

`rustybuns init` in a plain HTML, Jekyll, Hugo or MkDocs repo (a GitHub Pages site, say) boxes its build output for the desktop and the web.

<details><summary>More</summary>

There's no `package.json` to read, so `init` looks for the site itself: an `index.html` at the top or in `docs/`, `public/`, `site/` or `www/`, a Jekyll `_config.yml` with its `_layouts/`, a `hugo.toml`, or a `mkdocs.yml`. It writes a config whose build is the generator's own (`rustybuns jekyll build`, `hugo`, `mkdocs build`), or `rustybuns copy-site` for hand-written HTML, plus a `package.json` that holds Rusty Buns as a dev dependency. The web side is an assets-only Worker, and both it and the desktop app answer a missing page with the nearest `404.html`. Like Cloudflare and GitHub Pages, the host serves `/ops` from `ops.html`.

**Jekyll.** `init` layers `_config.rustybuns.yml` over your config: it keeps `dist/`, `desktop/` and Rusty Buns' files out of the site, serves from `/` rather than a Pages `baseurl`, and sets the defaults GitHub Pages adds on its own (a page with no `layout` gets your `page` or `default` layout). The other Pages extras (Markdown with no front matter rendered as a page, `.md` links pointed at the `.html`, titles from a first heading, a `README.md` as its folder's index) need their gems, so `init` turns on the ones your pages lean on and the build installs them. `rustybuns jekyll build` runs your own Jekyll (through `bundle exec` if there's a Gemfile) when your Ruby is 3 or later; otherwise it runs in a `ruby:3.3` Docker container, since macOS ships Ruby 2.6. The container's gems live in a Docker volume, so only the first build waits for the install.

**Hugo and MkDocs** still have to be installed, and `init` says so when one isn't on your PATH.

</details>

### Pages Functions run as a Worker

A Cloudflare Pages project's `functions/` folder becomes a Worker on every target, with each handler unchanged.

<details><summary>More</summary>

`init` spots a Pages project: a `functions/` folder with handlers in it and no Worker `main`. It sets the Worker's build to start with `rustybuns pages-functions`, which writes `.rustybuns/pages/`: one route per file (`[id].ts` is a param, `[[path]].ts` a catch-all) in Pages' order, the `_middleware` chain, and a small adapter that hands each handler Pages' own context (`request`, `env`, `params`, `data`, `next`, `waitUntil`). The Worker sees requests before the static files, as Pages Functions do, and `public/_routes.json` still sends its excludes straight to the files. A new file under `functions/` is a new route on the next build. The adapter is copied into the app and imports nothing, so Rusty Buns stays out of the bundle. Tried on a Pages app with 100 routes, two middlewares, D1, KV, R2 and Vectorize: it boots on the desktop with no edits.

</details>

### Postgres instead of D1

Swap D1 for your own Postgres: PGlite on the desktop, Hyperdrive in front of Neon, Supabase or RDS on the edge.

<details><summary>More</summary>

It's a code change, not a config switch: D1's `env.DB.prepare(...)` is sqlite-shaped, so your code uses a Postgres client (`pg`, `postgres`, Drizzle or Prisma) over `env.HYPERDRIVE.connectionString`, and `init` adds the `hyperdrive` binding when it sees one. The desktop and box connect to `DATABASE_URL`, or serve PGlite from the data dir with `local: "pglite"`. KV, Durable Object storage, queues and workflows still use sqlite locally; only the relational database moves. [borg-postgres](apps/borg-postgres/README.md) runs the same Worker on both and checks inserts, `jsonb`, rollback and concurrent upserts. Caveats (PGlite is one shared session) are in [Where things run](REFERENCE.md#where-things-run).

</details>

### An Elysia app, unchanged, as a desktop file

A real Elysia + Drizzle backend becomes one binary with its own Postgres, without editing its `src/`. It doesn't reach Cloudflare yet.

<details><summary>More</summary>

[elysia-conduit](apps/elysia-conduit/RUSTYBUNS.md) is bedstack's RealWorld backend (Elysia 1.4, Drizzle, postgres.js), copied in as it is. A short entry exports `new Elysia().use(setupApp)` in place of their `.listen()`, and a `hyperdrive` binding with `local: "pglite"` applies their Drizzle migrations at boot. Their own Postman suite (32 requests, 311 assertions) passes on the dev host and on the 109 MB compiled binary. The pain is listed too: `init` doesn't recognise Elysia yet, the entry has to copy the PGlite port into their `POSTGRES_*` variables, and on Workers the unchanged app breaks five ways ([#2278](https://github.com/QuinnsCode/RustyBuns/issues/2278)), starting with a Postgres client built at import time.

</details>

### Rust when you need it, TypeScript always

Drop in a Rust engine for the hot path. It ships with a TypeScript twin that gives the same answer, and the app falls back to it if Rust can't load.

<details><summary>More</summary>

Only reach for Rust when TypeScript isn't fast enough. `@rustybuns/native` loads a cdylib over `bun:ffi` on the host (or you ship it as wasm in the page), and returns null when it can't, so you take the TypeScript path. Several examples race the two side by side so you can see what Rust buys you before you commit: [tscircuit-desktop](apps/tscircuit-desktop/README.md) (up to 22x), [fm-daw](apps/fm-daw/README.md) (bit-identical audio) and [auto-rig](apps/auto-rig/README.md).

</details>

### LAN multiplayer with no server

A desktop app can host its world for other copies of itself on the same network, turned on and off from the page at runtime.

<details><summary>More</summary>

Each guest runs its own binary and opens one WebSocket to the host machine. Nothing else crosses the network: the page, assets and server actions stay behind the host's token. Hosting takes a passphrase of at least 12 characters off loopback. [Hippo Tycoon](apps/hippo-tycoon/README.md) plays solo, couch, LAN party and online rooms from one game class. See [Multiplayer on a LAN](REFERENCE.md#multiplayer-on-a-lan).

</details>

### A fast loop, and it tells you how fast

A desktop build takes about a second, and every build and deploy prints how long each step took and what changed since last time.

<details><summary>More</summary>

`build desktop --check` typechecks before the client build, so a type error costs well under a second. The checker is picked for you: `bun check` (Bun 1.4.3, canary only so far), else tsc-rs, else `tsc`. Step timings are saved to `.rustybuns/profile/`, so you can see what a checker or Bun upgrade actually saved. See [Type checking and per-step timing](REFERENCE.md#type-checking-and-per-step-timing).

</details>

### Background work that steps aside (experimental)

Work on a host can be realtime, high, normal or low priority, and low work backs off while your machine is busy.

<details><summary>More</summary>

`scheduler()` in `@rustybuns/shell-bun/priority` runs normal and low jobs under a budget you set, like the default "60% of the CPU, 50% of the memory", or a persona: `power-user`, `background-beatdown` or `background-burner`. Realtime and high work never waits, and a core is kept free for it. When the machine stays over budget for about 30 seconds, the number of low jobs allowed at once is halved, down to none, and climbs back one at a time once the machine is quiet. Child processes of low jobs run at OS background priority (`taskpolicy -b` on macOS, `nice` on Linux).

- **Who uses it.** The GitHub trial harness runs its installs, builds and hosts as low work, so a laptop stays usable during a sweep (`--persona`, `--priority`). A host's crons and queue consumers share one scheduler and run as low work too; `RB_PERSONA` at launch (or a box's `persona`) picks its budget, and `worker.cronPriority` or a consumer's `priority` raises them. A cron run or queue batch that hangs is stopped after 15 minutes.
- **Memory.** A job can say how much memory it usually needs, and only starts if that fits. `scheduler.spawn()` runs a command as a job and measures what it really uses, children included. A job past its own `maxMb` is stopped (on Linux `maxMb` is also a hard cgroup cap). When background work goes over the budget, the newest job is stopped and queued again, or paused (SIGSTOP) and resumed if it set `pause: true`.
- **Worker threads.** `scheduler.worker(priority, url, data)` runs CPU-heavy JS on a worker thread in the same slots. With `warm: n` it keeps up to n finished workers loaded for the next job on the same module, which skips startup and keeps JIT-compiled code (auto-rig rigs about twice as fast this way). A host keeps none unless `targets.desktop.warm` (or `RB_WARM`) says so, and idle ones count against the memory budget. On the desktop host, list the module in `targets.desktop.workers` and name it with `new URL("./worker.ts", import.meta.url)`: the build bundles it next to the host, in the binary too.
- **Checkpoints.** A long job can call `job.checkpoint()` between steps: there a stopped job stops for real, and a low job hands its slot to waiting normal work and picks up again once there is room. `job.checkpoint(release)` lets a job drop memory before it steps aside. `scheduler.runEffect()` runs an Effect as the job, so a stop interrupts it wherever it is and its cleanup runs. Time spent parked or paused doesn't count toward `timeoutMs`.

</details>

### Dockerfiles you can build and run locally (coming soon)

Containers are still being finished. `rustybuns containers` lists your container bindings and builds, runs and smoke-tests their images for `linux/amd64`.

<details><summary>More</summary>

Each image shows as built, stale or not built, with its size. `run` starts one on a free port, waits until it answers and streams its logs. Only the `--env` values you pass reach it. `--prod-like` puts a run behind the app's own egress gate, on a network with no other way out. `smoke` exits non-zero if an image never boots, CI smoke-tests the images a PR touches, and `deploy` checks that Docker is running before any Alchemy work. See [Containers](REFERENCE.md#containers).

</details>

### Built for coding agents

One language, one config file, the whole stack running locally, and a UI an agent can drive in Chrome.

<details><summary>More</summary>

The same things that make it simple for a person make it safe to hand to an agent:

- **One language.** TypeScript in the page, the backend, the config and the deploy. No IPC bridge, no Rust command layer, no YAML.
- **One file to reason about.** Change one line of `rustybuns.config.ts` and the rest is generated.
- **Runs locally.** sqlite stands in for every cloud binding, so an agent can boot, test and break the real app with no cloud account.
- **It can see the app.** It renders in Chrome, which agents already drive: click, screenshot, read the console.
- **Guard rails.** `plan` and `deploy` catch a mistake before a server exists. `protect: true` on a database, bucket, queue or vector index makes `destroy` leave it, and `plan`, `deploy` and `destroy` print a `[KEPT]` / `[REMOVED]` list first. See [Keep a resource through destroy](REFERENCE.md#config).
- **A host that can't reach your keys.** The dev host starts without your `.env`, auto-install or credential env vars, and `run desktop --sandbox` puts it in a macOS Seatbelt jail, kept out of `~/.ssh`, cloud logins and keychains. `plan`, `deploy` and `dev` keep the Cloudflare token and other deploy logins out of the Worker build too. See [Running code you didn't write](REFERENCE.md#running-code-you-didnt-write).
- **Rust without risk.** An agent can write the Rust engine and prove it matches the TypeScript one, sample by sample.

Nearly every commit in this repo is co-authored by Claude Code, some of them written at desks in [Agent Office](apps/agent-office/README.md), which is itself one of the examples below.

</details>

### Accessible by default

The docs site works with a screen reader and a keyboard alone, and has reading settings with dyslexia-friendly fonts (Atkinson Hyperlegible, OpenDyslexic), larger text and wider spacing.

<details><summary>More</summary>

We aim for WCAG 2.2 AA. The reading settings and theme are also WebMCP tools, so an agent can change them for you. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what's covered and how to report a barrier.

</details>

## What's the catch?

- **No native menus, tray, installers or auto-update yet.** If you need a native-feeling window today, use Electron or Tauri. Mac signing and notarization are built in (`build desktop --sign`, `--notarize`) and need only an Apple Developer ID; Windows signing isn't built yet.
- **The desktop app is a Chrome tab, not a window of its own.** Closing the tab doesn't stop the host, there's no dock or taskbar entry of its own, and the user needs Chrome installed. No deep links (`myapp://`), file associations, global shortcuts or native file dialogs either. System access isn't the gap: the Bun host already has the filesystem, processes, sqlite and FFI. What's missing is the window and the OS hooks around it. A thin native window around the same host (Tauri, say) would add them without moving the backend.
- **Updating means downloading a new binary by hand.** The planned shape: the host fetches a new hashed binary, checks the hash, swaps itself and restarts, with a manifest served from a Worker or R2. On a Mac the swapped binary must still be signed and notarized or Gatekeeper may quarantine it, which hasn't been tried.
- **You build on macOS or Linux, not Windows.** Windows is a target, not a build machine: build it from a Mac or a Linux server. A Rust cdylib cross-compiles only to Linux (in Docker); wasm crates go anywhere.
- **Windows is the least tested.** CI boots one app with no backend on Windows on Arm; nothing with a backend runs on Windows in CI yet. If you build in WSL or run a binary on Windows (x64 or Arm), [tell us](https://github.com/QuinnsCode/RustyBuns/issues/new) what worked and what didn't.
- **The binary is about 60 to 110 MB**, depending on the app, because Bun is inside it. It's one file with no install step, but it isn't small.
- **It renders in the user's Chrome** (or default browser), not a bundled one.
- **The twins aren't workerd.** They're the production runtime for the laptop and the box, not a copy of the Workers runtime. Limits match; a few bindings (Vectorize, Workers AI, the Worker Loader) are stand-ins. `rustybuns dev` still runs workerd for edge work. The full list is in [Where the twins differ from the edge](ADOPTION.md#where-the-twins-differ-from-the-edge).
- **Alpha, one maintainer.** The examples are the test bed, not a portfolio. More in [Questions people ask](ADOPTION.md#questions-people-ask).

If what you have is a web app with a backend, and you want it on a laptop, on the edge *and* on a server, nothing else does all three from one codebase.

## See it work

Every example is one codebase that runs as a desktop binary. The multiplayer ones run on Cloudflare from the same code.

> **Caution: the example apps are provided as is.** I build and change them nearly every day, so they move fast and haven't been through a formal security review. Some run coding agents, spawn shells or spend API credits on your behalf. Run them on a machine and network you trust, keep your API keys to yourself, and read the code before you point one at anything that matters. No warranty, see [LICENSING.md](LICENSING.md).

| Example | What it proves |
|---|---|
| [hippo-tycoon](apps/hippo-tycoon/README.md) | One game class runs as a Durable Object on Cloudflare and in-process in the binary: solo, couch, LAN party and online rooms |
| [park-hide-seek](apps/park-hide-seek/README.md) | 3D hide and seek on real Yosemite terrain, played by the page, by a LAN host or by the edge; each player is sent only what they can see. [Play it](https://park-hide-seek.notryanquinn.workers.dev) |
| [git-recon](apps/git-recon/README.md) | A repo as a shooter level: its folders become compounds and its files buildings on real ground (Yosemite, or any lat/long) or a plastic-army kitchen and garden, fought with git commands as weapons, in the page on your own or 32 to a battle over the LAN |
| [codeSplitter](apps/codesplitter/README.md) | A code host for the agentic era: every file a Durable Object, agents editing line by line, real git on Cloudflare Artifacts, an MCP server, on the edge and as a desktop app from one codebase. [Try it](https://codesplitter.notryanquinn.workers.dev) |
| [agent-office](apps/agent-office/README.md) | Someone else's Node server (PTYs, WebSockets, a 3D client) as one binary, nothing forked |
| [tscircuit-desktop](apps/tscircuit-desktop/README.md) | A heavy, real-world Vite app as one file, with a Rust engine up to 22x faster and a TypeScript fallback |
| [fm-daw](apps/fm-daw/README.md) | One Rust crate as wasm in the audio thread and over FFI on the host, bit-identical to the TypeScript engine |
| [auto-rig](apps/auto-rig/README.md) | Auto-rigging a 3D model in Rust and TypeScript with identical output |
| [motion-midi](apps/motion-midi/README.md) | One synth in Rust and in TypeScript, checked sample by sample |
| [splat-desktop](apps/splat-desktop/README.md) | PlayCanvas' SuperSplat editor as a desktop app working on a folder on your disk |
| [meshy-studio](apps/meshy-studio/README.md) | A folder-based batch tool for Meshy's API (image, multi-image and text to 3D, texture, remesh, rig, animate, concept art): your key stays local, every spend is priced first |
| [splat-rooms](apps/splat-rooms/README.md) | A splat hunting game with a world class and 30 MB scenes streamed from a folder on your disk, never embedded |
| [splat-spray](apps/splat-spray/README.md) | The smallest one: a three.js game with no backend at all, made a desktop app by a ten-line config |
| [example](apps/example/README.md) | A whole Worker (D1, KV, a Durable Object) as a desktop binary in half a second, plus a Rust FFI probe with a TypeScript fallback |
| [spa-example](apps/spa-example/README.md) | Not an app: a slice of a real RWSDK game that the tests use to check `init` reads it right |
| [agent-demo](apps/agent-demo/README.md) | A small snack-vote Worker seeded into codeSplitter, so several coding agents can build it at once and settle a merge conflict on camera |
| [borg](apps/borg/README.md) | Not an app: a small Worker that uses every binding once, so one suite can check the local twins against a real deploy |
| [what-would-fantano-say](apps/what-would-fantano-say/README.md) | A parody music critic as an RWSDK Worker: the phone decodes the song and picks a 15 s clip, and Cloudflare's Clef-omni judges it for about $5 per 100,000 reviews, behind a rate limit, Turnstile, an edge cache and a daily budget |
| [excalibrawl](apps/excalibrawl/README.md) | An hourly drawing fight: Clef vs Clef Flash picking only a move, shape, colour, grid cell and size from a picture of their halves, or two text models writing a token-cheap drawing language, with Clef as referee, for two cents or less a fight; replays and a live socket in R2 and a Durable Object |
| [two-fronts](apps/two-fronts/README.md) | Thunder Marines vs the Wooka horde: a turn-based galactic war plus three.js hero battles in orbit and on six worlds, one per kind of sector (redwood forest, desert, ruined city, glowing alien night, beach, deep-space station), built apart and joined by small JSON types (a spec in, a result out); play the AI or hotseat in the page, or a friend online through a Durable Object per campaign |
| [borg-postgres](apps/borg-postgres/README.md) | A Postgres app keeps its database and moves its code: Hyperdrive on the edge, PGlite on the desktop. |
| [hello-world](apps/hello-world/README.md) | The first five minutes: a twenty-line page that the welcome tour digs up, lets three agents rewrite at once, then asks why not deploy it |
| [skate-tech-park](apps/skate-tech-park/README.md) | Skate a street spot, or take a rocket roadster with ten cold-gas thrusters over the gap: a three.js page on a pure fixed-step sim the tests drive headless |
| [qcrm](apps/qcrm/README.md) | A CRM with MCP built in, a Rust wasm engine in the browser, office sync, signed webhooks and a desktop build; roles for a real place and hashed org ids. QNTBR-licensed. |
| [artstewengine](apps/artstewengine/README.md) | A tiny RWSDK app on D1 with a Better Auth admin page: add who has paid, and qCRM's sealed engine gets its key only for a paid license |
| [geoboxq](apps/geoboxq/README.md) | Shipping box fit checker with a Rust engine that packs boxes inside boxes. Private license. |
| [geoboxq-shopify](apps/geoboxq-shopify/README.md) | A small wrapper that turns a Shopify cart into the store's own box. |
| [playground](apps/playground/README.md) | One page that lists every app with a way to try it: Play, Download or Source. Static assets only, so it bills nothing |
| [tanstack-start-example](apps/tanstack-start-example/README.md) | TanStack Start on Cloudflare's Vite plugin (server functions, a server route, D1 and KV) as a desktop app, its code unchanged |
| [elysia-conduit](apps/elysia-conduit/RUSTYBUNS.md) | bedstack's RealWorld backend (Elysia, Drizzle, postgres.js) with no source edits: a desktop binary on PGlite that passes their Postman suite, and the five ways it breaks on Workers |
| [delayed-reaction](apps/delayed-reaction/README.md) | A phone-first rhythm game: you sprint down a rolling neon tunnel, a ring calls a note, you answer it a bar later on one of four thumb pads, and your answers echo back through a dub delay; the sim plays in beats with no page, so a test runs every level |
| [brianfloresblitzing](apps/brianfloresblitzing/README.md) | One static page ("One Team in 32") served from a Cloudflare Worker as plain assets, no Worker code |

**Someone else's app, unchanged:** [TerraViz](https://github.com/zyra-project/terraviz) by The Zyra Project, led by Eric Hackathorn (NOAA Global Systems Laboratory), Apache-2.0: a Pages app with a 3D globe, about 100 API routes, D1, KV, R2 and Vectorize. `bun apps/terraviz-demo/run.ts` clones it and runs it on Rusty Buns with none of its code changed. This is only a demonstration of how Rusty Buns maps an existing app onto its primitives. It is not a fork, and TerraViz's code is not in this repo. Credit, license and how to run it: [apps/terraviz-demo](apps/terraviz-demo/README.md).

**Try one without building anything:** download the desktop binary for [Hippo Tycoon](https://github.com/QuinnsCode/RustyBuns/releases?q=hippo-tycoon-v&expanded=true), [Park Hide & Seek](https://github.com/QuinnsCode/RustyBuns/releases?q=park-hide-seek-v&expanded=true), [Splat Spray](https://github.com/QuinnsCode/RustyBuns/releases?q=splat-spray-v&expanded=true) or [FM Groovebox](https://github.com/QuinnsCode/RustyBuns/releases?q=fm-daw-v&expanded=true). Each is one file for Mac, Windows or Linux. They aren't signed yet, so the first launch takes one Terminal command on a Mac (the release page has it; [APPLE_SIGNING.md](APPLE_SIGNING.md) is the road to fixing that) and a click past SmartScreen on Windows ([WINDOWS_LINUX_SIGNING.md](WINDOWS_LINUX_SIGNING.md) is that road, and says Linux needs no key).

Want to run them from source? [EXAMPLES.md](EXAMPLES.md) is two lines per app, no experience needed.

## Get started

You need Bun 1.4+ and an app that builds with `vite build`. On Create React App or Vue CLI? `rustybuns init --port-vite` moves it to Vite first.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                          # prints what it found; writes one config
pnpm exec rustybuns add desktop
pnpm exec rustybuns build desktop --dev && pnpm exec rustybuns run desktop
```

Your app opens in Chrome, running on a local Bun host with sqlite behind every binding. To go to the cloud:

```sh
pnpm exec rustybuns add deploy     # pinned Alchemy + Effect
pnpm exec rustybuns plan           # creates nothing, shows what would be created
pnpm exec rustybuns deploy         # refuses without a matching plan, then asks
pnpm exec rustybuns destroy        # removes everything it created
```

## Read more

- [ABOUT.md](ABOUT.md): why it exists (it started with grass) and who makes it
- [GETTING_STARTED.md](GETTING_STARTED.md): the full walkthrough, step by step
- [AGENT_PROMPTS.md](AGENT_PROMPTS.md): prompts to paste into your coding agent to try it on your repo
- [REFERENCE.md](REFERENCE.md): every command, config key, the host, the Hetzner and Railway boxes, LAN multiplayer, who holds the keys to secrets
- [ADOPTION.md](ADOPTION.md): who it's for, and how to adopt it (and leave)
- [ACCESSIBILITY.md](ACCESSIBILITY.md): what's accessible today, the reading settings, and how to report a barrier
- [COSTS.md](COSTS.md): what each deploy can bill you for, and how to cap it
- [FRAMEWORKS.md](FRAMEWORKS.md): beyond Vite + React
- [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md): how many real GitHub apps per framework run unchanged
- [notes/ROADMAP.md](notes/ROADMAP.md): next up are TLS on the box, Fly, installers and signing

## License

Apache-2.0. See [LICENSING.md](LICENSING.md).
