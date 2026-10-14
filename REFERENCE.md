# Reference

The details behind the [README](README.md): every command, every config key, how the host behaves, the Hetzner and Railway boxes, and LAN multiplayer. The step-by-step walkthrough is [GETTING_STARTED.md](GETTING_STARTED.md).

## Typed deploys, thanks to Effect

The deploy side is built on Alchemy, which is built on [Effect](https://effect.website). Your `rustybuns.config.ts` is typed, the generated stack is typed, and every provider (Cloudflare, Hetzner, Railway, soon Fly) is a typed Layer. Swap a target by changing one line of config, and every command checks the config when it loads it (an Effect Schema, so `bindings.DB.databaseName: missing` instead of a failure halfway into a deploy) before anything is created. `plan` type checks the generated stack first, then shows the diff, and `deploy` refuses to run without a plan for that exact config. You get infrastructure-as-code that feels like writing a function, and you never have to write the Effect yourself unless you want to (`rustybuns eject` hands you the program).

## Type checking and per-step timing

`plan` and `deploy` type check the generated stack before Alchemy runs (`--no-check` skips). `build desktop --check` type checks your app before the client build, so a type error costs well under a second instead of a full build. The checker is picked automatically: [`bun check`](https://bun.com/docs/runtime/check) on Bun 1.4.3 or newer (not in a stable release yet: `bun upgrade --canary`), else [tsc-rs](https://github.com/pingdotgg/ts-rust), else `tsc`. tsc-rs goes first when the tsconfig enables `@effect/language-service`, because only tsc-rs runs Effect's diagnostics (a stack step written without `yield*` silently never runs; tsc-rs flags it as TS377001). `--checker bun|tsc-rs|tsc` picks one yourself.

Type errors print one line each, starting with `file(line,col)`. Each line is cut to 300 characters and at most 20 are shown, followed by a count of the rest, so a deep generic (an Effect, a query builder) can't fill a screen or an agent's context. `bun run typecheck --full` prints everything.

`build desktop`, `plan` and `deploy` print how long each step took and save it to `.rustybuns/profile/`. The next run shows the change per step, so you can see what a checker or Bun upgrade actually saved. An illustration of the shape (the numbers are what `bun check` is expected to give, not a measured run):

```
profile: build desktop  (bun 1.4.3)
  boundary glue             2ms    0%  =
  typecheck app            56ms    7%  -1.03s (19.4x faster)  [bun]
  client build            652ms   76%  +16ms
  compile darwin-arm64    138ms   16%  +14ms
  total                   858ms  -1.00s (2.2x faster)
```


## A full-stack framework, by accident

We set out to wrap apps, and ended up with the pieces of a full-stack framework anyway:

| A framework gives you | Rusty Buns gives you |
|---|---|
| a server runtime | the Bun host (`Bun.serve`, WebSockets, hibernating DO-style objects) |
| a database and migrations | D1-shaped sqlite with migrations applied at boot |
| KV, blob storage, secrets | KV on sqlite, R2-shaped directories, secrets by name |
| server actions / RPC | `"use server"` functions run for real against sqlite (`/__rb/action`) |
| build and bundling | Vite in, one binary out |
| deploy and infrastructure | a typed Alchemy + Effect stack, plan before deploy |
| native code escape hatch | Rust cdylibs over `bun:ffi`, with a TypeScript fallback |

The difference is that we don't ask you to adopt any of it. It's the shape Cloudflare already standardized (`fetch`, Durable Objects, D1, KV, R2), so leaving is a `git rm`, not a rewrite. Who it's for is in [ADOPTION.md](ADOPTION.md).

## How it works

```
                    rustybuns.config.ts
          (inferred by `init`, then yours to edit)
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
    desktop              edge                  box
  ───────────        ─────────────        ──────────────
  Bun host           Alchemy stack        Bun host + Alchemy stack
  127.0.0.1 + token  Cloudflare.Worker    Hetzner.Server + Volume
  sqlite in ~/.app   D1, KV, R2, DOs      sqlite on the Volume
  one binary         your vite build      one binary under systemd
```

The desktop and box hosts are the same generated program. The desktop build binds to localhost, gates every request on a per-launch token and opens a browser. The box build listens on `0.0.0.0`, skips the token, serves `/health`, and keeps its data on an attached volume.

## Where things run

| Need | Cloudflare | Hetzner | Railway | Desktop |
|---|---|---|---|---|
| http | Worker | Bun `serve()` | Bun `serve()` on `oven/bun` | Bun `serve()` |
| WebSocket state | Durable Object | in-process DO | in-process DO | in-process DO |
| SQL | D1 | sqlite on a Volume | sqlite on a Volume | sqlite |
| Postgres | Hyperdrive in front of your Postgres | the Postgres URL itself | the Postgres URL itself | the Postgres URL itself, or PGlite in the data dir with `local: "pglite"` |
| KV | KV | sqlite table | sqlite table | sqlite table |
| blob | R2 | directory on a Volume | directory on a Volume | embedded directory |
| git repos | Artifacts | untested | untested | bare repos over git HTTP (worker mode; needs `git`) |
| image transforms | Images | passthrough | passthrough | passthrough: the original image, `info()` from its header (worker mode) |
| outbound email | Email Sending (`cloudflare:email`) | not sent: an `.eml` file in the data dir | not sent: an `.eml` file in the data dir | not sent: an `.eml` file in the data dir |
| secrets | Worker secrets | env file on the server | service variables | n/a |
| native (FFI, `SharedArrayBuffer`) | no | yes | yes (crates built in the image) | yes |


## Deploy to Hetzner


Add a `box` target:

```ts
// rustybuns.config.ts
targets: {
  edge: { provider: "cloudflare" },   // drop this line for a Hetzner-only stack
  box: { provider: "hetzner" },
}
```

Then give Alchemy a Hetzner Cloud API token (Console → Security → API tokens, read & write):

```sh
pnpm exec rustybuns login hetzner     # or: export HCLOUD_TOKEN=...
pnpm exec rustybuns plan
pnpm exec rustybuns deploy     # prints  box: http://<ipv4>:3000
```

`plan` and `deploy` run `rustybuns build box` first, which compiles the same host the desktop uses for Linux into `.rustybuns/box/`. Then `deploy`:

1. creates a server (`cpx12` in `nbg1` on Ubuntu 24.04 by default) and a 10 GB ext4 volume
2. copies the binary and a small Node launcher over SSH, using a deploy key Alchemy generates
3. installs a systemd unit and waits for `GET /health` to answer

The launcher exists because Alchemy's `Hetzner.Service` always starts `node <main>`. It finds the mounted volume, sets `DATA_DIR`, and execs the Bun binary next to it, passing signals through.

| `targets.box` key | Default | Notes |
|---|---|---|
| `location` | `nbg1` | `fsn1`, `hel1`, `ash`, `hil`, `sin`. Changing it replaces the server. |
| `serverType` | `cpx12` | `cax*` types are ARM, and the binary is built for `linux-arm64` to match. Changing it replaces the server. |
| `image` | `ubuntu-24.04` | |
| `port` | `3000` | |
| `volumeSize` | `10` | GB, minimum 10. `0` keeps data on the server's own disk in `/var/lib/<name>`. |
| `memMaxMb` | none | RSS ceiling in MB: above it the box saves a CPU profile and a heap snapshot, then restarts. `RB_MEM_MAX_MB` overrides. See `/__rb/mem` below. |
| `persona` | `balanced` | The budget the box's crons and queue batches share: `balanced`, `power-user`, `background-beatdown` or `background-burner` (a build box). `RB_PERSONA` overrides. |
| `webmcp` | `false` | Triage tools for an agent in the browser, over WebMCP: `mem_stats`, and `take_cpu_profile` and `mem_history` with `RB_PROF_SECRET`. See below. |

Current limits on the box:

- **Plain HTTP on the port.** No TLS or domain yet. Put Cloudflare in front, or wait for the load balancer and certificate support on the roadmap.
- **A box plays like the edge, not like the desktop.** There's no local player: each WebSocket at `worldPath` is a guest with its own id (`?uid=&name=` when the client sends them, trust on first use as on the LAN, otherwise a fresh id per connection), and `?room=CODE` picks that room's world, as the edge Worker routes it (codes are 1-32 of `[A-Za-z0-9_-]`, at most 200 rooms per box; no `room` is one shared world). `/__rb/info` and `POST /__rb/host` answer 404, so pages take their online path, and nobody on the internet can close the world or rebind the server. There's no real login: put the box behind your own auth if identity matters.
- **`/health` says where data lives.** Its `X-RB-Data` header is `volume` when the data dir is its own filesystem (an attached Volume) and `container` when a redeploy would throw it away. `X-RB-Boots` counts the starts recorded in the data dir, so it only grows across a redeploy when the data survived it.
- **`/__rb/mem` says how memory is going.** The box samples RSS and the JS heap every 5 minutes and logs a `[mem]` line; `/__rb/mem` returns the latest, the peak, and a least-squares slope over the last hour (`slopeMbPerHour`), so a slow leak shows up as a steady positive number long before it hurts. Set `targets.box.memMaxMb` (or the `RB_MEM_MAX_MB` variable) and, once RSS passes it, the box writes a V8 heap snapshot to `<data>/heap/` and exits 1, so Railway or systemd restarts it before the OOM killer does; `hoursToMax` is the time left at the current slope. Open the snapshot in Chrome DevTools > Memory, or compare two of them to see what grew. Before that snapshot it samples 5 seconds of CPU into `<data>/prof/ceiling-*.cpuprofile`. `rustybuns mem [--json]` prints the numbers from your machine. Desktop hosts watch themselves the same way: `/__rb/mem` answers the local player (not guests), and only `RB_MEM_MAX_MB` sets a ceiling there; they don't take the ceiling profile or serve `/__rb/prof`.
- **`rustybuns prof` takes a CPU flame graph from the running box.** Give the box a secret of 16 characters or more, for the box alone:

  ```ts
  bindings: { RB_PROF_SECRET: { type: "secret", boxOnly: true } }   // add op: "op://…" under experimental.wheel
  ```

  Deploy, then `rustybuns prof [--seconds 10]` finds the box's URL in the Alchemy state (`--url` to name another), sends the secret from the shell, `.dev.vars` or 1Password, and saves a `.cpuprofile` in `.rustybuns/prof/`. Open it in Chrome DevTools > Performance or drop it on speedscope.app. Under it is `POST /__rb/prof?s=10` with `Authorization: Bearer <secret>`: it samples for that many seconds (at most 60, one profile at a time), answers with the profile and keeps it in `<data>/prof/` too (the newest 10). Without the secret the route doesn't exist and the path goes to your app, since anyone who can start profiles can keep the box busy. A Hetzner box is plain HTTP, so there the secret crosses the network unencrypted. `boxOnly` keeps any secret off the edge Worker. It also prints the profile's hottest functions by self and total time, with the stack under each (`--top N`), and `--json` prints that as JSON with the file's path, for an agent. Locally, `bun --cpu-prof` still works and writes the profile on exit.
- **`rustybuns history` compares runs.** The box keeps `<data>/history.jsonl`: a line at each start (with `RB_VERSION` and, on Railway, the commit), every memory sample, each profile's top frames, and going over the ceiling. `rustybuns history [--runs 5] [--json]` groups it by start, newest first: each run's RSS from start to end with its MB/h slope, the profiles taken in it and whether it hit the ceiling, so "did that deploy start the leak?" is one command. It reads `GET /__rb/history`, behind the same `RB_PROF_SECRET`; the file keeps the newest 5000 lines (17 days of samples).
- **`targets.box.webmcp: true` puts the same tools in the browser.** The box adds a script tag to every HTML page it serves, and the script (`/__rb/webmcp.js`) registers `mem_stats`, `take_cpu_profile` and `mem_history` with `navigator.modelContext`, so an agent in Claude in Chrome or the desktop app's browser, on the box's page, can triage it as it does the Agent Office page. Browsers without WebMCP ignore it. `mem_stats` reads `/__rb/mem`, which is public anyway. The other two need `RB_PROF_SECRET`, and the box has no login to ride on, so you hand the page the secret once by opening it with `#rb_prof=<secret>` on the URL: the script keeps it in this tab's sessionStorage and takes it off the URL, and the agent never sees it. Without it, or on a box with no secret set, those tools say so. Off by default, since it changes your pages.
- **`rustybuns triage` hands a problem to your coding agent.** It writes this project's facts (versions, the config's targets, the box's `/health` and `/__rb/mem`, whether `RB_PROF_SECRET` is set, the installed `@rustybuns/*` packages, the paths) to `.rustybuns/triage/<time>/context.md`, beside a playbook, and starts `claude` or `codex` on them (`--agent` to pick, `--model` to pass one on, `--print` for just the files). The agent asks what went wrong, reads the installed source, checks for an existing issue and drafts one labelled `via-triage`, which it posts only after you say yes. The playbook is [`packages/cli/src/triage/PLAYBOOK.md`](packages/cli/src/triage/PLAYBOOK.md), and the agent follows the copy on `main` when it's newer. After t3code's `t3 triage`.
- **Secrets are plaintext at rest.** They go into `/opt/<unit>/env` on the server and into Alchemy's local state (`.alchemy/state`, see `state` under Config). Don't keep `HCLOUD_TOKEN` in `.dev.vars`, or `init` will treat it as an app secret.
- **Rust crates build in Docker off Linux.** cdylibs don't cross-compile, so when `native/` has crates and the box's arch isn't this machine, `build box` builds them in `rust:<your rustc>-slim-bookworm` for `linux/amd64` (or `linux/arm64` on `cax`) into `native/dist/<crate>/linux-<arch>/` and embeds them as usual. Bookworm's glibc (2.36) is older than Ubuntu 24.04's (2.39), so the library loads on the server. Start Docker first; without it the build says so. On Linux of the same arch, nothing changes. The same goes for `build desktop` with Linux targets. Other cross targets (macOS, Windows) are refused only when a crate would be embedded: one named in `desktop.native`, or one already built into `native/dist`. A crate that only builds to wasm says so in its own `Cargo.toml`:

  ```toml
  [package.metadata.rustybuns]
  desktop = false
  ```

  The Docker build, the staging, the cross check and the box image all skip it, so an app whose crates all opt out cross-compiles like pure TS without Docker (hippo-tycoon's `native/` works this way). `desktop.native: false` still keeps all of `native/` out of the binary (and the box image) from the app config.

## Deploy to Railway

Same box, different provider:

```ts
targets: {
  edge: { provider: "cloudflare" },   // drop this line for a Railway-only stack
  box: { provider: "railway" },
}
```

```sh
pnpm exec rustybuns login railway     # browser login or a pasted account token; or: export RAILWAY_API_TOKEN=...
pnpm exec rustybuns plan
pnpm exec rustybuns deploy     # prints  box: https://<service>.up.railway.app
```

Railway's upload is a Docker context capped at 32 MiB, and a compiled Bun binary is about 35 MB gzipped before your app is in it. So the Railway box isn't a binary: `rustybuns build box` bundles the same host without `--compile` into `.rustybuns/railway/`, copies the directories a binary would embed (client build, migrations, mounts) next to it, and writes a Dockerfile on `oven/bun` at the version that built it. A typical app comes to well under a megabyte; `build box` stops early, naming the biggest parts, if the context would pass 32 MiB. Then `deploy` creates a Project, a Service with a `*.up.railway.app` domain and a `/health` check, and a Volume at `/data` for sqlite.

| `targets.box` key | Default | Notes |
|---|---|---|
| `region` | Railway's | `us-west2`, `us-east4`, `europe-west4`, `asia-southeast1` |
| `port` | `3000` | |
| `volume` | `true` | `false` keeps data in the container, lost on every redeploy |
| `memMaxMb` | none | RSS ceiling in MB: above it the box saves a CPU profile and a heap snapshot, then restarts. `RB_MEM_MAX_MB` overrides. See `/__rb/mem` below. |
| `persona` | `balanced` | The budget the box's crons and queue batches share: `balanced`, `power-user`, `background-beatdown` or `background-burner` (a build box). `RB_PERSONA` overrides. |
| `webmcp` | `false` | Triage tools for an agent in the browser, over WebMCP: `mem_stats`, and `take_cpu_profile` and `mem_history` with `RB_PROF_SECRET`. See below. |
| `sleep` | `true` | sleeps when idle, so a quiet box costs close to nothing; the first request wakes it, and in-memory world state starts fresh (sqlite doesn't) |

HTTPS comes with the Railway domain. Identity works the same as on Hetzner.

Rust crates ride along as source. When `native/Cargo.toml` exists, the Dockerfile gets a first stage on the same `oven/bun` image (so the same glibc as the runtime) that installs your local `rustc` version with rustup, builds the workspace, and copies each crate in `desktop.native` (all of `native/crates` when unset, minus crates with `desktop = false`) to `native/dist/<crate>/linux-<arch>/`, where `loadNative()` looks. A crate that needs system libraries beyond `build-essential` and `pkg-config` will fail that stage.

`login railway` takes `oauth` (a browser login) or `stored` with a pasted **account** token (railway.com → Account Settings → Tokens, with no workspace picked; a project token can't create projects). Press Enter at the API URL prompt. Set a hard usage limit in the Railway workspace before the first deploy ([COSTS.md](COSTS.md)).

To try it locally, run the bundle from its own folder the way the image does:

```sh
pnpm exec rustybuns build box
cd .rustybuns/railway && PORT=3000 DATA_DIR=/tmp/box bun box.js
curl -i localhost:3000/health     # on Railway, X-RB-Data: volume means /data is the Volume
```

## Commands

| Command | What it does |
|---|---|
| `init` | infer the app; write `rustybuns.config.ts`, `.rustybuns/alchemy.run.ts`, `wrangler.jsonc` |
| `add desktop [--entry file#Component]` | scaffold `packages/desktop/` and `vite.desktop.config.ts`; keeps files you already have |
| `add deploy [--dry-run]` | install the pinned Alchemy + Effect set and package manager overrides |
| `boundary` | classify `src/` as client / action / server / leak; regenerate stubs and proxies |
| `infra [--stage s] [--json]` | the stack as a graph, from the config alone (no login): the Worker and each binding, `[KEPT]` where `protect: true` leaves it through destroy. `--json` is what codeSplitter's Ship pop-out draws |
| `generate` / `adopt` | regenerate `.rustybuns/`; `adopt` accepts the generated `wrangler.jsonc` over a hand-written one |
| `build desktop [--dev] [--target os-arch]` | `--dev` bundles without compiling, for `run desktop` |
| `run desktop` | start the dev host |
| `build box [--target os-arch]` | Hetzner: Linux binary + Node launcher in `.rustybuns/box/` (`--target` your own OS to try it locally). Railway: Bun bundle + Dockerfile in `.rustybuns/railway/` |
| `login <cloudflare\|hetzner\|railway>` | connect a provider account to your Alchemy profile (`~/.alchemy`, shared by every app), through this project's pinned Alchemy |
| `plan` / `deploy [--yes]` / `destroy` | Alchemy against the generated stack; `deploy` refuses without a plan for this exact config |
| `dev` | `alchemy dev`: workerd and local simulators for the edge |
| `prof [--seconds N] [--url U]` | sample the deployed box's CPU and save a `.cpuprofile` (a flame graph) in `.rustybuns/prof/`; needs `RB_PROF_SECRET`, see [the box limits](#deploy-to-hetzner) |
| `eject` | copy `alchemy.run.ts` to the project root; from then on you own it |
| `version` | print the version, and say whether it is a known-bad release or out of date |

`--profile <name>` and `--stage <name>` pass through to Alchemy; `--stage` also picks the config's `stages` entry. `RB_NO_BROWSER=1` prints the desktop token URL instead of opening a browser.

Stopping `plan`, `deploy` or `destroy` partway (Ctrl-C, a `kill`, an agent's timeout, a closed terminal) asks Alchemy to stop the way Ctrl-C does, waits up to 10 seconds (`RUSTYBUNS_STOP_GRACE_MS`) for it to finish what it's writing, then frees the state lock. If rustybuns is killed outright (`kill -9`), the lock stays held until that Alchemy exits, so a second deploy can't run against the same state beside it.

### Known-bad versions

[`advisories.json`](advisories.json) lists releases to move off, and which way to go (`upgrade`, or `downgrade` to a given version). Each command checks the installed version against it and against npm's latest at most once a day (cached in `~/.cache/rustybuns/`, 1.5 s timeout). On a listed version it prints how to move before running. It never fails a command, and it is off in CI and with `RUSTYBUNS_NO_UPDATE_CHECK=1`. To flag a release, add an entry, merge it, then run `bun run deprecate:bad` (needs your npm login) so installs warn too.

A built desktop app checks too: `build desktop` stamps the RustyBuns version into it, and at launch the host checks that version the same way (once a day, never blocking the start). A dev host (`run desktop`, `build desktop --dev`) prints how to rebuild; a release binary or box logs one `[rustybuns]` line, so the app's users never get a notice they can't act on. Same off switches.

An app can list its own bad releases the same way. Point `targets.desktop.advisories` at a JSON file you host (a raw GitHub URL works):

```json
{ "latest": "1.4.0", "download": "https://example.com/app",
  "advisories": [{ "versions": "1.3.0", "do": "upgrade", "to": "latest", "why": "saves are lost on quit", "issue": "https://example.com/bug/7" }] }
```

At launch the host checks the app's `package.json` version against it, with the same range rules and daily cache. That notice is for the app's users, so release builds show it too: one `[<app>]` log line, and on the desktop `/__rb/info` returns it as `update` (null when there is nothing to say) for the page to show. `to: "latest"` means the file's `latest`. Same off switches.

## Config

`rustybuns.config.ts` is the one file you own. `init` writes it, and every generated file comes from it. Every command checks it on load and lists each problem as one line naming the field: a missing key, a typo'd binding type or key, a value out of the range the docs below give.

`worker` is only needed for the Cloudflare deploy. Leave it out for a desktop-only or box-only app.

```ts
import { defineConfig } from "@rustybuns/cli/config";

export default defineConfig({
  name: "my-app",
  worker: {
    main: "src/worker.tsx",
    builtMain: "dist/worker/index.js",
    assets: "dist/client",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    build: "vite build",
  },
  bindings: {
    DB: { type: "d1", databaseName: "my-app", migrationsDir: "migrations" },
    CACHE: { type: "kv" },
    UPLOADS: { type: "r2", bucketName: "my-app-uploads" },
    WORLD: { type: "durable_object", className: "World" },
    SESSION_SECRET: { type: "secret" },
  },
  targets: {
    edge: { provider: "cloudflare" },
    box: { provider: "hetzner", location: "fsn1" },
    desktop: { mode: "spa", world: "packages/desktop/world.ts", targets: ["darwin-arm64", "linux-x64"] },
  },
});
```

| Key | Values |
|---|---|
| `source` | `dir`, `aliases`, `ignore` (inferred from tsconfig paths) |
| `bindings` | `d1` (+ `migrationsDir`), `kv`, `r2`, `durable_object`, `artifacts` (+ `namespace`), `images`, `send_email` (+ `allowedSenderAddresses`; off the edge each `send()` is written to `email/<binding>/*.eml` in the data dir, and `cloudflare:email`'s `EmailMessage` is shimmed), `queue` (+ `queueName`, `consumer`: the Worker's `queue()` gets its batches; a sqlite queue in the host process off the edge, each batch a low job on the host's scheduler unless `consumer.priority` says otherwise; `consumer.deadLetterQueue` names another queue binding that gets messages past `maxRetries`, there and on the edge; `producer: false` for a queue the Worker only consumes), `workflow` (+ `className`, `scriptName`; off the edge the class runs in the host process, instances and step results in `workflows.sqlite`), `vectorize` (+ `indexName`, `dimensions`, `metric`; a sqlite index queried by exact scan off the edge), `ai` (off the edge every call throws: there's no model), `analytics_engine` (+ `dataset`; points go to `analytics.sqlite` off the edge), `worker_loader` (off the edge its code runs in the host process, not a sandbox), `hyperdrive` (+ `urlSecret`, the `secret` holding the `postgres://` URL, `configName`, `caching`: `env.NAME.connectionString` goes through Hyperdrive on the edge and is the URL itself off it; or `origin: { neon: { project, branch, region, pgVersion, apiKeyOp } }`, a Neon project and branch the stack makes with `NEON_API_KEY`, whose URL the desktop reads from `NAME_URL` (or `urlSecret`) and a box in the stack is handed; `local: "pglite"` (+ `migrationsDir`) serves PGlite on 127.0.0.1 when the URL is unset, with `@electric-sql/pglite` and `@electric-sql/pglite-socket` in the app's dependencies. It is one Postgres session shared by every connection; each connection's prepared statements (protocol-level or SQL `PREPARE`) are kept apart, so `pg`, `postgres` and `Bun.SQL` pools run with their defaults, as on the edge; `COPY ... FROM STDIN` works as a query of its own; `DISCARD ALL` drops only the connection's own prepared statements, and `DISCARD TEMP` is refused, since temp tables are shared), `var`, `secret` (+ `op`, `optional`, `boxOnly`) |
| `state` | `shared` (default) \| `project`, see below |
| `experimental` | `wheel` (`agent` \| `human`), see below |
| `targets.edge` | `provider: "cloudflare"`, `domain` (a hostname, or a list of them), `routes` (`pattern`, `zoneName`, `zoneId`), `adopt`, `workerName`, `accountId` (the account to deploy to; an exported `CLOUDFLARE_ACCOUNT_ID` naming another is refused), `workersDev`, `previewUrls` |
| `stages` | per Alchemy stage, what `--stage <name>` changes: `workerName`, `accountId`, `domain`, `routes`, `workersDev`, `previewUrls`, `crons` (each replaces the config's; `[]` clears a list), and `bindings`, merged by key (`{ databaseName }`, `{ value }` for a var) or added whole with a `type`. A stage with no entry deploys the config as written; local dev's wrangler.jsonc always follows the config as written. `init` writes one per wrangler `env.<name>` block |
| `targets.box` | `provider: "hetzner"`, `location`, `serverType`, `image`, `port`, `volumeSize`, `memMaxMb`, `persona`; or `provider: "railway"`, `region`, `port`, `volume`, `sleep`, `memMaxMb`, `persona` |
| `targets.desktop` | `mode` (`spa` \| `worker`), `clientBuild`, `clientDir`, `world` (or `false`), `worldPath`, `identity`, `listen` (`hostname`, `port`), `guests` (`join`, `max`, `version`), `host`, `server` (`entry`, `paths`, `port`, `env`), `headers`, `native`, `actions` (`include` / `exclude`), `mounts`, `r2`, `storageCodec` (`json` \| `v8`), `targets` (list or `"all"`), `window` (`app` \| `tab`), `dataDir`, `define`, `workers` (worker-thread modules the host starts, shipped in the binary), `warm` (finished workers the host's scheduler keeps loaded, default 0; `RB_WARM` overrides) |

**`targets.edge.adopt`** names the Worker, D1 databases and R2 buckets exactly as the config does (`name`, `databaseName`, `bucketName`) and takes over ones that already exist under those names, instead of making new ones beside them. Turn it on for an app first deployed with wrangler, or one whose Alchemy state was lost. Without it Alchemy picks its own `<app>-<id>-<stage>-<random>` names. Leave it off for a stack Alchemy already deployed: its names would change, so those resources would be replaced. On a fresh state, `plan` lists the Worker as a create even with `adopt`, because its bindings aren't known until deploy. It is still uploaded under the config's name, over the existing Worker.

**Ephemeral or real, said first.** Every `plan`, `deploy` and `destroy` opens with `environment: EPHEMERAL` or `environment: REAL`, and why, before costs or anything else. EPHEMERAL: made new with names Alchemy picks, nothing already on the account is touched, `destroy --stage <it>` removes it all (previews, trials, an agent's stage). REAL: may hold customer data, because the stage is named `prod`, `production`, `live`, `main` or `master`, `adopt` is on, or a binding has `protect: true`. The report under it lists each data resource as `[KEPT]` (`protect: true`) or `[REMOVED]` (destroy deletes it, and its data); set `protect: true` on whatever must survive and deploy once. Agents and scripts say which they mean: `--ephemeral` (FRESH, and refused on a REAL environment) or `--real` (answers yes to the ADOPT questions, and to destroying a prod-named stage that deletes data; without a terminal or the flag that destroy is refused). codeSplitter's Ship panel has the same switch under Stage, as Ephemeral and Real, and its map and deploy tab show the same EPHEMERAL/REAL badge and the kept/removed count.

**Fresh or adopt, said every time.** `plan`, `deploy` and `destroy` print `mode: FRESH` or `mode: ADOPT` before they start and again at the end. FRESH means every resource is new and none already on the account is looked up, changed or deleted. ADOPT lists each Worker, D1, R2, queue and Vectorize name it would take over, which may be real ones. `--fresh` forces FRESH whatever `adopt` says, so a stack with real names in its config can still be tried on a fresh set. In ADOPT mode a first deploy to a stage, and any `destroy`, stop and ask at the terminal: "are you sure?" (y/N) with every resource listed, then again for the Worker's name typed out. A no, a wrong name, or no terminal at all refuses it; `--adopt-existing` answers yes for scripts. Changing only `workerName` doesn't help: the databases, buckets and queues keep their names.

**Keep a resource through destroy.** `protect: true` on a `d1`, `kv`, `r2`, `queue`, `vectorize` or `hyperdrive` binding makes `destroy` leave it, and its data, on the account: the stack stops tracking it and never calls Cloudflare's delete. `plan`, `deploy` and `destroy` print a block first, `[KEPT]` for each protected resource and `[REMOVED]` for each one that goes, so the answer to "will this wipe my vector index?" is on screen. In ADOPT mode the destroy question lists what it deletes and what it keeps. Protection is saved with the resource, so turn `protect` on and deploy once before the first destroy. The kept resource is not tracked afterwards: a later deploy of the same stack makes a new one, or takes it over by name with `adopt`. A stage can set it too (`stages: { dev: { bindings: { INDEX: { protect: false } } } }`), so a throwaway stage can still delete its own copy.

**`state`** is where Alchemy keeps what it deployed. `"shared"` (the default) makes `.alchemy/state` a symlink to `<repo>/.git/rustybuns/alchemy/<app path>/state`, so the main checkout and every git worktree of the repo share one state per app, and removing a worktree doesn't lose it. A state dir already in the app moves there on the next `plan`, `deploy`, `destroy` or `dev`, unless the shared one has state too, in which case it stops and asks you to keep one. Only one of those commands runs against the shared state at a time; a second one stops with the pid and directory of the first. Two worktrees on different branches still deploy to the same stage, one after the other. `"project"` keeps the state in the app's own `.alchemy/state`, as before. Outside git it always stays there.

Four desktop keys are for apps that aren't Workers apps at all, like [tscircuit-desktop](apps/tscircuit-desktop/README.md):

- **`host`** is a module whose default export is `{ fetch(req, ctx) }`. It's your backend routes (files, native calls, exports) without pretending to be a Worker. Return `null` to fall through.
- **`server`** runs the app's own Node server beside the host, for a Vite frontend whose dev server proxies `/api` to it: `server: { entry: "../api/server.js", paths: ["/api"] }`, or a list of them when the proxy sends paths to more than one server (the first whose paths match gets the request). The build bundles `entry` and its `node_modules` into the binary. The host starts it as a child process (the binary itself, run as Bun, so the machine needs no Node), with `PORT` set to a free port (or `port`, for a server that ignores `PORT`), `DATA_DIR` set to the host's data dir, and `env` on top. Requests to `paths` (`server.proxy` keys: `/api` is a prefix, `^/ws/.*` a regex) go to it once the token lets them in, after `host`'s routes, and so do WebSocket upgrades on them, subprotocol and close codes intact. If the host is killed outright (SIGKILL), the server notices within a second and exits too. A native addon (`.node`) its dependencies require by a fixed path (`require("./build/Release/x.node")`) ships beside the bundle and is copied out with it, as long as it's built for every target (the build reads each one's header and names the targets it won't load on, so build those on their own OS). One a package finds at run time through `bindings` (`better-sqlite3`) or `node-gyp-build` (`bcrypt`) is carried too: the build swaps those for static requires of the file they'd find. For `node-gyp-build` that's one file per target, the package's own build or its `prebuilds/<os>-<arch>/` one, so one machine builds every target, and a target with neither is named. A `bindings` package installed by `prebuild-install` (`sqlite3`, `better-sqlite3` up to 12) gets each target's file from its release, at the URL `prebuild-install` uses, for Bun's ABI (or N-API, for `-r napi`): the installed file was built for the Node that ran the install, which Bun won't load. A `npm_config_<name>_binary_host_mirror` mirror is used when set. `better-sqlite3` 13 ships every target's in `prebuilds/<os>-<arch>.node`, and its loader gets a static require per target. `sharp` loads `@img/sharp-<os>-<arch>`, which links `@img/sharp-libvips-<os>-<arch>`'s library by a relative path, so both go in a `server-<i>-native/@img/` tree beside the bundle (the server is bundled once per target, so each binary carries only its own OS's addons and libvips); a target npm didn't install is fetched from the registry (`npm_config_registry`) at the version `sharp` pins. Fetched files are cached in `node_modules/.cache/rustybuns/addons`. One found any other way (a path the package joins) can't be carried, and the build stops naming the package: swap in a pure-JS one (`bun:sqlite`, `bcryptjs`) or port its routes to `host`. Desktop and box only, since a Worker can't run a Node server; `plan` says so. `init` writes this key from the dev proxy: it groups the proxy's keys by the port they target, and gives each group the server folder that listens there, beside the app (`../api`, written as `entry: "../api/server.js"`) or inside it (`./api`, `entry: "api/server.js"`; not `src`, `public`, `dist` or other source, asset and build folders), (from its entry file: `process.env.PORT || 3001`, `listen(8888)`), or the one server there is when the proxy has one target. It needs to find the file each folder's `start` script (or `main`) runs. A server that never reads `PORT` gets `port` set to the one it keeps.
- **`headers`** overrides response headers. The default is full cross-origin isolation for `SharedArrayBuffer`. Apps that load CDN assets without CORP headers want `{ "Cross-Origin-Embedder-Policy": "credentialless" }`.
- **`native`** names the Rust crates from `native/dist/` to embed. Leave it out to embed every built crate. Naming one that was never built is an error.

The box host reads the same keys, so `host` routes, `server` and `headers` work on Hetzner too.

### Who holds the keys (experimental)

`experimental.wheel` decides who can unlock a stack's `secret` bindings. It may change or go away between releases.

> **Not battle-tested yet.** Minting is tested end to end (create, redeploy, destroy, create again), and the generated stacks type check against Alchemy. The 1Password path, varlock fetching `op` secrets, has not been run against a real vault yet. Try it on a throwaway stack and a test vault before you point it at prod.

```ts
experimental: { wheel: "agent" },   // or "human"
bindings: {
  SESSION_SECRET: { type: "secret" },                                     // agent: minted by the stack
  STRIPE_KEY: { type: "secret", op: "op://my-app-test/stripe/credential" }, // from 1Password
  AI_KEY: { type: "secret", op: "op://my-app-test/ai/key", optional: true }, // bound only if the item exists
},
```

- **`"agent"` lets the agent take the wheel.** It's for stacks that come and go: tests, CI, previews. A secret without `op` is minted when the stack is created (`Alchemy.Random`), stays the same across deploys, and is gone on `destroy`. Create, test, destroy as often as you like; there's nothing to rotate. A secret with `op` is read from 1Password with a service account token in `OP_TOKEN`. Scope that account to one vault.
- **`"human"` keeps a human in the loop.** It's for prod. A secret with `op` is read from 1Password by the app on your machine, behind your Touch ID or passkey. Any `OP_TOKEN` is ignored. A secret without `op` comes from the shell or `.dev.vars`, as it does without the flag.
- **`optional: true`** is for keys you may not use. A missing 1Password item resolves to nothing instead of failing the deploy, and the Worker gets the secret only when it has a value.

With the flag on, `generate` writes `.env.schema` at the app root: every secret by name and where it comes from, never a value. Commit it. It's the portable half: any laptop, CI job or agent that clones the repo resolves the same typed secrets from it, each behind its own wheel, and it works with [varlock](https://varlock.dev) outside Rusty Buns too. (If your `.gitignore` has `.env*`, add `!.env.schema`; `generate` reminds you.) Delete its `# GENERATED` header and it's yours: Rusty Buns stops rewriting it and uses it as-is.

**Why [varlock](https://varlock.dev)?** It turns a `.env` file into a schema: every variable gets a type, a description and a `@sensitive` flag, and its value is a *reference* (`op(op://…)`) instead of the secret itself. You get the "what does this app need" story in one committed file that agents can read safely, plus pluggable stores (1Password, AWS, Vault, or any CLI), validation before anything runs, redaction of sensitive values in its output, and `varlock scan` to catch a secret someone pasted into code. It's MIT-licensed and works with any language, so the schema isn't tied to Rusty Buns.

At plan and deploy time, varlock resolves the schema and the values reach Alchemy as env, so they go straight into Cloudflare or Railway secrets and never sit in a file. It ships with the CLI, so there's nothing to install; a varlock in your project or on PATH wins if you have one. `"human"` also needs the 1Password CLI, `op`, with "Integrate with 1Password CLI" turned on in the app.

**Why this is safe:**

- **No values in the repo.** `.env.schema` holds names and references. Committing it leaks what you need, not what it is.
- **Values only travel at deploy time.** varlock fetches them, Alchemy hands them to Cloudflare or Railway's own secret storage, and the running app reads them from there. Nothing is written to disk on the way, and the live app never talks to 1Password, so a 1Password outage blocks deploys, not your users.
- **Minted secrets are disposable.** A test stack's secrets exist only as long as the stack. If one leaks, `destroy` and it's gone; there's nothing long-lived to rotate.
- **An agent only gets what you scope.** `"agent"` uses a 1Password service account tied to the vaults you choose. Give it a test vault and it can't reach prod.
- **Prod needs you.** `"human"` ignores any token, so only the 1Password app on your machine, behind Touch ID or a passkey, can unlock those secrets.

What it doesn't do: once a value is fetched, the command that receives it can read it. A process you run with secrets can print them. The wheel decides who can *fetch* a secret, and vault scoping limits the damage; neither one sandboxes what happens after.

Two limits. Minted secrets live in Alchemy's state (see `state` above), in plain text, like every other Alchemy output; a CI runner that throws its state away gets fresh ones next time. And minting doesn't work on a Hetzner box yet, because its env file can't take a generated value, so give those secrets an `op` reference or use Railway.

## The host

The desktop host listens on `127.0.0.1` on a random port by default (`listen` in the config, `--listen host:port` or `RB_LISTEN` at launch), and every request needs the per-launch token. The browser it opens gets a one-time launch code (`?rb_launch=`, good for one use within 60 seconds) rather than the token, so the token stays out of the terminal log and `ps`; it is printed only with `RB_NO_BROWSER=1` or when no browser could be started. While it runs, the host also leaves `{url, token, pid}` in `desktop.json` in its data dir, readable by you alone (0600) and removed on exit, so local tools on the same machine can find it. It sets COOP/COEP so `SharedArrayBuffer` works. `/__rb/info` shows runtime info, and `/__rb/action` runs your `"use server"` functions against sqlite. `cloudflare:workers` and `rwsdk/worker` are shimmed, including rwsdk 1.x's `serverAction`, `serverQuery` and `registerServerFunctionWrap`. D1 migrations apply at boot and are tracked in `d1_migrations`. `RB_VERSION` is `<package version>+<git sha>`. Data lives in `~/.<app-name>/`.

The box host is the same program, minus the token and the browser.

### Running code you didn't write

An agent boots examples and apps it didn't write, so the CLI starts every desktop host it built (`run desktop`, `run desktop --watch`, `scripts/boot.ts`) with locks that cost nothing, since the desktop host takes no secrets:

- `bun --no-env-file`: Bun doesn't load the project's `.env` into it.
- `bun --no-install`: a missing import fails instead of fetching from npm at run time.
- A scrubbed environment: anything named like a token, key, password or cloud login (`*_TOKEN`, `*_SECRET`, `GITHUB_*`, `CLOUDFLARE_*`, `AWS_*`, `OP_*` and so on) is dropped. `RB_*`, `SSH_AUTH_SOCK` and `GIT_SSH_COMMAND` stay.

`run desktop --sandbox` (or `RB_SANDBOX=1`) adds a macOS Seatbelt profile (`sandbox-exec`): the host and whatever it spawns can do anything (network, FFI, its data dir, the repo) except read or write `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.alchemy`, wrangler's and 1Password's config, `~/Library/Keychains`, and the project's `.env`, `.dev.vars` and `.alchemy/` (up to the repo root). It's opt-in because a host that pushes over SSH with your keys, like codeSplitter's mirrors, needs `~/.ssh`. `scripts/boot.ts` turns it on (`RB_SANDBOX=0` turns it off). Inside another Seatbelt sandbox, or off macOS, it says so and runs without one.

`plan`, `deploy` and `dev` build the Worker (`worker.build`, such as a `jekyll build` that runs the site's plugins) without the deploy's logins: every `CLOUDFLARE_*`, `CF_*`, `WRANGLER_*` and `ALCHEMY_*` variable, plus the tokens and keys of the other providers (Hetzner, Railway, 1Password, AWS, GitHub and so on). The rest of the environment and `.dev.vars` stay, so `NODE_ENV`, `VITE_*`, `NPM_TOKEN` and `GITHUB_SHA` still reach the build. Only Alchemy, which does the deploy, gets the Cloudflare token.

With `--sandbox` (or `RB_SANDBOX=1`) the Worker build also runs with an empty `HOME`, `.rustybuns/home`, so a build step can't read `~/.wrangler`, `~/.alchemy`, `~/.npmrc`, `~/.config/gh` or anything else there. The package caches and toolchains still point at the real ones (npm, pnpm, Bun, Yarn, Bundler, `~/.cache`, rbenv, nvm, Volta, asdf, mise, cargo), so a build doesn't start cold, and git gets no credential helper, so a 401 fails instead of asking a keychain. It's opt-in because a build that needs a login under `HOME`, like a private registry in `~/.npmrc` or Docker's context, loses it.

`plan --offline` goes further, for a repo that isn't yours: no Cloudflare login, no Alchemy state and no Alchemy run, so not one API call to any account. It builds the Worker with the empty `HOME`, type checks the generated stack, and lists every resource in it as a create, which is what a plan against an empty account shows. A real `plan` may find some of them already there, so an offline plan doesn't count as the plan `deploy` asks for.

### Multiplayer on a LAN

A `spa` desktop can host its world for other copies of the app. Each guest runs its own binary, whose page is served from its own `127.0.0.1`, and opens one WebSocket to the host machine. Nothing else crosses the network: the SPA, assets, `/__rb/info` and `/__rb/action` stay behind the host's token, and a guest never gets that token.

```ts
desktop: { mode: "spa", guests: { max: 8 } }      // closed until the UI opens it
```

The host's page opens and closes the world at runtime, so there is no rebuild between "single player" and "host a world":

```ts
// "Host a world": listen on every interface (the port stays the same, so this page keeps working) and set a passphrase.
// Off loopback it takes at least 12 characters (shorter is a 400 weak_passphrase that changes nothing);
// join: true makes one up and returns it once, as guests.join
await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: "orange-kettle" }) });
// "Stop hosting"
await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) });
// Who is here: `/__rb/info` has listen, lan (this machine's addresses, to show friends), sockets, and guests { open, connected, max, version }
```

A guest connects to the host's address with the join query; `worldSocket` from `@rustybuns/shell-bun/client` builds it:

```ts
import { worldSocket, playerId, wireVersion } from "@rustybuns/shell-bun/client";
worldSocket("http://192.168.1.20:4000/ws", { join: "orange-kettle", uid: playerId(), name: "Ada", v: await wireVersion() });
```

`RB_VERSION` is only defined in the host bundle, not in your client build. `wireVersion()` asks the guest's own host (`/__rb/info`) which version it checks guests against. The guest runs the same app, so a matching build sends what the remote host expects.

What the host checks before upgrading, in order, each with a JSON `{ error }` body:

| Check | Response |
|---|---|
| `join` missing or wrong, or the world is closed | `403` |
| `v` differs from the host's build (`RB_VERSION`, or `guests.version`) | `409 version_mismatch` with `expected` |
| `guests.max` sockets already connected | `503 full` |
| `uid` not `1-64` of `[A-Za-z0-9_-]`, equal to the host's id, or `name` not 1-32 printable characters | `400 bad_identity` |

The world then sees the same headers it would on Cloudflare: `X-User-Id` and `X-User-Name` from the guest's query, `X-World-Slug` and `X-World-Owner` from the host, and `X-RB-Principal: host | guest`. The host's own socket keeps the local identity, and its `?uid=` is ignored. Your world class can do its own checks before accepting the socket; the `host` module gets `ctx.shell` (`comms.sockets()`, `rebind()`) and `ctx.guests`.

The trust model is a join passphrase plus trust-on-first-use identity: a `uid` is whatever a guest says it is, so treat it as a stable handle, not proof. There is no TLS, so this is `ws://` on a network you trust. Guest pages are served over http from their own host, so a `ws://` target is not mixed content; a page served over https could only open `wss://`. Two instances on one machine coexist (the token cookie is named per port), which is the easy way to test. Running a world on a public box or through a relay is the same wire protocol, but not something this version sets up.

Durable Objects run in-process with WebSocket hibernation handlers, `blockConcurrencyWhile`, alarms and storage. Socket tags (`getWebSockets(tag)`, `getTags`) work, and `namespace.evict(id)` drops an instance so a test can exercise the restore path from storage plus live sockets. Not emulated yet: automatic eviction, cross-script DOs, and the SQLite-backed `ctx.storage.sql` API.

## Repo layout

```
packages/cli         init, add, build, plan/deploy; generates the host and the Alchemy stack
packages/shell-bun   Bun.serve shell, token gate, D1/KV/R2/DO bindings over sqlite and the fs
packages/ports       types only: Http, Comms, Storage, Memory, Reporter
packages/native      loadNative(name, symbols): dlopen a Rust cdylib, null means take the TS path
native/              Cargo workspace; rb_hello proves cdylib + pointer-over-SAB; rb_genome + native/stress/ hammer one shared memory from native and wasm workers at once (`bun native/stress/genome.ts`)
apps/                example apps, see EXAMPLES.md
```

