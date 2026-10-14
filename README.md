# 🥐 Rusty Buns

**Write a web app once. Ship it as a desktop binary, a Cloudflare Worker and a Linux server.**

No rewrite. No second codebase. No new language.

> We want how your software happens to be fast, ephemeral and out of mind. Seamless.
> A stack made for agent power, and human-simple.
> Let us ride along in your dev dependencies, and we'll show you the cloud.
>
> Rust on the server, Rust on the client, Rust between the two: you decide how, when and where. Or write TypeScript top to bottom and live a Rust-free life. Whatever your full-stack heart desires.
>
> Rusty Buns: the framework where you don't actually need either. 😅 Naming things is hard.

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>: one file, double-click it
pnpm exec rustybuns deploy              # Cloudflare, plus a Hetzner or Railway box
```

That's the whole product. Rusty Buns is a dev dependency: it never edits `src/` and never ships in your bundle.

> **Alpha, `0.1.12`.** Desktop works on macOS and Linux. The Cloudflare deploy is verified end to end. The Railway and Hetzner boxes are verified live.

## Features

Each feature is one line. Click **More** for the long version.

### One config, three targets

Your app runs as a desktop binary, a Cloudflare Worker and a Linux server, all from `rustybuns.config.ts`.

<details><summary>More</summary>

Every app is five things: **http, comms, storage, memory, identity**. Cloudflare already gave them good, small shapes: a `fetch` handler, Durable Objects, D1, KV, R2. Rusty Buns gives every one of those a local twin (sqlite and the filesystem) and runs your `fetch` handler under Bun. Once your app runs on a laptop that way, it runs on any Linux box too, and the cloud deploy is generated from the same binding list. Three targets, one config, nothing to drift.

```
                  rustybuns.config.ts
       ┌───────────────────┼────────────────────┐
    desktop              edge                  box
  Bun + sqlite      Worker + D1/KV/R2/DO    Bun + sqlite on a volume
  one binary        your vite build         Railway or Hetzner
```

`rustybuns.config.ts` is the only file you own. `init` reads your app and writes it; the host, the wrangler config and the infrastructure are all generated from it. More in [The five primitives](ADOPTION.md#the-five-primitives) and [How it works](REFERENCE.md#how-it-works).

</details>

### Bun and Vite are the stack, the rest swaps out

Bun runs your app and Vite builds it. Everything else (Alchemy, Effect, Rust, Hetzner, Railway) is an option you add when you want it and drop when you don't.

<details><summary>More</summary>

We give you all the options and none of the requirements. Bun is the host on the desktop and on a box, and Vite builds the client. That's the whole floor. Deploy tooling is opt-in: a project that only builds the desktop binary never runs `add deploy`, so it never gets Alchemy or Effect. Rust is an optional engine with a TypeScript twin. Each deploy target is one Layer you can swap for another or leave out. Nothing here is a thing your `src/` imports, so any of it can go without touching your app. Leaving is a `git rm`; see [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

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

You write against the left-hand shape once. What each primitive would be on AWS, Vercel or Fly is in [The five primitives](ADOPTION.md#the-five-primitives), and every binding per target (git, images, email, secrets) is in [Where things run](REFERENCE.md#where-things-run). What each framework's features map to, with support and known issues per framework, is in [Each framework, as the five primitives](FRAMEWORKS.md#each-framework-as-the-five-primitives).

</details>

### A one-file desktop app in real Chrome

`build desktop` gives you one double-clickable file per OS. Your backend runs on a local Bun host and the UI opens in the user's Chrome.

<details><summary>More</summary>

**Why not Electron?** Electron makes you write two programs (a Node main process and a renderer) that talk over IPC, and it ships a whole Chromium with every app. Your backend is Node glued to a window, so it can't go to the edge, and moving it to a server is a rewrite. Rusty Buns has no main process. Your backend is a plain `fetch` handler, the same one Cloudflare runs. On a laptop it serves your page to the Chrome you already have. On a server it serves it to everyone.

**Why not Tauri?** Tauri is lighter, but your backend becomes Rust commands, and your UI runs in whatever webview the OS has: WebKit on macOS and Linux, WebView2 on Windows, each with its own gaps (WebGPU, codecs, audio). So you now test three browsers and maintain a Rust backend that also can't go to the edge. Rusty Buns keeps the backend in TypeScript and renders in real Chrome, so `SharedArrayBuffer`, WebGPU, AudioWorklets and Web MIDI just work.

The host binds to `127.0.0.1`, gates every request on a per-launch token, and keeps your data in `~/.<app-name>/`. Your users never install Bun: it's inside the binary. Details in [The host](REFERENCE.md#the-host).

**Bring your own server.** A Vite frontend whose dev server proxies `/api` to a Node server of its own (an `api/` folder running `node server.js`) keeps that server. `targets.desktop.server` bundles it into the binary, and the host runs it beside itself, with its data in the app's data dir, and sends it the paths Vite did, WebSockets included. A proxy that sends `/api` to one server and `/img` to another runs both. A native addon ships with it, whether required by a fixed path or found through `bindings`, `node-gyp-build` or a loader of its own (`sharp`, `better-sqlite3`), with a build for each target: what the package ships, or else what `prebuild-install` or npm would fetch for that OS. One it can't carry stops the build with its name, not the app at launch. `init` sets it up when it finds the servers. It runs on the desktop and a box, not on Workers.

**Opens on a Mac without a warning.** A binary you download is blocked by macOS until it's signed and notarized. On a Mac with a Developer ID certificate, `build desktop --sign` signs the darwin binaries, and `--notarize <profile>` also sends a `.zip` of each to Apple. The profile is the one you saved with `xcrun notarytool store-credentials`, so your Apple password stays in the keychain.

</details>

### Static sites box too, no app needed

`rustybuns init` in a plain HTML, Jekyll, Hugo or MkDocs repo (a GitHub Pages site, say) boxes its build output for the desktop and the web.

<details><summary>More</summary>

There's no `package.json` to read, so `init` looks for the site itself: an `index.html` at the top or in `docs/`, `public/`, `site/` or `www/`, a Jekyll `_config.yml` with its `_layouts/`, a `hugo.toml`, or a `mkdocs.yml`. It writes a config whose build is the generator's own (`rustybuns jekyll build`, `hugo`, `mkdocs build`), or `rustybuns copy-site` for hand-written HTML. It also writes a `package.json` that holds Rusty Buns as a dev dependency. The web side is an assets-only Worker, and both it and the desktop app answer a missing page with the nearest `404.html`.

Jekyll copies every file it doesn't exclude into the site, so `init` layers `_config.rustybuns.yml` over your config. It keeps `dist/`, `desktop/` and Rusty Buns' files out, and serves from `/` rather than a Pages `baseurl`. With no `Gemfile`, GitHub Pages builds the site with plugins plain Jekyll lacks, one of which gives a page with no `layout` your `page` or `default` layout. The layer sets the same defaults, so those pages don't render bare. The others (Markdown with no front matter rendered as a page, links to `.md` files pointed at the `.html`, titles from a page's first heading, a `README.md` as its folder's index) need their gems, so `init` turns on the ones your pages look like they lean on, after your own `plugins`, and the build installs their gems. Your local Jekyll runs only when those gems are installed for it; otherwise the build runs in Docker. The Jekyll build is `rustybuns jekyll build`. It runs your own Jekyll (through `bundle exec` if there's a Gemfile) when your Ruby is 3 or later. Otherwise it runs the build in a `ruby:3.3` Docker container. macOS ships Ruby 2.6, which current Jekyll won't install on. The container's gems live in a Docker volume, so only the first build waits for the install. Hugo and MkDocs still have to be installed, and `init` says so when one isn't on your PATH. Like Cloudflare and GitHub Pages, the host serves `/ops` from `ops.html`.

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
| `bun:ffi` | Rust cdylibs called directly, nanosecond calls, with a TypeScript fallback |
| `Bun.spawn` with a terminal | real PTYs without node-gyp (see [agent-office](apps/agent-office/README.md)) |

The twins refuse what the edge refuses, with the edge's error: more than 100 bound parameters in a D1 query, a KV key over 512 bytes, a queue message over 128 KB, a Durable Object value over 2 MiB. So a query that works locally doesn't fail on the first deploy. The desktop and box hosts also measure each request: one that grows the process by more than 128 MB, or uses more CPU than `worker.cpuMs` (`RB_CPU_MS=10` tries the Free plan's), gets the edge's 503.

A Postgres app (Supabase, Neon, RDS) keeps its database: a `hyperdrive` binding puts Cloudflare Hyperdrive in front of it on the edge, and the desktop and box connect to the same `DATABASE_URL` directly. `init` adds one when the app uses `pg`, `postgres`, or Drizzle or Prisma on postgresql. With `local: "pglite"` an offline desktop gets Postgres too: PGlite runs in the data dir, served on 127.0.0.1, with your Drizzle or Prisma migrations applied at boot. Or the stack owns the database: `origin: { neon: { branch: "prod" } }` makes a Neon project and branch at deploy and fronts that, and a box in the same stack gets the branch's URL.

An app already on wrangler keeps what its config declares: `init` carries over its bindings (Workflows, Vectorize, Analytics Engine, Worker Loaders and Containers among them), queue consumers with their dead-letter queues, routes and custom domains, and observability. On the desktop, Workflows run in-process with their steps, sleeps and events kept in sqlite, so a run cut off by a restart picks up where it was. A Vectorize index is a sqlite table queried by exact scan, Analytics Engine points land in `analytics.sqlite`, and the Worker Loader runs its code in the host's own process (not a sandbox). Workers AI has no model there: `env.AI` is bound, and each call says it runs only on Cloudflare. Email sending, rate limits and Containers are left out of the desktop, and the app runs without them; a dead-letter queue works there too. An outbound `fetch` with `cf: { cacheTtl }` or `cacheEverything` is answered from an in-process cache for that TTL, as the edge cache would, so a widget that fetches an API on every render makes one call. Each `env.<name>` block becomes a stage, deployed with `--stage <name>`, along with `account_id`, `workers_dev` and `preview_urls`; `init` names whatever it leaves behind.

D1 migrations apply at boot, and `"use server"` functions run for real against sqlite. It adds up to [a full-stack framework, by accident](REFERENCE.md#a-full-stack-framework-by-accident).

</details>

### Smoke test an app without touching it

`rustybuns smoke [dir]` copies your Vite or Bun app to a throwaway folder, installs, inits, builds and boots it on the local twins, and says whether `GET /` answered. A Bun app that is only a `Bun.serve` server has no client to build, so it runs as its own server beside the host.

<details><summary>More</summary>

The copy has no `.env` or `.dev.vars`, gets a fake for every secret the app names, runs with an empty HOME and no Cloudflare or other deploy logins, and the host runs in Seatbelt on macOS. It tries the mode `init` picks, then the app's own Worker build if it has one, prints where it stopped when it fails (`install`, `init`, `build`, `boot` or `request`), and deletes everything afterwards unless you pass `--keep`. Nothing is deployed and no account is read, so it costs nothing. The same steps run over public GitHub repos in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md).

</details>

### Plan before anything costs money

`plan` typechecks the generated stack and shows what it would create and bill. `deploy` refuses to run without a plan for that exact config, then asks.

<details><summary>More</summary>

The deploy side is a typed Alchemy + Effect stack: Cloudflare, Hetzner and Railway are each a typed Layer, so swapping a target is one line of config and the compiler tells you what's missing before anything is created. `plan` and `deploy` print every billable resource, marked fixed or usage, and a large Hetzner box is refused unless the config says so. `destroy` removes everything it created. Trying someone else's repo? `plan --offline` builds and type checks with no login at all and lists the whole stack as creates, as on an empty account, so neither their account nor yours is touched. How much it would bill comes from the fan-out, so the desktop and box hosts count every binding call per request, cron tick and queue message, and `plan --usage` turns a run of that into a monthly estimate, flagging a cron that keeps a Durable Object awake around the clock ([COSTS.md](COSTS.md#what-it-would-cost-a-month-plan---usage)). See [Typed deploys](REFERENCE.md#typed-deploys-thanks-to-effect), [Deploy to Hetzner](REFERENCE.md#deploy-to-hetzner), [Deploy to Railway](REFERENCE.md#deploy-to-railway) and [COSTS.md](COSTS.md).

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

`scheduler()` in `@rustybuns/shell-bun/priority` runs normal and low jobs under a budget you set, like the default "60% of the CPU, 50% of the memory", or a persona: `power-user`, `background-beatdown` or `background-burner`. Realtime and high work never waits, and a core is kept free for it. When the machine stays over budget for about 30 seconds (a short spike doesn't count), the number of low jobs allowed at once is halved, down to none. Once the machine is quiet again it climbs back one at a time. A job can say how much memory it usually needs, and it only starts if that fits. Child processes of low jobs run at OS background priority (`taskpolicy -b` on macOS, `nice` on Linux). The GitHub trial harness is the first user: its installs, builds and hosts run as low work, so a laptop stays usable during a sweep (`--persona`, `--priority`). A host's crons and queue consumers share one scheduler and run as low work too; `RB_PERSONA` at launch (or a box's `persona`) picks its budget, and `worker.cronPriority` or a consumer's `priority` in the config raises them. A cron run or queue batch that hangs is stopped after 15 minutes, so it gives its slot back. `scheduler.spawn()` runs a command as a job and measures how much memory it really uses, along with its child processes. A job that goes past its own `maxMb` is stopped. When background work goes over the memory budget, the newest job is stopped and queued again. On Linux `maxMb` is also a hard cgroup cap. `scheduler.worker(priority, url, data)` runs CPU-heavy JS on a worker thread in the same slots, and a stop terminates the thread. With `warm: n` the scheduler keeps up to n finished workers loaded for the next job on the same module. A host's scheduler keeps none unless `targets.desktop.warm` (or `RB_WARM` at launch) says so; a warm worker skips the thread's startup and keeps its JIT-compiled code, so auto-rig, which keeps one, rigs about twice as fast. Each idle one counts against the memory budget, and the pool shrinks when the scheduler backs off. On the desktop host, list the module in `targets.desktop.workers` and name it with `new URL("./worker.ts", import.meta.url)`: the build bundles it next to the host, in the binary too (auto-rig's TypeScript rigger runs this way). A long job can call `job.checkpoint()` between steps: there a stopped job stops for real, and a low job hands its slot to waiting normal work (or steps aside when the machine gets busy) and picks up again once there is room. `scheduler.runEffect()` runs an Effect as the job, so a stop interrupts it wherever it is, even inside the release of a `job.checkpointWith(release)`, and its cleanup runs. `job.checkpoint(release)` lets a job drop memory before it steps aside, and such a job also steps aside while background work is over the memory budget. It comes back once what it let go fits again. A job with `pause: true` is paused (SIGSTOP) rather than stopped when it pushes background work over the memory budget, and goes on (SIGCONT) once there is room. Time spent parked or paused doesn't count toward `timeoutMs`.

</details>

### Built for coding agents

One language top to bottom, one config file, the whole stack running locally, and a UI agents can already drive in Chrome.

<details><summary>More</summary>

- **One language.** TypeScript in the page, the backend, the config and the deploy. No IPC bridge, no Rust command layer, no YAML.
- **One file to reason about.** An agent changes one line of `rustybuns.config.ts` and the rest is generated.
- **Runs locally.** sqlite stands in for every cloud binding, so an agent can boot, test and break the real app with no cloud account.
- **It can see the app.** It renders in Chrome, which agents already drive: click, screenshot, read the console.
- **Guard rails.** `plan` and `deploy` catch an agent's mistake before a server exists.
- **Keep what holds data.** `protect: true` on a database, bucket, queue or vector index makes `destroy` leave it, and `plan`, `deploy` and `destroy` print a `[KEPT]` / `[REMOVED]` list first. See [Keep a resource through destroy](REFERENCE.md#config).
- **A host that can't reach your keys.** The dev host starts without your `.env`, auto-install or credential env vars, and `run desktop --sandbox` puts it in a macOS Seatbelt jail, kept out of `~/.ssh`, cloud logins and keychains. `plan`, `deploy` and `dev` keep the Cloudflare token and other deploy logins out of the Worker build too, and with `--sandbox` give it an empty `HOME`. See [Running code you didn't write](REFERENCE.md#running-code-you-didnt-write).
- **Rust without risk.** An agent can write the Rust engine and prove it matches the TypeScript one, sample by sample.

Nearly every commit in this repo is co-authored by Claude Code, some of them written at desks in [Agent Office](apps/agent-office/README.md), which is itself one of the examples below.

</details>

### Keys you can take back (experimental)

Test stacks mint their own secrets on create and drop them on destroy. Prod secrets come from 1Password behind your Touch ID.

<details><summary>More</summary>

Set `experimental.wheel` to `"agent"` and CI and agents can spin stacks up as often as they like with nothing to rotate. Set it to `"human"` and prod secrets resolve from 1Password at deploy time. Either way a committed `.env.schema` lists every secret by name, never value, so any machine or agent knows what's needed. The 1Password path is untested so far; see [Who holds the keys](REFERENCE.md#who-holds-the-keys-experimental) for why it's safe and what it doesn't cover.

</details>

### Leaving is a `git rm`

Rusty Buns is a dev dependency. It never edits `src/`, never ships in your bundle, and everything you adopt is a shape Cloudflare already standardized.

<details><summary>More</summary>

There's no framework API to unwind: your app stays a `fetch` handler with D1, KV, R2 and Durable Object bindings. Adopt it one target at a time, and drop it the same way. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Postgres instead of D1

Swap D1 for your own Postgres: PGlite on the desktop, Hyperdrive in front of Neon, Supabase or RDS on the edge.

<details><summary>More</summary>

It's a code change, the way adding a shadcn component is. D1's `env.DB.prepare(...)` is sqlite-shaped, so your code uses a Postgres client (`pg`, `postgres`, Drizzle or Prisma) over `env.HYPERDRIVE.connectionString`, and `init` adds the `hyperdrive` binding when it sees one. The desktop and box connect to `DATABASE_URL`, or serve PGlite from the data dir with `local: "pglite"`. KV, Durable Object storage, queues and workflows still use sqlite locally; only the relational database moves. [borg-postgres](apps/borg-postgres/README.md) runs the same Worker on both and checks inserts, `jsonb`, rollback and concurrent upserts. Caveats (PGlite is one shared session) are in [Where things run](REFERENCE.md#where-things-run).

</details>

### Defaults you can take over

Like shadcn, the defaults are a starting point: swap a piece, or `eject` the deploy program and own it.

<details><summary>More</summary>

Rusty Buns starts as a dev dependency that generates the host, the wrangler config and the Alchemy stack from `rustybuns.config.ts`. When a default stops fitting, change that piece and keep the rest: Postgres for D1, your own server beside the host, Rust or TypeScript for the hot path. `rustybuns eject` copies the Alchemy program to your repo, and from then on you own it. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Accessible by default

The docs site works with a screen reader and a keyboard alone, and has reading settings with dyslexia-friendly fonts (Atkinson Hyperlegible, OpenDyslexic), larger text and wider spacing.

<details><summary>More</summary>

We aim for WCAG 2.2 AA. The reading settings and theme are also WebMCP tools, so an agent can change them for you. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what's covered and how to report a barrier.

</details>

## What's the catch?

- **No native menus, tray, installers, signing or auto-update yet.** If you need a native-feeling window today, use Electron or Tauri.
- **The binary is about 60 to 110 MB**, depending on the app, because Bun is inside it. It's one file with no install step, but it isn't small.
- **It renders in the user's Chrome** (or default browser), not a bundled one.

If what you have is a web app with a backend, and you want it on a laptop, on the edge *and* on a server, nothing else does all three from one codebase.

## See it work

Every example is one codebase that runs as a desktop binary. The multiplayer ones run on Cloudflare from the same code.

> **⚠️ Caution: the example apps are provided as is.** I build and change them nearly every day, so they move fast and haven't been through a formal security review. Some run coding agents, spawn shells or spend API credits on your behalf. Run them on a machine and network you trust, keep your API keys to yourself, and read the code before you point one at anything that matters. No warranty, see [LICENSING.md](LICENSING.md).

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
| [two-fronts](apps/two-fronts/README.md) | Thunder Marines vs the Wooka horde: a turn-based galactic war plus three.js hero battles in a redwood forest or in orbit, built apart and joined by small JSON types (a spec in, a result out); play the AI or hotseat in the page, or a friend online through a Durable Object per campaign |
| [borg-postgres](apps/borg-postgres/README.md) | A Postgres app keeps its database and moves its code: Hyperdrive on the edge, PGlite on the desktop. |

**Try one without building anything:** download the desktop binary for [Hippo Tycoon](https://github.com/QuinnsCode/RustyBuns/releases?q=hippo-tycoon-v&expanded=true), [Park Hide & Seek](https://github.com/QuinnsCode/RustyBuns/releases?q=park-hide-seek-v&expanded=true), [Splat Spray](https://github.com/QuinnsCode/RustyBuns/releases?q=splat-spray-v&expanded=true) or [FM Groovebox](https://github.com/QuinnsCode/RustyBuns/releases?q=fm-daw-v&expanded=true). Each is one file for Mac, Windows or Linux. They aren't signed yet, so the first launch takes one Terminal command on a Mac (the release page has it; [APPLE_SIGNING.md](APPLE_SIGNING.md) is the road to fixing that) and a click past SmartScreen on Windows.

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
