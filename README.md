<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/readme-hero-night.svg">
  <img alt="Rusty Buns: my idea engine for agents and humans alike" src="docs/readme-hero-day.svg" width="100%">
</picture>

<p align="center">
  <a href="https://rustybuns-playground.notryanquinn.workers.dev"><b>Open the Playground</b></a> &nbsp;/&nbsp;
  <a href="GETTING_STARTED.md">Getting started</a> &nbsp;/&nbsp;
  <a href="EXAMPLES.md">Examples</a> &nbsp;/&nbsp;
  <a href="REFERENCE.md">Reference</a>
</p>

# 🥐 Rusty Buns - My Idea Engine for Agents and Humans alike

**Rusty Buns is three ideas in one dev dependency:**

1. **TypeScript wide, Rust deep.** TypeScript everywhere for the widest interop, Rust on the one hot path that needs deep power.
2. **Buy into the simple primitives, and we move you across the web and the desktop.** Five small shapes, and the same app runs on a laptop, on the edge and on a server.
3. **The agentic idea engine.** One language, one config and a stack that boots locally, so you and your agents go from an idea to a running app fast.

You own your code. Rusty Buns never edits `src/`, never ships inside your bundle, and leaving is a `git rm`.

Try it out with the setup commands!:

```sh
pnpm add -D @rustybuns/cli @rustybuns/shell-bun
pnpm exec rustybuns init                # reads your app, writes rustybuns.config.ts
pnpm exec rustybuns build desktop       # dist/<name>-<os>-<arch>: one file, double-click it
pnpm exec rustybuns deploy              # Cloudflare, plus a Hetzner or Railway box
```

> **Alpha, `0.1.12`.** Windows and Bun can have problems, but it is easy to run a linux server to run this for windows. Talk with me if you struggle on this!!! The Cloudflare deploy is verified end to end. The Railway and Hetzner boxes are verified live. A brand-new release not installing? Your package manager's minimum release age is holding it back possibly; [Getting started](GETTING_STARTED.md) has the one-minute fix.

**Try it live:** the [Playground](https://rustybuns-playground.notryanquinn.workers.dev) lists every example app with a way to play it, download it or read its source, all deployed by Rusty Buns.

<table>
<tr><td width="33%" align="center"><a href="https://git-recon.notryanquinn.workers.dev"><img src="apps/playground/public/shots/git-recon.jpg" width="100%" alt="Git Recon"><br><b>Git Recon</b></a></td><td width="33%" align="center"><a href="https://two-fronts.notryanquinn.workers.dev"><img src="apps/playground/public/shots/two-fronts.jpg" width="100%" alt="Two Fronts"><br><b>Two Fronts</b></a></td><td width="33%" align="center"><a href="https://park-hide-seek.notryanquinn.workers.dev"><img src="apps/playground/public/shots/park-hide-seek.jpg" width="100%" alt="Park Hide &amp; Seek"><br><b>Park Hide &amp; Seek</b></a></td></tr>
<tr><td width="33%" align="center"><a href="https://skatetechpark.notryanquinn.workers.dev"><img src="apps/playground/public/shots/skate-tech-park.jpg" width="100%" alt="Skate Tech Park"><br><b>Skate Tech Park</b></a></td><td width="33%" align="center"><a href="https://alien-disc-golf.notryanquinn.workers.dev"><img src="apps/playground/public/shots/alien-disc-golf.jpg" width="100%" alt="Alien Disc Golf"><br><b>Alien Disc Golf</b></a></td><td width="33%" align="center"><a href="https://supersplatspyshot.notryanquinn.workers.dev"><img src="apps/playground/public/shots/splat-spray.jpg" width="100%" alt="Super Spy Splat Shot"><br><b>Super Spy Splat Shot</b></a></td></tr>
</table>

<p align="center"><sub>Click a card to play. Nearly all of the games have a multiplayer mode.</sub></p>

## 1. TypeScript wide, Rust deep

**Wide interop.** TypeScript is the language of the page, the backend, the config and the deploy. Every framework, every npm package and every Cloudflare binding is already within reach, and nothing sits in between: no IPC bridge, no command layer, no YAML.

**Deep power when you need it.** When one path is too slow in TypeScript (audio, physics, geometry, a solver), write that part in Rust:

- **On the desktop and the box**, `@rustybuns/native` loads a Rust cdylib over `bun:ffi` and calls it directly.
- **In the page or on the edge**, the same crate ships as wasm.
- **Rust is never a cliff.** Each engine has a TypeScript twin that gives the same answer, and the app falls back to it when Rust can't load. You can race the two before you commit: [tscircuit-desktop](apps/tscircuit-desktop/README.md) (up to 22x), [fm-daw](apps/fm-daw/README.md) (bit-identical audio), [auto-rig](apps/auto-rig/README.md).

Start in TypeScript, and go deep only where it pays. More in [Rust when you need it, TypeScript always](#rust-when-you-need-it-typescript-always).

## 2. Buy into the simple primitives, and we move you

**Every web app with a backend is five things:**

| Primitive | What it is | The Cloudflare shape you write against |
|---|---|---|
| **http** | the way in, simple and not in a hurry | a `fetch` handler |
| **comms** | talking live, and faster | Durable Objects and WebSockets |
| **storage** | data you keep | D1, KV and R2 |
| **memory** | fast thinking, gone on restart | the isolate or the process |
| **identity** | who's who | your Worker, Access, or a token |

**Cloudflare already gave each one a small, standard shape.** You write against those shapes once.

**Rusty Buns gives each shape a local twin on Bun and sqlite**, so the same app runs in three places from one `rustybuns.config.ts`:

- **The desktop.** One file per OS that anyone can double-click. The backend runs on a local Bun host, the UI opens in Chrome. See [A one-file desktop app in real Chrome](#a-one-file-desktop-app-in-real-chrome).
- **The edge.** A Cloudflare Worker with D1, KV, R2 and Durable Objects, deployed from the same list of bindings. See [One config, three targets](#one-config-three-targets).
- **A server.** The same binary on a Railway or Hetzner box, sqlite on a volume.

**Mobile isn't a target, and mostly shouldn't be.** A phone app should feel like the phone, so we think mobile is best built native, in SwiftUI or Kotlin. There is a decent path that reuses what you already have, though: keep the backend on the edge as your Worker and its Rust-as-wasm engine, and make the native app a thin client of the same http and comms. The logic stays in one place and the screens stay native. The first step is [native/ios](native/ios/README.md): a SwiftUI shell that shows a deployed app full screen, and `bun run ios <url>` opens it in the simulator. For screens drawn natively (RealityKit, SceneKit) the games' models come along too: `bun run usdz` turns every `apps/*/public/models/*.glb` into USDZ in `dist/ios/` through headless Blender, baking vertex colours into textures because iOS's USD shader ignores them. `bun run usdz models` does the same for the procedural models in `packages/models` (roadster, plants). `bun run usdz beasts` (no Blender) turns each Mythic Masters beast's `*.rig.json` into a skinned USDZ (UsdSkel skeleton and skin weights, rest pose, tips and feet in the prim's customData). IK stays on the server's side of the line: the sim already knows where every foot goes, so a native client takes joint poses from it rather than porting the closed-chain solver ([#2895](https://github.com/QuinnsCode/RustyBuns/issues/2895)). What every native app shares (eqosys sign-in that stays signed in, the friends hub, the protocol version handshake) is one Swift package, [RustyBunsKit](packages/ios-kit/README.md); Park Hide & Seek's client is built on it.

Your code doesn't change between them, and nothing of ours ships inside it. That makes it a meta metaframework: a framework for frameworks, of sorts. It doesn't replace Vite, React, RWSDK, TanStack Start, Elysia, Wasp or Solid; it sits on top of them, and underneath it's a Bun program. The preferred stack it maps onto is **Vite, Bun, TypeScript, Rust, Alchemy and Effect**.

The five primitives are good architecture with or without Rusty Buns. What each one would be on AWS, Vercel or Fly is in [The five primitives](ADOPTION.md#the-five-primitives).

## 3. The agentic idea engine

Have an idea in the morning, play it by the afternoon. The things that make the stack simple for a person make it safe and fast for a coding agent:

- **Small enough to hold in your head.** One language and one config file; change a line and the rest is generated.
- **Boots with no cloud account.** sqlite stands in for every binding, so an agent can run, test and break the real app on a laptop, for free.
- **Agents can see and drive it.** It renders in Chrome, and pages hand agents their buttons over WebMCP instead of screenshots ([WEBMCP.md](WEBMCP.md)).
- **Nothing costs money until you say so.** `plan` prints every billable resource, `deploy` refuses without a matching plan, and `destroy` removes what it made.
- **Many agents at once.** [Agent Office](apps/agent-office/README.md) (made by WebDevCody: [project](https://github.com/AgentSystemLabs/agent-office), [GitHub](https://github.com/webdevcody), [YouTube](https://www.youtube.com/@webdevcody), [X](https://x.com/webdevcody)) gives each agent a desk and a worktree, and [codeSplitter](apps/codesplitter/README.md) lets them change the same repo side by side.

The proof is the examples: games, a DAW, a circuit editor, a CRM and the office itself, nearly every commit co-authored by Claude Code. More in [Built for coding agents](#built-for-coding-agents).

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

### How I map resources to services based on setup

Every app is http, comms, storage, memory and identity

<details><summary>See how they deploy!</summary>

| Primitive | Cloudflare | Railway or Hetzner box | Desktop |
|---|---|---|---|
| **http** | CF Worker's `fetch` | `Bun.serve()` | `Bun.serve()` or localhost offline |
| **comms** | Durable Object WebSockets | the same class, in-process | the same class, in-process |
| **storage** | D1, KV, R2 | sqlite and a folder on a volume | sqlite and a folder in `~/.<app-name>/` |
| **memory** | per-request isolate, no FFI | the whole process, Rust over FFI | the whole process, Rust over FFI |
| **identity** | your Worker or Cloudflare Access | a guest id | a per-launch token |

You write against the left-hand shape once. What each primitive would be on AWS, Vercel or Fly is in [The five primitives](ADOPTION.md#the-five-primitives). Every binding per target (git, images, email, secrets) is in [Where things run](REFERENCE.md#where-things-run), and what each framework's features map to is in [Each framework, as the five primitives](FRAMEWORKS.md#each-framework-as-the-five-primitives).

</details>

### Every Cloudflare binding has an easy local twin

D1, KV, R2 & Durable Objects run on sqlite and a folder on your disk. Whole stack boots with no cloud account & no bill.

<details><summary>More Info</summary>

Bun is the one runtime that has every piece built in:

| Bun gives us | So you get |
|---|---|
| `bun build --compile` | one self-contained file per OS, cross-compiled from one machine |
| `bun:sqlite` | D1, KV and Durable Object storage on a laptop, with no database to install |
| `Bun.serve` with WebSockets | Durable Objects with hibernating sockets, in-process |
| `bun:ffi` | Rust cdylibs called directly, with a TypeScript fallback |
| `Bun.spawn` with a terminal | real PTYs without node-gyp (see [agent-office](apps/agent-office/README.md)) |

**The twins refuse what the edge refuses**, with the edge's error: more than 100 bound parameters in a D1 query, a KV key over 512 bytes, a queue message over 128 KB, Durable Object value over 2 MiB. A query that works locally doesn't fail on the first deploy. Desktop and Box hosts also measure each request: one that grows the process by more than 128 MB, or uses more CPU than `worker.cpuMs` (`RB_CPU_MS=10` tries the Free plan's), gets the edge's 503.

**Postgres apps keep their database.** A `hyperdrive` binding puts Cloudflare Hyperdrive in front of it on the Edge. The Desktop and Box connect to the same `DATABASE_URL` directly. `init` adds one when the app uses `pg`, `postgres`, or Drizzle or Prisma on postgresql. With `local: "pglite"` an offline desktop gets Postgres too: PGlite runs in the data dir with your migrations applied at boot. Or the stack owns the database: `origin: { neon: { branch: "prod" } }` makes a Neon project and branch at deploy.

**An app already on wrangler keeps what its config declares.** `init` carries over its bindings (Workflows, Vectorize, Analytics Engine, Worker Loaders & Containers among them), queue consumers with their dead-letter queues, routes, custom domains and observability. Each `env.<name>` block becomes a stage, deployed with `--stage <name>`. On the desktop, Workflows run in-process with their steps, sleeps and events kept in sqlite, so a run cut off by a restart picks up where it was. A Vectorize index is a sqlite table queried by exact scan, Analytics Engine points land in `analytics.sqlite`, and the Worker Loader runs its code in the host's own process (not a sandbox). Workers AI has no model locally: `env.AI` answers `@cf/baai/bge-*` embeddings with a small built-in embedder (shared words and word stems land near each other, not meanings), and every other call says it runs only on Cloudflare. Email sending, rate limits and Containers are left out of the desktop, and the app runs without them. An outbound `fetch` with `cf: { cacheTtl }` or `cacheEverything` is answered from an in-process cache for that TTL, as the edge cache would.

D1 migrations apply at boot, and `"use server"` functions run for real against sqlite. It adds up to [a full-stack framework, by accident](REFERENCE.md#a-full-stack-framework-by-accident).

</details>

### A one-file desktop app in real Chrome

`build desktop` gives you one double-clickable file per OS. Your backend runs on a local Bun host and the UI opens in the user's Chrome.

<details><summary>More</summary>

**Why not Electron?** Electron makes you write two programs (a Node main process and a renderer) that talk over IPC. It ships a whole Chromium with every app. That backend can't go to the edge. Moving it to a server is a rewrite. Rusty Buns has no main process. Your backend is a plain web standards-forward `fetch` handler.

Same one Cloudflare runs. On a laptop it serves your page to the Chrome you already have. On a server it serves it to everyone.

**Why not Tauri?** Tauri is lighter, but your backend becomes Rust commands, and your UI runs in whatever webview the OS has (WebKit on macOS and Linux, WebView2 on Windows), each with its own gaps. Rusty Buns keeps the backend in TypeScript and renders in real Chrome, so `SharedArrayBuffer`, WebGPU, AudioWorklets and Web MIDI just work.
THO we do use Tauri to be a thin wrapper to get our systems items we want. We love them and aren't trying to be them. Makes it also easy on desktop to just be a Tauri app if you want all rust backend and the webview can abadnon the TS and Bun pieces! Like we say ultimate flexibility maximal interop. We just value the transportability of app core logic over implementation logic.

In Rusty Buns the host binds to `127.0.0.1`, gates every request on a per-launch token, and keeps your data in `~/.<app-name>/`. Your users never install Bun: it's inside the binary. Details in [The host](REFERENCE.md#the-host).

**Bring your own server.** A Vite frontend whose dev server proxies `/api` to a Node server of its own keeps that server. `targets.desktop.server` bundles it into the binary, and the host runs it beside itself, with its data in the app's data dir, WebSockets included. A proxy that sends `/api` to one server and `/img` to another runs both. Native addons (`sharp`, `better-sqlite3`) ship with it, with a build for each target; one it can't carry stops the build with its name, not the app at launch. `init` sets it up when it finds the servers. Desktop and box only, since a Worker can't run a Node server.

**Opens on a Mac without a warning.** On a Mac with a Developer ID certificate, `build desktop --sign` signs the darwin binaries, and `--notarize <profile>` also sends a `.zip` of each to Apple. The profile is the one you saved with `xcrun notarytool store-credentials`, so your Apple password stays in the keychain.

</details>

### Your bindings are typed from the config

Your handler's bindings type comes from the config (`EnvOf<typeof config>`), so deleting a binding from `rustybuns.config.ts` fails the typecheck everywhere that still used it.

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

### PLAN STEP: Plan before anything costs money; See the resource matrix

`plan` typechecks the generated stack and shows what it would create & bill. `deploy` refuses to run without a plan for that exact config, then asks.

<details><summary>More</summary>

The deploy side is a typed Alchemy + Effect stack. Cloudflare, Hetzner and Railway are each a typed Layer, so swapping a target is one line of config and the compiler tells you what's missing before anything is created. `plan` and `deploy` print every billable resource, marked fixed or usage, and a large Hetzner box is refused unless the config says so. `destroy` removes everything it created.

`plan` only diffs your config against Alchemy's state. `drift` goes the other way: it re-reads the live account and shows what changed outside the stack (a dashboard edit, a `wrangler deploy`, a deleted resource). It changes nothing; `drift --repair` puts the account back to the last deploy, after the same two-step yes as a real destroy, and is refused with no terminal.

Trying someone else's repo? `plan --offline` builds and typechecks with no login at all and lists the whole stack as creates, so neither their account nor yours is touched.

The monthly bill comes from the fan-out, so the desktop and box hosts count every binding call per request, cron tick and queue message. `plan --usage` turns a run of that into a monthly estimate and flags a cron that keeps a Durable Object awake around the clock ([COSTS.md](COSTS.md#what-it-would-cost-a-month-plan---usage)). See [Typed deploys](REFERENCE.md#typed-deploys-thanks-to-effect), [Deploy to Hetzner](REFERENCE.md#deploy-to-hetzner), [Deploy to Railway](REFERENCE.md#deploy-to-railway), [DigitalOcean by hand](REFERENCE.md#deploy-to-digitalocean-by-hand) and [COSTS.md](COSTS.md).

</details>

### Why not just add in a CMS engine? I did.

Script pieces are kept in `content/*.json`, and `bun run cms` in the app serves them as textarea forms that save to those files. The same editor translates them into `content/<lang>/`.

<details><summary>More</summary>

`packages/cms` reads the shape from the file itself, so a form can change text but never add, drop or retype a key, and it only listens on `127.0.0.1`. Strings get one box, lists of strings one box with a line each. [Two Fronts](apps/two-fronts/README.md) (radio, chatter, cutscene lines, places) [Git Recon](apps/git-recon/README.md) (the director's radio, gags, chapter stories) and codeSplitter's landing page (`apps/codesplitter/content/landing.json`: hero, the scroll lines, every section's heading and blurb) are wired in; to add a game, move its lines into a `content/` folder, import them, and add a `cms` script like theirs.

Translations: **Add a language** on the editor's front page makes `content/<lang>/` (`es`, `pt-BR`), and each file gets a translate page that shows the original line under every box. A translation keeps the source's shape and its numbers, and a line left blank reads in the original, so a half-done language still works. In code, `localize(source, translation)` from `@rustybuns/cms/locale` gives the source with the translated lines swapped in, and `pickLocale(navigator.languages, have, "en")` picks one (`es-MX` reads `es`). codeSplitter's landing page and `/concepts` bundle every `content/<lang>/` at build time and read `?lang=es` or the browser's languages. Two Fronts and Git Recon pick a language once at boot and `localizeContent` writes it into the `content/*.json` their sims import, before the sim reads a line, so a replay stays a replay. TerraViz's Shared Sphere serves each globe its tour in that browser's language, steps and numbers from the original.

</details>

### Smoke test an app without laying a finger on it (help test it out more and report back!)

`rustybuns smoke [dir]` copies your app to a throwaway folder, installs it, builds it, starts it on the local twins, and tells you whether the home page answered. Nothing is deployed, and nothing in your own folder is touched.

<details><summary>More</summary>

The copy has no `.env` or `.dev.vars`; every secret the app names gets a fake value. It runs with an empty HOME and no cloud logins, and on macOS the host runs inside Seatbelt, Apple's sandbox. It tries the mode `init` picks, then the app's own Worker build if it has one. When it fails it says which step stopped (`install`, `init`, `build`, `boot` or `request`), and it deletes everything afterwards unless you pass `--keep`. No account is read, so it costs nothing. The same steps run over public GitHub repos in [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md).

`--edge-like` makes the local run behave more like the edge: idle Durable Objects are evicted after 70 seconds, every `process.env` read at import time is named, and the host restarts every 100 requests so module globals reset. `RB_EDGE_LIKE=1` turns the same on for any host, and `RB_EDGE_RECYCLE=N` sets how many requests between restarts (0 means never).

</details>

### Players report bugs straight into this repo

A signed-in player presses Report in a game and it lands here as an issue tagged `external` and with the game's name.

<details><summary>More</summary>

`POST /api/report` on [eqosys](apps/eqosys/README.md) takes the game's token, so it knows which game and which account sent it, and files a GitHub issue labelled `external`, `game:<id>` and `bug` or `enhancement`. The reporter is an opaque id, never an email, and `@mentions` in their text are defused. Each account gets 5 reports an hour and 20 a day, and each IP 5 a minute. A game adds the corner button with `reportButton()` from its `eqosys()` client (`@rustybuns/util/report`). Its look is the game's eqosys skin: `eqosys({ ..., skin: { theme, css } })` takes `--ui-*` tokens (packages/ui) and extra rules once, and the account chip (`accountChip(slot)`), achievement toast, report form, party lobby and spaces panel all wear it.

</details>

### Achievements on one account across every game

A game unlocks an achievement with one call, and the player's eqosys page shows every game's, earned and locked.

<details><summary>More</summary>

Each game's catalog lives in [eqosys](apps/eqosys/README.md) (`src/achievements.ts`), so a game can only unlock what it lists and eqosys can show "3 of 8" without asking it. In a page, `achieve(id)` from the `eqosys()` client (`@rustybuns/util/eqosys`) sends it with the game's token and answers whether it was new, showing the achievement toast the first time; an unlock earned signed out waits in the page and goes up at the next sign-in. Secret ones stay hidden until earned. Eight games have catalogs (Alien Disc Golf, Skate Tech Park, Delayed Reaction, Two Fronts, Mythic Masters, Park Hide & Seek, Git Recon, Splat Rooms and Super Spy Splat Shot), and a page asks once per achievement however often it calls. A friend hears each new unlock as one notification, and the Friends tab shows each friend's count. Signing in is quick too: a player already signed in to eqosys who has used the game before goes straight back from `/login` with no page in between.

</details>

### GDPR on one account, kept in the person's region

A player downloads everything eqosys holds about them in one file, and deleting the account shreds their own key, backups included.

<details><summary>More</summary>

`@rustybuns/util/privacy` is the part any app takes: `regionOf(request.cf)` says whether someone is in Europe (EU, EEA, UK, Switzerland), a
`Holder` list says what the app keeps, why (its GDPR basis) and how long, and `dossier()` turns that list into the person's download.
`seal`/`unseal` are AES-256-GCM under a per-person key, bound to the place the bytes belong, and `Vault` is the body of a per-person Durable
Object holding that key, a consent ledger and a log of what was asked for. In [eqosys](apps/eqosys/README.md) a European's vault is made in the
EU's Durable Object jurisdiction, cloud saves are sealed with its key, the privacy page and `GET /api/privacy/export` both read the one `HOLDERS`
list, and deleting the account shreds the vault first, so a save still in D1's 30 days of history can never be opened. GitHub, Google and
Apple tokens are kept encrypted too.

</details>

### Studios: one account that plays, keeps, makes and ships

A studio is an eqosys account that makes apps, at any size from one person to a business; QNTBR is the first, holding every Q app.

<details><summary>More</summary>

A person's eqosys account plays; a studio's makes. Each studio has members (owner, admin, maker) and a shelf of the apps it
makes, each with four doors: play it, keep your things in it, make it (its codeSplitter repo) and ship it (what is live). The
super admin's QNTBR studio is made the first time they open eqosys, with every app in `APPS` on its shelf. The Studio tab
on eqosys's home shows each studio you are in, your role, its members and the shelf; an owner or admin adds people there by
email, and anyone can make one (`src/app/Studio.tsx`). The tools are `eq_studios`, `eq_studio_make` and `eq_studio_add`. The plan, and how Qollab (the Durable Object layer: a hub a player, then a
party or space a room) sits under it, is [apps/eqosys/VISION.md](apps/eqosys/VISION.md).

</details>

### The Library takes other studios' games, after a review

A studio puts its own game in eqosys's Library as a draft, sends it to review, and once the super admin lists it, anyone signs in to it.

<details><summary>More</summary>

`APPS` stays ours, in code. A studio's game is a listing in D1 with the same fields (`src/listings.ts`): a draft signs in
only its own studio's members, so the maker tests the real sign-in from the real site first. `eq_listing_send` puts it in
the queue, `eq_listing_review` lists it or refuses it with a note, and `eq_listing_pull` takes it down (its tokens stop at
the door; players' saves go after 30 days). A listed game's tile names its studio. Every check of who may sign in or call
asks `appOf` there, which reads the listings once a minute per isolate. The design is [apps/eqosys/LIBRARY.md](apps/eqosys/LIBRARY.md).

</details>

### Real visitors, told from agents and bots, across the Q sites

eqosys's super admin sees who really came to eqosys, the Playground and each app that calls it: people who tapped or scrolled, apart from scripts, headless browsers and crawlers.

<details><summary>More</summary>

The sorting is `@rustybuns/util/visitors` (`kindOf(headers)`), shared with codeSplitter's insights: a Mozilla browser that sends the
`sec-fetch-*` headers is a person, a crawler that names itself a bot, and everything else (curl, AI clients, headless or spoofed browsers)
an agent. [eqosys](apps/eqosys/README.md#visitors-who-is-really-here) counts every request it answers under the app whose page sent it, and
static sites send a beacon to `POST /api/visit`: a view on open, and "engaged" on the first tap, key or scroll, which is what makes a
person real. Callers are a day-salted hash of the IP and browser, so no IP is kept; the admin's own visits are left out; 30 days are kept.

</details>

### Keys you can take back (experimental)

Test stacks mint their own secrets on create and drop them on destroy. Prod secrets come from 1Password behind your Touch ID.

<details><summary>More</summary>

Set `experimental.wheel` to `"agent"` and CI and agents can spin stacks up as often as they like with nothing to rotate. Set it to `"human"` and prod secrets resolve from 1Password at deploy time. Either way a committed `.env.schema` lists every secret by name, never value, so any machine knows what's needed. The 1Password path is untested so far; see [Who holds the keys](REFERENCE.md#who-holds-the-keys-experimental).
Tell me if more support for more things is wanted here!

</details>

### Leaving is a `git rm` away though we would be sad

Rusty Buns is a dev dependency: a few lines in `package.json` and one config file. It never edits `src/`, so you write your app logic once and it runs everywhere Rusty Buns can take it.

<details><summary>More</summary>

There's no framework API to unwind: your app stays a `fetch` handler with D1, KV, R2 and Durable Object bindings. Adopt it one target at a time, and drop it the same way. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Defaults you can take over

The defaults are a starting point, the way a copied UI component is: swap one piece, or `eject` the deploy program and own all of it. Good defaults, so your time goes on the idea and not on the framework.

<details><summary>More</summary>

Rusty Buns generates the host, the wrangler config and the Alchemy stack from `rustybuns.config.ts`. When a default stops fitting, change that piece and keep the rest: Postgres for D1, your own server beside the host, Rust or TypeScript for the hot path. `rustybuns eject` copies the Alchemy program to your repo, and from then on you own it. See [Adopting it in steps](ADOPTION.md#adopting-it-in-steps).

</details>

### Rusty Buns is a joke name because you need neither

TypeScript talks to everything. Bun runs it on a server and can call straight into Rust; in the browser the same Rust runs as WebAssembly. Vite builds the page and Bun runs the backend, and that is the whole floor. Everything else here (Alchemy, Effect, Cloudflare, Rust, Hetzner, Railway) is an option you add when you want it and drop when you don't.

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

[elysia-conduit](apps/elysia-conduit/RUSTYBUNS.md) is bedstack's RealWorld backend (Elysia 1.4, Drizzle, postgres.js), copied in as it is. A short entry exports `new Elysia().use(setupApp)` in place of their `.listen()`, and a `hyperdrive` binding with `local: "pglite"` applies their Drizzle migrations at boot. Their own Postman suite (32 requests, 311 assertions) passes on the dev host and on the 109 MB compiled binary. The pain is listed too: the entry has to copy the PGlite port into their `POSTGRES_*` variables, and on Workers the unchanged app breaks five ways ([#2278](https://github.com/QuinnsCode/RustyBuns/issues/2278)), starting with a Postgres client built at import time.

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

### Thousands of battles at low priority

Two Fronts plays thousands of headless battles to balance itself, as low-priority background work under the scheduler's CPU budget, and hands back a report you can scrub.

<details><summary>More</summary>

`bun apps/two-fronts/scripts/sim.ts --n 1000 --hero both --handicap 0,0.3,0.6` plays the battles on worker threads, with a scripted player in the hero's seat if you ask for one. It runs under the shell-bun scheduler's `balanced` budget (about 60% CPU and 50% memory by default; `--jobs` sets the worker count and defaults to the core count), so the desk stays usable while it works. Nothing leaves your machine and nothing is billed. It writes `dist/balance/report.json` and a self-contained `report.html`: win rates by sector, how often the hero beats a foe with 30% or 60% more, a heatmap of where each side stood with a time slider, and a replay of sampled battles to scrub. The scheduler above is the same one other tools use.

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
- **Small context, more tokens for the work.** codeSplitter's MCP server in code mode lists its 138 tools for 1,054 tokens instead of 30,240, and pages hand agents their buttons over WebMCP instead of screenshots. Numbers and guard rails in [WEBMCP.md](WEBMCP.md).
- **Guard rails.** `plan` and `deploy` catch a mistake before a server exists. `protect: true` on a database, bucket, queue, vector index, Durable Object or container (or the Worker) makes `destroy` leave it, and `plan`, `deploy` and `destroy` print a `[KEPT]` / `[REMOVED]` list first. See [Keep a resource through destroy](REFERENCE.md#config).
- **A host that can't reach your keys.** The dev host starts without your `.env`, auto-install or credential env vars, and `run desktop --sandbox` puts it in a macOS Seatbelt jail, kept out of `~/.ssh`, cloud logins and keychains. `plan`, `deploy` and `dev` keep the Cloudflare token and other deploy logins out of the Worker build too. See [Running code you didn't write](REFERENCE.md#running-code-you-didnt-write).
- **Rust without risk.** An agent can write the Rust engine and prove it matches the TypeScript one, sample by sample.
- **CI that explains its waits.** `bun scripts/ci-report.ts` reads a week of `apps` and `typecheck` runs and says where the queue time and job-minutes went, which tests blocked many PRs at once, and what moving suites to a schedule would save.

Nearly every commit in this repo is co-authored by Claude Code, some of them written at desks in [Agent Office](apps/agent-office/README.md), which is itself one of the examples below.

</details>

### A page's functions are its agent's tools and your Cmd+K

One list of plain functions per page becomes WebMCP tools, `window.__commands` and a Cmd/Ctrl+K palette.

<details><summary>More</summary>

`addCommands` from `@rustybuns/util/commands` takes functions in WebMCP's tool shape, and `mountPalette`
from `@rustybuns/util/palette` puts the same list behind Cmd/Ctrl+K for a person. An agent in the browser
and a person at the keyboard call the same function the same way, and a script without WebMCP calls
`__commands.run(name, args)`. Two Fronts, Delayed Reaction, Park Hide & Seek, Skate Tech Park and Mythic
Masters' gallery use it. See [WEBMCP.md](WEBMCP.md#one-list-for-agents-and-people).

</details>

### Any frame of any scene, one link away

A game's cutscenes are director scenes, and `?scene=<name>&t=<seconds>` holds any frame of any of them.

<details><summary>More</summary>

`@rustybuns/util/director` plays scenes made of camera takes (`reel.ts`), timed lines, cards and photos, one at a
time, with `seek(t)` and `paused` to hold a frame. Each game names its scenes in a table, so the same link opens
any of them, and `window.__scenes` lists and plays them for `bun run probe`. `bun run shots <app>` shoots every
named screen and scene at a phone, a tablet and a desk into `apps/<app>/docs/shots-<date>/`. Mythic Masters' tapes
and standoffs, and Git Recon's credits and outtakes, run on it.

</details>

### Cutscenes you can watch again, once you've seen them

A scene the game picks becomes a memory once it plays to its end, and the game lists those to play back.

<details><summary>More</summary>

`@rustybuns/util/memories` keeps the scenes you have seen on the device. The game wraps the ones it wants kept
(`memories.mark(scene, { id, scene, title, args })`) as it plays them, passes each director frame to `step`, and a
scene that plays to its end (a skip counts, walking off doesn't) is filed. Playing one back is `playNamed` from the
game's own scene table, where you stand now. Mythic Masters lists the tapes, arrivals, landmarks, sightings and first
bindings in the journal's Regions chapter under "Remembered"; Git Recon's menu offers the newsreel and the credits
once you've rolled them at the top of the climb.

</details>

### Accessible by default

The docs site works with a screen reader and a keyboard alone, and has reading settings with dyslexia-friendly fonts (Atkinson Hyperlegible, OpenDyslexic), larger text and wider spacing.

<details><summary>More</summary>

We aim for WCAG 2.2 AA. The reading settings and theme are also WebMCP tools, so an agent can change them for you. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for what's covered and how to report a barrier.

</details>

## Nerdy things RustyBuns gets you

The parts a team would be glad to find in the stack, each in its own entry above:

- **A machine that stays yours.** [Background work that steps aside](#background-work-that-steps-aside-experimental) runs low work under a CPU and memory budget and backs off when the machine is busy. [Two Fronts' balance sim](#thousands-of-battles-at-low-priority) plays thousands of headless battles as low-priority work under the scheduler's budget, then hands back a heatmap and a replay with a time slider.
- **A fast loop with receipts.** [Build timings](#a-fast-loop-and-it-tells-you-how-fast) saved per step, so a checker or Bun upgrade shows what it really saved.
- **Free local twins.** [Every Cloudflare binding has an easy local twin](#every-cloudflare-binding-has-an-easy-local-twin), and [plans 
  come before anything costs money](#plan-step-plan-before-anything-costs-money-see-the-resource-matrix).

## What's the catch?

- **No native menus, tray, installers or auto-update yet.** If you need a native-feeling window today, use Electron or Tauri. Mac signing and notarization are built in (`build desktop --sign`, `--notarize`) and need only an Apple Developer ID; Windows signing isn't built yet.
- **The desktop app is a Chrome tab, not a window of its own.** Closing the tab doesn't stop the host, there's no dock or taskbar entry of its own, and the user needs Chrome installed. No deep links (`myapp://`), file associations, global shortcuts or native file dialogs either. System access isn't the gap: the Bun host already has the filesystem, processes, sqlite and FFI. What's missing is the window and the OS hooks around it. A thin native window around the same host (Tauri, say) would add them without moving the backend.
- **Updating means downloading a new binary by hand.** The planned shape: the host fetches a new hashed binary, checks the hash, swaps itself and restarts, with a manifest served from a Worker or R2. On a Mac the swapped binary must still be signed and notarized or Gatekeeper may quarantine it, which hasn't been tried.
- **You build on macOS or Linux, not Windows.** Windows is a target, not a build machine: build it from a Mac or a Linux server. A Rust cdylib cross-compiles only to Linux (in Docker); wasm crates go anywhere.
- **Windows is the least tested.** CI boots one app with no backend on Windows on Arm; nothing with a backend runs on Windows in CI yet. If you build in WSL or run a binary on Windows (x64 or Arm), [tell us](https://github.com/QuinnsCode/RustyBuns/issues/new) what worked and what didn't.
- **The binary is about 60 to 110 MB**, depending on the app, because Bun is inside it. It's one file with no install step, but it isn't small.
- **It renders in the user's Chrome** (or default browser), not a bundled one.
- **The twins aren't workerd.** They're the production runtime for the laptop and the box, not a copy of the Workers runtime. Limits match; a few bindings (Vectorize, Workers AI, the Worker Loader) are stand-ins. `rustybuns dev` still runs workerd for edge work. The full list is in [Where the twins differ from the edge](ADOPTION.md#where-the-twins-differ-from-the-edge).
- **Same code, different assumptions.** A long-lived process, one user and a local sqlite file on the desktop; isolates that come and go, many users and D1 on the edge, with no sync between them. Those change app logic, not just bindings: [Where the same code stops being the same](ADOPTION.md#where-the-same-code-stops-being-the-same).
- **Alpha, one maintainer.** The examples are the test bed, not a portfolio. More in [Questions people ask](ADOPTION.md#questions-people-ask).

If what you have is a web app with a backend, and you want it on a laptop, on the edge *and* on a server, nothing else does all three from one codebase.

## See it work

Every example is one codebase that runs as a desktop binary. The multiplayer ones run on Cloudflare from the same code.

> **Caution: the example apps are provided as is.** I build and change them nearly every day, so they move fast and haven't been through a formal security review. Some run coding agents, spawn shells or spend API credits on your behalf. Run them on a machine and network you trust, keep your API keys to yourself, and read the code before you point one at anything that matters. No warranty, see [LICENSING.md](LICENSING.md).

<!-- apps: written by `bun run docs` from docs/readme/apps.json -->

### Featured: codeSplitter

The code host for the agentic era, and the reason a lot of the rest exists. [Try it](https://codesplitter.notryanquinn.workers.dev).

<table>
<tr><td align="center" valign="top"><a href="apps/codesplitter/README.md"><img src="docs/readme/codesplitter.jpg" width="720" alt="codeSplitter" title="A code host for the agentic era: every file a Durable Object, agents editing line by line, real git on Cloudflare Artifacts, an MCP server, on the edge and as a desktop app from one codebase. Try it"></a><br><a href="apps/codesplitter/README.md" title="A code host for the agentic era: every file a Durable Object, agents editing line by line, real git on Cloudflare Artifacts, an MCP server, on the edge and as a desktop app from one codebase. Try it"><b>codeSplitter</b></a><br><sub><a href="https://codesplitter.notryanquinn.workers.dev">Play</a></sub></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[codeSplitter](apps/codesplitter/README.md)**: A code host for the agentic era: every file a Durable Object, agents editing line by line, real git on Cloudflare Artifacts, an MCP server, on the edge and as a desktop app from one codebase. [Try it](https://codesplitter.notryanquinn.workers.dev)

</details>

### Games

The fun ones. Most play in the browser, and every one runs as a desktop app. Most recently worked on first.

<table>
<tr><td align="center" valign="top"><a href="apps/mythic-masters/README.md"><img src="docs/readme/mythic-masters.jpg" width="200" alt="Mythic Masters" title="A 3D creature arena brawler where mass, height and stats shape each body, flyers have to come down, and a headless bot-vs-bot tuner keeps 76 folklore beasts, from a 6 kg jackalope to a tonne of lake monster, each winning about half its fights; one arena layout wearing a skin per built region, on a route of 64 folklore regions"></a><br><a href="apps/mythic-masters/README.md" title="A 3D creature arena brawler where mass, height and stats shape each body, flyers have to come down, and a headless bot-vs-bot tuner keeps 76 folklore beasts, from a 6 kg jackalope to a tonne of lake monster, each winning about half its fights; one arena layout wearing a skin per built region, on a route of 64 folklore regions"><b>Mythic Masters</b></a><br><sub><a href="https://mythic-masters.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/hippo-tycoon/README.md"><img src="docs/readme/hippo-tycoon.jpg" width="200" alt="Hippo Tycoon" title="One game class runs as a Durable Object on Cloudflare and in-process in the binary: solo, couch, LAN party and online rooms"></a><br><a href="apps/hippo-tycoon/README.md" title="One game class runs as a Durable Object on Cloudflare and in-process in the binary: solo, couch, LAN party and online rooms"><b>Hippo Tycoon</b></a><br><sub><a href="https://hippo-ty32kk4m44sz57g2i6knvzzb7o-production.up.railway.app">Play</a></sub></td><td align="center" valign="top"><a href="apps/splat-spray/README.md"><img src="docs/readme/splat-spray.jpg" width="200" alt="Super Spy Splat Shot" title="A spy game in a pitch-dark Gaussian-splat room: a three.js page made a desktop app by a short config, and the same page races friends online on a Worker"></a><br><a href="apps/splat-spray/README.md" title="A spy game in a pitch-dark Gaussian-splat room: a three.js page made a desktop app by a short config, and the same page races friends online on a Worker"><b>Super Spy Splat Shot</b></a><br><sub><a href="https://supersplatspyshot.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/skate-tech-park/README.md"><img src="docs/readme/skate-tech-park.jpg" width="200" alt="Skate Tech Park" title="Skate a street spot, or take a rocket roadster with ten cold-gas thrusters over the gap: a three.js page on a pure fixed-step sim the tests drive headless"></a><br><a href="apps/skate-tech-park/README.md" title="Skate a street spot, or take a rocket roadster with ten cold-gas thrusters over the gap: a three.js page on a pure fixed-step sim the tests drive headless"><b>Skate Tech Park</b></a><br><sub><a href="https://skatetechpark.notryanquinn.workers.dev">Play</a></sub></td></tr>
<tr><td align="center" valign="top"><a href="apps/park-hide-seek/README.md"><img src="docs/readme/park-hide-seek.jpg" width="200" alt="Park Hide &amp; Seek" title="3D hide and seek on real Yosemite terrain, played by the page, by a LAN host or by the edge; each player is sent only what they can see. Play it"></a><br><a href="apps/park-hide-seek/README.md" title="3D hide and seek on real Yosemite terrain, played by the page, by a LAN host or by the edge; each player is sent only what they can see. Play it"><b>Park Hide & Seek</b></a><br><sub><a href="https://park-hide-seek.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/alien-disc-golf/README.md"><img src="docs/readme/alien-disc-golf.jpg" width="200" alt="Alien Disc Golf" title="Disc golf where the course is the planet: nine holes between random countries on a three.js globe, the disc carried by NOAA's real wind right now (the Worker relays the latest GFS grid from NOMADS, the page decodes the GRIB2), a lofted throw riding the jet stream; guess which country you're teeing off from for a stroke back"></a><br><a href="apps/alien-disc-golf/README.md" title="Disc golf where the course is the planet: nine holes between random countries on a three.js globe, the disc carried by NOAA's real wind right now (the Worker relays the latest GFS grid from NOMADS, the page decodes the GRIB2), a lofted throw riding the jet stream; guess which country you're teeing off from for a stroke back"><b>Alien Disc Golf</b></a><br><sub><a href="https://alien-disc-golf.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/two-fronts/README.md"><img src="docs/readme/two-fronts.jpg" width="200" alt="Two Fronts" title="Thunder Marines vs the Wooka horde: a turn-based galactic war plus three.js hero battles in orbit and on six worlds, one per kind of sector (redwood forest, desert, ruined city, glowing alien night, beach, deep-space station), built apart and joined by small JSON types (a spec in, a result out); play the AI or hotseat in the page, or a friend online through a Durable Object per campaign"></a><br><a href="apps/two-fronts/README.md" title="Thunder Marines vs the Wooka horde: a turn-based galactic war plus three.js hero battles in orbit and on six worlds, one per kind of sector (redwood forest, desert, ruined city, glowing alien night, beach, deep-space station), built apart and joined by small JSON types (a spec in, a result out); play the AI or hotseat in the page, or a friend online through a Durable Object per campaign"><b>Two Fronts</b></a><br><sub><a href="https://two-fronts.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/git-recon/README.md"><img src="docs/readme/git-recon.jpg" width="200" alt="Git Recon" title="A repo as a shooter level: its folders become compounds and its files buildings on real ground (Yosemite, or any lat/long) or a plastic-army kitchen and garden, fought with git commands as weapons, in the page on your own, up to 64 to a battle over the LAN, or online in a Durable Object per room"></a><br><a href="apps/git-recon/README.md" title="A repo as a shooter level: its folders become compounds and its files buildings on real ground (Yosemite, or any lat/long) or a plastic-army kitchen and garden, fought with git commands as weapons, in the page on your own, up to 64 to a battle over the LAN, or online in a Durable Object per room"><b>Git Recon</b></a><br><sub><a href="https://git-recon.notryanquinn.workers.dev">Play</a></sub></td></tr>
<tr><td align="center" valign="top"><a href="apps/delayed-reaction/README.md"><img src="docs/readme/delayed-reaction.jpg" width="200" alt="Delayed Reaction" title="A phone-first rhythm game: you sprint down a rolling neon tunnel, a ring calls a note, you answer it a bar later on one of four thumb pads, and your answers echo back through a dub delay; the sim plays in beats with no page, so a test runs every level"></a><br><a href="apps/delayed-reaction/README.md" title="A phone-first rhythm game: you sprint down a rolling neon tunnel, a ring calls a note, you answer it a bar later on one of four thumb pads, and your answers echo back through a dub delay; the sim plays in beats with no page, so a test runs every level"><b>Delayed Reaction</b></a><br><sub>Coming soon</sub></td><td align="center" valign="top"><a href="apps/excalibrawl/README.md"><img src="docs/readme/excalibrawl.jpg" width="200" alt="Excalibrawl" title="An hourly drawing fight: Clef vs Clef Flash picking only a move, shape, colour, grid cell and size from a picture of their halves, or two text models writing a token-cheap drawing language, with Clef as referee, for two cents or less a fight; replays and a live socket in R2 and a Durable Object"></a><br><a href="apps/excalibrawl/README.md" title="An hourly drawing fight: Clef vs Clef Flash picking only a move, shape, colour, grid cell and size from a picture of their halves, or two text models writing a token-cheap drawing language, with Clef as referee, for two cents or less a fight; replays and a live socket in R2 and a Durable Object"><b>Excalibrawl</b></a><br><sub><a href="https://excalibrawl.notryanquinn.workers.dev">Play</a></sub></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[Mythic Masters](apps/mythic-masters/README.md)**: A 3D creature arena brawler where mass, height and stats shape each body, flyers have to come down, and a headless bot-vs-bot tuner keeps 76 folklore beasts, from a 6 kg jackalope to a tonne of lake monster, each winning about half its fights; one arena layout wearing a skin per built region, on a route of 64 folklore regions
- **[Hippo Tycoon](apps/hippo-tycoon/README.md)**: One game class runs as a Durable Object on Cloudflare and in-process in the binary: solo, couch, LAN party and online rooms
- **[Super Spy Splat Shot](apps/splat-spray/README.md)**: A spy game in a pitch-dark Gaussian-splat room: a three.js page made a desktop app by a short config, and the same page races friends online on a Worker
- **[Skate Tech Park](apps/skate-tech-park/README.md)**: Skate a street spot, or take a rocket roadster with ten cold-gas thrusters over the gap: a three.js page on a pure fixed-step sim the tests drive headless
- **[Park Hide & Seek](apps/park-hide-seek/README.md)**: 3D hide and seek on real Yosemite terrain, played by the page, by a LAN host or by the edge; each player is sent only what they can see. [Play it](https://park-hide-seek.notryanquinn.workers.dev)
- **[Alien Disc Golf](apps/alien-disc-golf/README.md)**: Disc golf where the course is the planet: nine holes between random countries on a three.js globe, the disc carried by NOAA's real wind right now (the Worker relays the latest GFS grid from NOMADS, the page decodes the GRIB2), a lofted throw riding the jet stream; guess which country you're teeing off from for a stroke back
- **[Two Fronts](apps/two-fronts/README.md)**: Thunder Marines vs the Wooka horde: a turn-based galactic war plus three.js hero battles in orbit and on six worlds, one per kind of sector (redwood forest, desert, ruined city, glowing alien night, beach, deep-space station), built apart and joined by small JSON types (a spec in, a result out); play the AI or hotseat in the page, or a friend online through a Durable Object per campaign
- **[Git Recon](apps/git-recon/README.md)**: A repo as a shooter level: its folders become compounds and its files buildings on real ground (Yosemite, or any lat/long) or a plastic-army kitchen and garden, fought with git commands as weapons, in the page on your own, up to 64 to a battle over the LAN, or online in a Durable Object per room
- **[Delayed Reaction](apps/delayed-reaction/README.md)**: A phone-first rhythm game: you sprint down a rolling neon tunnel, a ring calls a note, you answer it a bar later on one of four thumb pads, and your answers echo back through a dub delay; the sim plays in beats with no page, so a test runs every level
- **[Excalibrawl](apps/excalibrawl/README.md)**: An hourly drawing fight: Clef vs Clef Flash picking only a move, shape, colour, grid cell and size from a picture of their halves, or two text models writing a token-cheap drawing language, with Clef as referee, for two cents or less a fight; replays and a live socket in R2 and a Durable Object

</details>

### One account, one front door

What ties the apps together: one sign-in for all of them, and one page that lists them.

<table>
<tr><td align="center" valign="top"><a href="apps/eqosys/README.md"><img src="docs/readme/eqosys.jpg" width="200" alt="eqosys" title="Your home for every Q game: your games, friends, saves and studio on one account. Under it, Better Auth on D1, a PKCE code handoff to each app with a signed token it can check alone, which app each person came from and what they may do in each, and a Durable Object a person for friends, presence and notifications. Also a plain OpenID provider, so a site's own Better Auth or a native app signs in with it"></a><br><a href="apps/eqosys/README.md" title="Your home for every Q game: your games, friends, saves and studio on one account. Under it, Better Auth on D1, a PKCE code handoff to each app with a signed token it can check alone, which app each person came from and what they may do in each, and a Durable Object a person for friends, presence and notifications. Also a plain OpenID provider, so a site's own Better Auth or a native app signs in with it"><b>eqosys</b></a><br><sub><a href="https://eqosys.qntbr.com">Play</a></sub></td><td align="center" valign="top"><a href="apps/playground/README.md"><img src="docs/readme/playground.jpg" width="200" alt="Playground" title="One page that lists every app with a way to try it: Play, Download or Source. Static assets only, so it bills nothing"></a><br><a href="apps/playground/README.md" title="One page that lists every app with a way to try it: Play, Download or Source. Static assets only, so it bills nothing"><b>Playground</b></a></td><td align="center" valign="top"><a href="apps/qollab/README.md" title="Realtime rooms for any app on Cloudflare: rooms, seats, parties, presence and saves in one call. Built into eqosys as a Worker of its own, with a Durable Object a player and a room"><b>Qollab</b></a></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[eqosys](apps/eqosys/README.md)**: Your home for every Q game: your games, friends, saves and studio on one account. Under it, Better Auth on D1, a PKCE code handoff to each app with a signed token it can check alone, which app each person came from and what they may do in each, and a Durable Object a person for friends, presence and notifications. Also a plain OpenID provider, so a site's own Better Auth or a native app signs in with it
- **[Qollab](apps/qollab/README.md)**: Realtime rooms for any app on Cloudflare: rooms, seats, parties, presence and saves in one call. Built into eqosys as a Worker of its own, with a Durable Object a player and a room
- **[Playground](apps/playground/README.md)**: One page that lists every app with a way to try it: Play, Download or Source. Static assets only, so it bills nothing

</details>

### My apps

Real tools for real work, some under their own license.

<table>
<tr><td align="center" valign="top"><a href="apps/sharesplat/README.md"><img src="docs/readme/sharesplat.jpg" width="200" alt="ShareSplat" title="Product photos to a 3D spin for a store page: a guided phone shot list (six sides for an AI-guessed mesh, or 72 photos in rings for a real Gaussian splat) and a turntable splat viewer with a paste-in Shopify embed"></a><br><a href="apps/sharesplat/README.md" title="Product photos to a 3D spin for a store page: a guided phone shot list (six sides for an AI-guessed mesh, or 72 photos in rings for a real Gaussian splat) and a turntable splat viewer with a paste-in Shopify embed"><b>ShareSplat</b></a><br><sub><a href="https://sharesplat.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/qcrm/README.md"><img src="docs/readme/qcrm.jpg" width="200" alt="qCRM" title="A CRM with MCP built in, a Rust wasm engine in the browser, office sync, signed webhooks and a desktop build; roles for a real place and hashed org ids. QNTBR-licensed."></a><br><a href="apps/qcrm/README.md" title="A CRM with MCP built in, a Rust wasm engine in the browser, office sync, signed webhooks and a desktop build; roles for a real place and hashed org ids. QNTBR-licensed."><b>qCRM</b></a><br><sub><a href="https://qcrm.qntbr.com">Play</a></sub></td><td align="center" valign="top"><a href="apps/geoboxq/README.md"><img src="docs/readme/geoboxq.jpg" width="200" alt="GeoBoxQ" title="Shipping box fit checker with a Rust engine that packs boxes inside boxes. Private license."></a><br><a href="apps/geoboxq/README.md" title="Shipping box fit checker with a Rust engine that packs boxes inside boxes. Private license."><b>GeoBoxQ</b></a><br><sub><a href="https://geoboxq-worker-live-ryanquinn-tjhne4lpmumy6kz5.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/what-would-fantano-say/README.md"><img src="docs/readme/what-would-fantano-say.jpg" width="200" alt="What Would Fantano Say" title="A parody music critic as an RWSDK Worker: the phone decodes the song and picks a 15 s clip, and Cloudflare's Clef-omni judges it for about $5 per 100,000 reviews, behind a rate limit, Turnstile, an edge cache and a daily budget"></a><br><a href="apps/what-would-fantano-say/README.md" title="A parody music critic as an RWSDK Worker: the phone decodes the song and picks a 15 s clip, and Cloudflare's Clef-omni judges it for about $5 per 100,000 reviews, behind a rate limit, Turnstile, an edge cache and a daily budget"><b>What Would Fantano Say</b></a><br><sub><a href="https://what-would-fantano-say.notryanquinn.workers.dev">Play</a></sub></td></tr>
<tr><td align="center" valign="top"><a href="apps/at-lens/README.md"><img src="docs/readme/at-lens.jpg" width="200" alt="AT Lens" title="Type a handle and watch the AT Protocol work: domain to DID to data server to typed records, checked both ways, then the account live on the Jetstream firehose; sign in with atproto OAuth to write a record of our own Lexicon and watch it come back; no keys, no bindings"></a><br><a href="apps/at-lens/README.md" title="Type a handle and watch the AT Protocol work: domain to DID to data server to typed records, checked both ways, then the account live on the Jetstream firehose; sign in with atproto OAuth to write a record of our own Lexicon and watch it come back; no keys, no bindings"><b>AT Lens</b></a></td><td align="center" valign="top"><a href="apps/brianfloresblitzing/README.md"><img src="docs/readme/brianfloresblitzing.jpg" width="200" alt="One Team in 32" title="One static page (&quot;One Team in 32&quot;) served from a Cloudflare Worker as plain assets, no Worker code"></a><br><a href="apps/brianfloresblitzing/README.md" title="One static page (&quot;One Team in 32&quot;) served from a Cloudflare Worker as plain assets, no Worker code"><b>One Team in 32</b></a></td><td align="center" valign="top"><a href="apps/geoboxq-shopify/README.md" title="A small wrapper that turns a Shopify cart into the store's own box."><b>GeoBoxQ for Shopify</b></a></td><td align="center" valign="top"><a href="apps/artstewengine/README.md" title="A tiny RWSDK app on D1 with a Better Auth admin page: add who has paid, and qCRM's sealed engine gets its key only for a paid license"><b>artstewengine</b></a></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[ShareSplat](apps/sharesplat/README.md)**: Product photos to a 3D spin for a store page: a guided phone shot list (six sides for an AI-guessed mesh, or 72 photos in rings for a real Gaussian splat) and a turntable splat viewer with a paste-in Shopify embed
- **[qCRM](apps/qcrm/README.md)**: A CRM with MCP built in, a Rust wasm engine in the browser, office sync, signed webhooks and a desktop build; roles for a real place and hashed org ids. QNTBR-licensed.
- **[GeoBoxQ](apps/geoboxq/README.md)**: Shipping box fit checker with a Rust engine that packs boxes inside boxes. Private license.
- **[GeoBoxQ for Shopify](apps/geoboxq-shopify/README.md)**: A small wrapper that turns a Shopify cart into the store's own box.
- **[artstewengine](apps/artstewengine/README.md)**: A tiny RWSDK app on D1 with a Better Auth admin page: add who has paid, and qCRM's sealed engine gets its key only for a paid license
- **[What Would Fantano Say](apps/what-would-fantano-say/README.md)**: A parody music critic as an RWSDK Worker: the phone decodes the song and picks a 15 s clip, and Cloudflare's Clef-omni judges it for about $5 per 100,000 reviews, behind a rate limit, Turnstile, an edge cache and a daily budget
- **[AT Lens](apps/at-lens/README.md)**: Type a handle and watch the AT Protocol work: domain to DID to data server to typed records, checked both ways, then the account live on the Jetstream firehose; sign in with atproto OAuth to write a record of our own Lexicon and watch it come back; no keys, no bindings
- **[One Team in 32](apps/brianfloresblitzing/README.md)**: One static page ("One Team in 32") served from a Cloudflare Worker as plain assets, no Worker code

</details>

### The workshop

Music, 3D and circuits: tools for making things, with a Rust engine beside a TypeScript one where it pays.

<table>
<tr><td align="center" valign="top"><a href="apps/fm-daw/README.md"><img src="docs/readme/fm-daw.jpg" width="200" alt="FM Groovebox" title="One Rust crate as wasm in the audio thread and over FFI on the host, bit-identical to the TypeScript engine"></a><br><a href="apps/fm-daw/README.md" title="One Rust crate as wasm in the audio thread and over FFI on the host, bit-identical to the TypeScript engine"><b>FM Groovebox</b></a><br><sub><a href="https://fm-daw-worker-live-ryanquinn-ugis7btfi5dsu52t.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/splat-rooms/README.md"><img src="docs/readme/splat-rooms.jpg" width="200" alt="Splat Rooms" title="A splat hunting game with a world class and 30 MB scenes streamed from a folder on your disk, never embedded"></a><br><a href="apps/splat-rooms/README.md" title="A splat hunting game with a world class and 30 MB scenes streamed from a folder on your disk, never embedded"><b>Splat Rooms</b></a><br><sub><a href="https://splat-rooms.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/auto-rig/README.md"><img src="docs/readme/auto-rig.jpg" width="200" alt="Auto Rig" title="Auto-rigging a 3D model in Rust and TypeScript with identical output"></a><br><a href="apps/auto-rig/README.md" title="Auto-rigging a 3D model in Rust and TypeScript with identical output"><b>Auto Rig</b></a><br><sub><a href="https://auto-rig.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/meshy-studio/README.md"><img src="docs/readme/meshy-studio.jpg" width="200" alt="Meshy Studio" title="A folder-based batch tool for Meshy's API (image, multi-image and text to 3D, texture, remesh, rig, animate, concept art): your key stays local, every spend is priced first"></a><br><a href="apps/meshy-studio/README.md" title="A folder-based batch tool for Meshy's API (image, multi-image and text to 3D, texture, remesh, rig, animate, concept art): your key stays local, every spend is priced first"><b>Meshy Studio</b></a></td></tr>
<tr><td align="center" valign="top"><a href="apps/tscircuit-desktop/README.md"><img src="docs/readme/tscircuit-desktop.jpg" width="200" alt="tscircuit Desktop" title="A heavy, real-world Vite app as one file, with a Rust engine up to 22x faster and a TypeScript fallback"></a><br><a href="apps/tscircuit-desktop/README.md" title="A heavy, real-world Vite app as one file, with a Rust engine up to 22x faster and a TypeScript fallback"><b>tscircuit Desktop</b></a></td><td align="center" valign="top"><a href="apps/motion-midi/README.md" title="One synth in Rust and in TypeScript, checked sample by sample"><b>Motion MIDI</b></a></td><td align="center" valign="top"><a href="apps/splat-desktop/README.md" title="PlayCanvas' SuperSplat editor as a desktop app working on a folder on your disk"><b>Splat Desktop</b></a></td><td align="center" valign="top"><a href="apps/pixel-rag/README.md" title="Drop in your screenshots and find the parts that look alike across all of them. One Rust index shared by every worker, web or desktop."><b>Pixel RAG</b></a></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[FM Groovebox](apps/fm-daw/README.md)**: One Rust crate as wasm in the audio thread and over FFI on the host, bit-identical to the TypeScript engine
- **[Splat Rooms](apps/splat-rooms/README.md)**: A splat hunting game with a world class and 30 MB scenes streamed from a folder on your disk, never embedded
- **[Auto Rig](apps/auto-rig/README.md)**: Auto-rigging a 3D model in Rust and TypeScript with identical output
- **[Meshy Studio](apps/meshy-studio/README.md)**: A folder-based batch tool for Meshy's API (image, multi-image and text to 3D, texture, remesh, rig, animate, concept art): your key stays local, every spend is priced first
- **[Motion MIDI](apps/motion-midi/README.md)**: One synth in Rust and in TypeScript, checked sample by sample
- **[Splat Desktop](apps/splat-desktop/README.md)**: PlayCanvas' SuperSplat editor as a desktop app working on a folder on your disk
- **[tscircuit Desktop](apps/tscircuit-desktop/README.md)**: A heavy, real-world Vite app as one file, with a Rust engine up to 22x faster and a TypeScript fallback
- **[Pixel RAG](apps/pixel-rag/README.md)**: Drop in your screenshots and find the parts that look alike across all of them. One Rust index shared by every worker, web or desktop.

</details>

### Everything else: frameworks, other people's apps and test fixtures

A framework's own sample app, or someone else's app, run with its code unchanged, plus the small apps the tests lean on. A new app lands here first, until it's moved to its section.

<table>
<tr><td align="center" valign="top"><a href="apps/agent-office/README.md" title="Someone else's Node server (PTYs, WebSockets, a 3D client) as one binary, nothing forked"><b>Agent Office</b></a></td><td align="center" valign="top"><a href="apps/terraviz-demo/README.md" title="TerraViz, The Zyra Project's Science On a Sphere globe (Apache-2.0, not ours), cloned and run with its code unchanged, plus Shared Sphere on top: a room on one globe, a teacher's lock so a class follows one pair of hands, NOAA tour scripts kept in step on every screen and read as slides by a small Rust crate"><b>TerraViz</b></a></td><td align="center" valign="top"><a href="apps/nuxt-example/README.md" title="A Nuxt 4 app on Nitro's cloudflare-module preset (one KV binding) as a desktop app with no edits: init reads it and the host runs the Worker Nitro built; the same shared HTTP journey checks it"><b>Nuxt</b></a></td><td align="center" valign="top"><a href="apps/qwik-example/README.md" title="A Qwik City app on its own cloudflare-pages adapter (a routeLoader$ and a routeAction$ counting in KV through platform.env) as a desktop app with no edits; init reads the adapter's dist/_worker.js as it is"><b>Qwik City</b></a></td><td align="center" valign="top"><a href="apps/astro-example/README.md" title="An Astro site on @astrojs/cloudflare (a server page and an API route counting in KV through cloudflare:workers) as a desktop app with no edits, and init reads it as it is"><b>Astro</b></a></td><td align="center" valign="top"><a href="apps/elysia-example/README.md" title="An Elysia Worker as Elysia's Cloudflare guide writes it (aot: false, cloudflare:workers) as a desktop app with no edits, and init now reads Elysia"><b>Elysia</b></a></td></tr>
<tr><td align="center" valign="top"><a href="apps/sveltekit-example/README.md" title="A SvelteKit 3 app on the Cloudflare adapter (a load from KV, a form action that bumps it) as a desktop app with no edits: the same sample app contract as hono-example, checked by the same shared journey"><b>SvelteKit</b></a></td><td align="center" valign="top"><a href="apps/solidstart-example/README.md" title="A SolidStart 2 app on Nitro's cloudflare_module preset (a &quot;use server&quot; query and an API route counting in KV through cloudflare:workers) as a desktop app with no edits, and rustybuns init reads it as it is."><b>SolidStart</b></a></td><td align="center" valign="top"><a href="apps/react-router-example/README.md" title="React Router 7 on Cloudflare's own template (workers/app.ts, the Vite plugin, a loader and an action over KV) as a desktop app with no edits: the second framework on the shared sample-app journey"><b>React Router</b></a></td><td align="center" valign="top"><a href="apps/nextjs-example/README.md" title="A Next.js 16 app on @opennextjs/cloudflare (one KV binding) as a desktop app with no edits: init reads it and the host runs the worker.js OpenNext built; the same shared HTTP journey checks it"><b>Next.js</b></a></td><td align="center" valign="top"><a href="apps/svelte-spa-example/README.md" title="A client-only Svelte 5 + Vite app (no server) as a desktop app, its counter in a &quot;use server&quot; action the host runs."><b>Svelte SPA</b></a></td><td align="center" valign="top"><a href="apps/vue-spa-example/README.md" title="A client-only Vue 3 + Vite app (no server) as a desktop app, its counter in a &quot;use server&quot; action the host runs."><b>Vue SPA</b></a></td></tr>
<tr><td align="center" valign="top"><a href="apps/solid-spa-example/README.md" title="A client-only Solid + Vite app (no server) as a desktop app, its counter in a &quot;use server&quot; action the host runs."><b>Solid SPA</b></a></td><td align="center" valign="top"><a href="apps/hono-example/README.md" title="A Hono Worker from Hono's own docs (one KV binding) as a desktop app with no edits: the sample app contract every framework example meets, checked by one shared HTTP journey"><b>Hono</b></a></td><td align="center" valign="top"><a href="apps/elysia-conduit/RUSTYBUNS.md" title="bedstack's RealWorld backend (Elysia, Drizzle, postgres.js) with no source edits: a desktop binary on PGlite that passes their Postman suite, and the five ways it breaks on Workers"><b>Elysia RealWorld</b></a></td><td align="center" valign="top"><a href="apps/tanstack-start-example/README.md" title="TanStack Start on Cloudflare's Vite plugin (server functions, a server route, D1 and KV) as a desktop app, its code unchanged"><b>TanStack Start</b></a></td><td align="center" valign="top"><a href="apps/hello-world/README.md" title="The first five minutes: a twenty-line page that the welcome tour digs up, lets three agents rewrite at once, then asks why not deploy it"><b>Hello World</b></a><br><sub><a href="https://hello-world.notryanquinn.workers.dev">Play</a></sub></td><td align="center" valign="top"><a href="apps/agent-demo/README.md" title="A small snack-vote Worker seeded into codeSplitter, so several coding agents can build it at once and settle a merge conflict on camera"><b>Agent Demo</b></a></td></tr>
<tr><td align="center" valign="top"><a href="apps/borg-postgres/README.md" title="A Postgres app keeps its database and moves its code: Hyperdrive on the edge, PGlite on the desktop."><b>Borg Postgres</b></a></td><td align="center" valign="top"><a href="apps/borg/README.md" title="Not an app: a small Worker that uses every binding once, so one suite can check the local twins against a real deploy"><b>Borg</b></a></td><td align="center" valign="top"><a href="apps/spa-example/README.md" title="Not an app: a slice of a real RWSDK game that the tests use to check init reads it right"><b>SPA fixture</b></a></td><td align="center" valign="top"><a href="apps/example/README.md" title="A whole Worker (D1, KV, a Durable Object) as a desktop binary in half a second, plus a Rust FFI probe with a TypeScript fallback"><b>Worker example</b></a></td></tr>
</table>

<details><summary>What each one proves</summary>

- **[Agent Office](apps/agent-office/README.md)**: Someone else's Node server (PTYs, WebSockets, a 3D client) as one binary, nothing forked
- **[TerraViz](apps/terraviz-demo/README.md)**: TerraViz, The Zyra Project's Science On a Sphere globe (Apache-2.0, not ours), cloned and run with its code unchanged, plus Shared Sphere on top: a room on one globe, a teacher's lock so a class follows one pair of hands, NOAA tour scripts kept in step on every screen and read as slides by a small Rust crate
- **[Nuxt](apps/nuxt-example/README.md)**: A Nuxt 4 app on Nitro's `cloudflare-module` preset (one KV binding) as a desktop app with no edits: `init` reads it and the host runs the Worker Nitro built; the same shared HTTP journey checks it
- **[Qwik City](apps/qwik-example/README.md)**: A Qwik City app on its own `cloudflare-pages` adapter (a `routeLoader$` and a `routeAction$` counting in KV through `platform.env`) as a desktop app with no edits; `init` reads the adapter's `dist/_worker.js` as it is
- **[Astro](apps/astro-example/README.md)**: An Astro site on `@astrojs/cloudflare` (a server page and an API route counting in KV through `cloudflare:workers`) as a desktop app with no edits, and `init` reads it as it is
- **[Elysia](apps/elysia-example/README.md)**: An Elysia Worker as Elysia's Cloudflare guide writes it (`aot: false`, `cloudflare:workers`) as a desktop app with no edits, and `init` now reads Elysia
- **[SvelteKit](apps/sveltekit-example/README.md)**: A SvelteKit 3 app on the Cloudflare adapter (a `load` from KV, a form action that bumps it) as a desktop app with no edits: the same sample app contract as hono-example, checked by the same shared journey
- **[SolidStart](apps/solidstart-example/README.md)**: A SolidStart 2 app on Nitro's `cloudflare_module` preset (a `"use server"` query and an API route counting in KV through `cloudflare:workers`) as a desktop app with no edits, and `rustybuns init` reads it as it is.
- **[React Router](apps/react-router-example/README.md)**: React Router 7 on Cloudflare's own template (`workers/app.ts`, the Vite plugin, a loader and an action over KV) as a desktop app with no edits: the second framework on the shared sample-app journey
- **[Next.js](apps/nextjs-example/README.md)**: A Next.js 16 app on `@opennextjs/cloudflare` (one KV binding) as a desktop app with no edits: `init` reads it and the host runs the `worker.js` OpenNext built; the same shared HTTP journey checks it
- **[Svelte SPA](apps/svelte-spa-example/README.md)**: A client-only Svelte 5 + Vite app (no server) as a desktop app, its counter in a `"use server"` action the host runs.
- **[Vue SPA](apps/vue-spa-example/README.md)**: A client-only Vue 3 + Vite app (no server) as a desktop app, its counter in a `"use server"` action the host runs.
- **[Solid SPA](apps/solid-spa-example/README.md)**: A client-only Solid + Vite app (no server) as a desktop app, its counter in a `"use server"` action the host runs.
- **[Hono](apps/hono-example/README.md)**: A Hono Worker from Hono's own docs (one KV binding) as a desktop app with no edits: the sample app contract every framework example meets, checked by one shared HTTP journey
- **[Elysia RealWorld](apps/elysia-conduit/RUSTYBUNS.md)**: bedstack's RealWorld backend (Elysia, Drizzle, postgres.js) with no source edits: a desktop binary on PGlite that passes their Postman suite, and the five ways it breaks on Workers
- **[TanStack Start](apps/tanstack-start-example/README.md)**: TanStack Start on Cloudflare's Vite plugin (server functions, a server route, D1 and KV) as a desktop app, its code unchanged
- **[Hello World](apps/hello-world/README.md)**: The first five minutes: a twenty-line page that the welcome tour digs up, lets three agents rewrite at once, then asks why not deploy it
- **[Agent Demo](apps/agent-demo/README.md)**: A small snack-vote Worker seeded into codeSplitter, so several coding agents can build it at once and settle a merge conflict on camera
- **[Borg Postgres](apps/borg-postgres/README.md)**: A Postgres app keeps its database and moves its code: Hyperdrive on the edge, PGlite on the desktop.
- **[Borg](apps/borg/README.md)**: Not an app: a small Worker that uses every binding once, so one suite can check the local twins against a real deploy
- **[SPA fixture](apps/spa-example/README.md)**: Not an app: a slice of a real RWSDK game that the tests use to check `init` reads it right
- **[Worker example](apps/example/README.md)**: A whole Worker (D1, KV, a Durable Object) as a desktop binary in half a second, plus a Rust FFI probe with a TypeScript fallback

</details>

<!-- /apps -->

**Say hi:** I'm Ryan Quinn, [QuinnsCode](https://github.com/QuinnsCode) on GitHub. Bugs, ideas and "this broke on my machine" all go in [issues](https://github.com/QuinnsCode/RustyBuns/issues).

**Someone else's app, unchanged:** [TerraViz](https://github.com/zyra-project/terraviz) by The Zyra Project, led by Eric Hackathorn (NOAA Global Systems Laboratory), Apache-2.0: a Pages app with a 3D globe, about 100 API routes, D1, KV, R2 and Vectorize. `bun apps/terraviz-demo/run.ts` clones it and runs it on Rusty Buns with none of its code changed. This is only a demonstration of how Rusty Buns maps an existing app onto its primitives. It is not a fork, and TerraViz's code is not in this repo. Credit, license and how to run it: [apps/terraviz-demo](apps/terraviz-demo/README.md).

**Try one without building anything:** download the desktop binary for [Hippo Tycoon](https://github.com/QuinnsCode/RustyBuns/releases?q=hippo-tycoon-v&expanded=true), [Park Hide & Seek](https://github.com/QuinnsCode/RustyBuns/releases?q=park-hide-seek-v&expanded=true), [Super Spy Splat Shot](https://github.com/QuinnsCode/RustyBuns/releases?q=splat-spray-v&expanded=true) or [FM Groovebox](https://github.com/QuinnsCode/RustyBuns/releases?q=fm-daw-v&expanded=true). Each is one file for Mac, Windows or Linux. They aren't signed yet, so the first launch takes one Terminal command on a Mac (the release page has it; [APPLE_SIGNING.md](APPLE_SIGNING.md) is the road to fixing that) and a click past SmartScreen on Windows ([WINDOWS_LINUX_SIGNING.md](WINDOWS_LINUX_SIGNING.md) is that road, and says Linux needs no key).

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
- [MAC_SETUP.md](MAC_SETUP.md): a Mac from scratch to running the office and agents, and a second Mac as their test machine
- [AGENT_PROMPTS.md](AGENT_PROMPTS.md): prompts to paste into your coding agent to try it on your repo
- [REFERENCE.md](REFERENCE.md): every command, config key, the host, the Hetzner and Railway boxes, LAN multiplayer, who holds the keys to secrets
- [ADOPTION.md](ADOPTION.md): who it's for, and how to adopt it (and leave)
- [ACCESSIBILITY.md](ACCESSIBILITY.md): what's accessible today, the reading settings, and how to report a barrier
- [COSTS.md](COSTS.md): what each deploy can bill you for, and how to cap it
- [FRAMEWORKS.md](FRAMEWORKS.md): beyond Vite + React
- [FRAMEWORK_COVERAGE.md](FRAMEWORK_COVERAGE.md): how many real GitHub apps per framework run unchanged
- [notes/ROADMAP.md](notes/ROADMAP.md): the resource matrix and the build order for what's built and what isn't

## License

Apache-2.0. See [LICENSING.md](LICENSING.md).
