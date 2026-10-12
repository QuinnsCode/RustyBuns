# Framework coverage

How many real apps on each framework run under Rusty Buns with no changes, measured on public GitHub repos. [FRAMEWORKS.md](FRAMEWORKS.md) is the roadmap, and this page is the scoreboard.

## How it's measured

`scripts/trial-github.ts` code-searches GitHub for `package.json` files that depend on a framework and drops forks and archived repos. For each app it then:

1. clones the repo and installs it. A lockfile decides the package manager. With no lockfile it uses pnpm, and a failed npm install is retried with pnpm.
2. runs `rustybuns init`.
3. builds and boots the desktop host in **`spa` mode** and again in **`worker` mode**.
4. GETs `/` with the launch token. A 2xx or 3xx counts as serving the app.

```sh
bun scripts/trial-github.ts --dep rwsdk --major 1 --local --jobs 3      # this checkout, both modes
bun scripts/trial-github.ts --dep rwsdk --major 1 --stable --since 2026-01-01
bun scripts/trial-github.ts --local --prof owner/repo owner/monorepo:apps/web
```

Results go to `.rustybuns-trial/summary.md` (gitignored). That file has a row per app, its first error, and pass rates by last push. `--prof` adds boot time, `GET /` latency, memory, and a `.cpuprofile` for each mode. Open the profile in Chrome DevTools (Performance, then Load profile) or on speedscope.app.

The two modes measure different things. **`spa`** serves the client build and runs `"use server"` functions on the host. **`worker`** runs the app's own built Worker on the host: its server rendering, routes and server functions, against the local twins. Passing in `worker` mode is the stronger result.

The apps are strangers' code, so their scripts run with **none of this machine's logins**. HOME is an empty directory, Cloudflare's variables hold dead values, and only the package caches point back at the real ones. This matters because a release script can run `wrangler d1 migrations apply --remote` or `wrangler deploy`. The point is to prove each app on Rusty Buns' local twins, never on someone's real cloud or data.

The apps' own credentials are kept out too, in two ways:

- **Secrets files are deleted.** Before any of the app's code runs, committed secrets files (`.env`, `.env.production`, `.dev.vars` and the like, but not the `.example` ones) are removed from the clone.
- **Remote steps are dropped from the build.** `init` leaves out any step that would act on a real database or account (migrations, `db push`, seeds and deploys to wrangler, Vercel, Netlify, Convex or Supabase). So a Vercel-style `"build": "prisma migrate deploy && vite build"` runs only the build.

On macOS the operating system enforces two more limits (`sandbox-exec`), on every app command:

- **No reading or writing under your home folder**, except the toolchains and package caches the build needs. That means no `~/.ssh`, keychains or `~/.wrangler`.
- **No network after install** except localhost. A build or a booted server can't send anything out or reach a real service.

Installs keep the network, because packages come from registries.

**Missing secrets are faked, never borrowed.** The harness collects every secret an app declares or reads:

- from `.env.example`, `.dev.vars.example` and similar files;
- from `process.env.X` and `env.X` in the app's code;
- from the variables well-known SDKs read on their own (Clerk, better-auth, Auth.js, Convex, Supabase, Stripe, Resend, OpenAI, Anthropic, Prisma and Neon).

It then fills each one with a plausible fake, chosen by name:

| secret name | fake |
|---|---|
| `*_SECRET`, `*_KEY` | random bytes |
| Clerk keys | the right `pk_test_…` / `sk_test_…` shape |
| `DATABASE_URL`, `*_URL` | a dead local address |

That's enough for an app to boot and render logged-out. Anything that really needs the service fails, as it should.

This is containment, not malware detection. Reading code can't reliably tell a malicious package from a fine one, so the harness assumes the worst and gives the code nothing worth stealing and nowhere to send it.

## RWSDK

**Run: Oct 12 2026, RWSDK 1.x, this checkout. 196 apps found.**

| | apps | of installed |
|---|---|---|
| install | **180** of 196 | |
| serve `/` in `spa` mode | 143 | 79% |
| serve a server-rendered `/` in `worker` mode | 111 | 62% |
| serve `/` in at least one mode | **153** | **85%** |

`init` writes `spa` for RWSDK, because it serves more apps. `worker` is set by hand for now.

### By version and by last push

| rwsdk version | apps | install | spa | worker | either |
|---|---|---|---|---|---|
| 1.x stable | 97 | 88 (91%) | 74 (84%) | 57 (65%) | 78 (89%) |
| 1.0.0 alpha / beta | 97 | 90 (93%) | 67 (74%) | 52 (58%) | 73 (81%) |
| canary / test builds | 3 | 3 (100%) | 3 (100%) | 2 (67%) | 3 (100%) |

| last push | apps | install | spa | worker | either |
|---|---|---|---|---|---|
| under 3 months | 63 | 56 (89%) | 49 (88%) | 45 (80%) | 51 (91%) |
| 3 to 12 months | 111 | 104 (94%) | 75 (72%) | 47 (45%) | 82 (79%) |
| over a year | 22 | 20 (91%) | 19 (95%) | 19 (95%) | 20 (100%) |

Recently pushed apps on a stable release do best. Most worker-mode failures come from the 1.0 betas, while RWSDK's build layout was still changing. The apps pushed over a year ago are mostly small starters. `--stable` and `--since` narrow a run to the apps that matter.

### Perf (dev host, M1 Pro, 200 sequential GETs of `/`)

| app | mode | boot | p50 | p95 | rss | page |
|---|---|---|---|---|---|---|
| redwoodjs/local-ci (website) | worker | 275 ms | 4.8 ms | 8.0 ms | 137 MB | 80 KB |
| redwoodjs/machinen.dev (marketing) | worker | 271 ms | 4.3 ms | 8.2 ms | 131 MB | 69 KB |
| redwoodjs/rwsdk.com | worker | 549 ms | 54 ms | 242 ms | 252 MB | 303 KB |
| amis-harmonie-sucy.fr | worker | 297 ms | 0.22 ms | 0.42 ms | 70 MB | 42 KB |
| valscion/esc-voting | worker | 265 ms | 1.9 ms | 2.7 ms | 74 MB | 3 KB |
| zshannon/wbs01-web | worker | 267 ms | 1.9 ms | 3.1 ms | 80 MB | 14 KB |
| any of them | spa | ~254 ms | ~0.15 ms | ~0.25 ms | ~28 MB | shell |

rwsdk.com is slow on the host because its star widget fetches the GitHub API with `cf: { cacheTtl }`. Cloudflare's edge cache answers that fetch, but the host ignores `cf`, so every render calls GitHub ([#908](https://github.com/QuinnsCode/RustyBuns/issues/908)).

### Fixed by these runs

- `rwsdk/worker` shims: `serverAction`, `serverQuery`, `registerServerFunctionWrap`, `getRequestInfo` and `defineScript`.
- `cloudflare:workers` shims: `RpcTarget` (capnweb extends it at load) and `WorkflowEntrypoint`.
- The worker-mode host sets workerd's `globalThis.Cloudflare.compatibilityFlags`, which nodejs_compat builds read as they load.
- The host builds the bindings before the Worker loads, so `await getDb()` at a module's top level works, and ``import(`cloudflare:workers`)`` resolves to the shims.
- The host finds the real built Worker (`worker.js` in the 1.0 alphas) from the `wrangler.json` the build writes.
- `init` runs the app's pre-build steps (`prisma generate`) before the desktop build. It drops migrations, deploys and check/test/lint steps from the build it infers, and skips release scripts that never build.
- The build finds `vite` and other tools hoisted to a workspace root.

### What still fails

| apps | cause | whose |
|---|---|---|
| 14 | `RWSDK directive scan failed: Must use "outdir"` inside the app's own `vite build` (all in redwoodjs/sdk-experiments) | the app's / RWSDK's |
| 10 | `wrangler` named-export error at build: no lockfile, so a fresh install pairs a newer wrangler with an older `@cloudflare/vite-plugin` | the app's |
| 10 | a 500 at request time, not yet triaged | open |
| 7 | the app needs a secret (`AUTH_SECRET_KEY`, `BETTER_AUTH_SECRET`) | [#913](https://github.com/QuinnsCode/RustyBuns/issues/913) |
| 5 | `tsyringe` needs `reflect-metadata` first (passkey addons) | [#910](https://github.com/QuinnsCode/RustyBuns/issues/910) |
| 2 | `cloudflare:email` | [#911](https://github.com/QuinnsCode/RustyBuns/issues/911) |
| 1 | Prisma's `.wasm` query engine in worker mode | [#909](https://github.com/QuinnsCode/RustyBuns/issues/909) |
| 1 | `virtual:use-client-lookup` in the spa build | [#912](https://github.com/QuinnsCode/RustyBuns/issues/912) |
| 16 | don't install: broken lockfiles, `jsr:` dependencies, network errors | the app's |

About 10 of the apps found aren't runnable apps at all: library packages inside monorepos, templates and benchmarks. No tool would boot them.

## TanStack Start

**Run: Oct 12 2026, `@tanstack/react-start` 1.x, this checkout. A partial mixed sample of 16 apps.**

820 apps were found; 469 of them were pushed in the last 3 months. The run was cut short on purpose to free the machine. The sample, drawn with `--sample` (stratified), covers:

- big monorepos (convex-backend, secret-project-331);
- official templates (Convex + Clerk, the Clerk quickstart);
- docs sites;
- popular standalone apps;
- the long tail.

| | apps |
|---|---|
| sampled | 16 |
| install | 13 (the 3 others failed on clone or network timeouts) |
| serve a server-rendered `/` | **8 of 13** |

Before this run's fixes, it was 0. Off Cloudflare, `init` gave TanStack Start apps a SPA config, but Start renders on its server and has no `index.html`, so every request was a 404. `init` now runs the app's own production server in `worker` mode. Which server it uses depends on how the app builds:

| how the app builds | server the desktop runs |
|---|---|
| no Nitro | `<outDir>/server/server.js` |
| `nitro({ preset: "vercel" })` | the Vercel function, `export default { fetch }` |
| `nitro()` with no preset | `NITRO_PRESET=standard`, `.output/server/index.mjs` |
| `cloudflare({ viteEnvironment })` | the Worker, found by the `wrangler.json` its build writes |
| a preset that starts its own server (`bun`, node-server) | none; `init` says so |

Fake secrets turned the Clerk-based templates' 500s into working pages.

### What still fails

| apps | cause | whose |
|---|---|---|
| 4 | a monorepo frontend whose workspace packages must be built first (`start-only, monorepo`) | ours: build the workspace dependencies before the app ([#953](https://github.com/QuinnsCode/RustyBuns/issues/953)) |
| 3 | clone or install timeouts on very large monorepos | the run's (network, size) |
| 1 | a 500 on a Cloudflare monorepo app (algorandfoundation/gGov) | open |

The by-kind pass rates are written to `summary.md`'s "By kind of app" table on each run. The next full sample (`--sample 30`) should come from the dedicated build box, not a laptop.
