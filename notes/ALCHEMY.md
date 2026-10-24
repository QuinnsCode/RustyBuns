# What Alchemy offers that we don't use

Research, October 2026. Sam Goodwin (Alchemy's author), on hearing we use it as our deployment factory:
"Alchemy is about much more than deployment". This maps that "much more" against what
`packages/cli/src/gen/alchemy.ts` generates today. Sources: the package we install (`alchemy@2.0.0-beta.77`, read
under `node_modules/.bun/alchemy@2.0.0-beta.77+*/node_modules/alchemy/src`), the docs at
[alchemy.run](https://alchemy.run) (also served to agents as [llms.txt](https://alchemy.run/llms.txt)), and the
[release notes](https://github.com/alchemy-run/alchemy/releases).

The short answer: v2 is an Effect application framework, and deploying is one part of it. It also runs the app
locally against emulators, tests it against real throwaway stages, gives every PR its own preview, notices
when the account drifts, and ships libraries that run on Workers: a git server, Better Auth, typed RPC
between Workers. Everything below is beta; the README says "Expect breaking changes".

## What we use now

The generator writes `.rustybuns/alchemy.run.ts` from `rustybuns.config.ts`, and the CLI runs `alchemy plan`,
`deploy`, `destroy` and `dev` on it. In that file:

- Cloudflare: `Worker` (domain, routes, crons, observability, placement, limits, assets, workersDev),
  `DurableObject`, `D1`, `KV`, `R2`, `Queues` (queue and consumer), `Vectorize` (and metadata indexes),
  `Hyperdrive`, `RateLimit`, `Images`, `Email.SendEmail`, `Container`, `Artifacts`, `Workflow`, `WorkerLoader`,
  `AnalyticsEngine`, `Workers.AI`, `InferEnv` for the typed env.
- Elsewhere: `Command.Build`, `Hetzner.Server/Volume/Service`, `Railway.Project/Service/Volume`,
  `Neon.Project/Branch`, `Alchemy.makeRandom` for minted secrets.
- Policies: `AdoptPolicy.adopt`, `RemovalPolicy.retain` (`protect: true`), `renamedFrom`.
- State: `Alchemy.localState()`, which `packages/cli/src/state.ts` symlinks into the git common dir and guards
  with its own lock so every worktree on one machine sees one state per app.

That is the classic async-Worker style: our app code never imports Alchemy or Effect. Most of what follows
keeps it that way; the rows that don't say so.

## Before anything else: the version

We pin `2.0.0-beta.77`; npm's `latest` is `2.0.0-beta.84` (October 24, 2026). beta.84 is a
[breaking package split](https://github.com/alchemy-run/alchemy/releases/tag/v2.0.0-beta.84): Cloudflare, AWS,
Git, Drizzle and others moved to their own `@alchemy.run/*` packages, so the generator's
`import * as Cloudflare from "alchemy/Cloudflare"` changes, as does the pin in `packages/cli/src/glue/deploy-deps.ts`.
beta.78 also took `Alchemist` out of the root export. The bump is its own PR, with a plan diff on codeSplitter's
stack that shows no replaces.

beta.77 also lists seven exports in `package.json` with no file behind them (`Construct`, `ContentType`,
`Endpoint`, `Process`, `TUI`, `Util/Clank`, `Cloudflare/Live`); nothing there to adopt. Nothing called Clank
appears in the repo or docs either.

## Worth taking, ranked

| # | Alchemy piece | What it gives us | Replaces / adds | Size |
|---|---|---|---|---|
| 1 | [Drift](https://alchemy.run/cli/drift): `alchemy drift`, `Drift.detect/plan/repair` | Re-reads the live account and shows what no longer matches state (a dashboard edit, a wrangler deploy, a deleted bucket); `--repair --yes` puts it back | Nothing: `rustybuns plan` only diffs config against state. Read-only by default, so cheap to add as `rustybuns drift` | S |
| 2 | [Remote state](https://alchemy.run/state-store): `postgresState()`, `Cloudflare.state()` | One state per stage that CI, the cloud office and every machine see. `postgresState` takes a per-(stack, stage) advisory lock | Our symlink-into-`.git` plus lock in `state.ts`, which only works on one machine. A deploy from CI today starts from empty state. We already make Neon, so `postgresState` is the natural pick; the Cloudflare store's locking isn't documented, and its Worker sends telemetry even when ours is off (see below). `State.Sync`/`Export` move existing state across | M |
| 3 | [Worker Previews](https://alchemy.run/cloudflare/compute/previews) (`preview: { of: parent }`) plus [per-PR stages in CI](https://alchemy.run/environments/ci) and `GitHub.Comment` | Each PR gets its own URL with its own Durable Objects; the comment on the PR is kept up to date; the stage goes when the PR closes | Nothing: we have no preview deploys. Fits codeSplitter's review flow and Agent Office's "show me it running". Needs #2 first so CI sees state | M, plus a manual run for the CI token |
| 4 | [Test harness](https://alchemy.run/testing/test-harness): `alchemy/Test/Bun` `Test.make`, `Test/Http` `getWhenReady` | A suite deploys a real stack once (`test_$USER` or `ci-pr-42`), hits it, destroys it; `dev: true` runs the same suite on the local emulators | ROADMAP item 6 (`rustybuns test`, "local workerd via Alchemy's test harness"), unbuilt. Also a path to the "one journey through the running app" tests AGENTS.md asks for | M |
| 5 | Worker `version` (`traffic`, `alias`, `tag`, `message`) | Gradual rollout: a new version at 10% before 100%, and stable preview aliases | Partly `drain.ts`. A canary is the gentler deploy for codeSplitter's rooms | S |
| 6 | [`@alchemy.run/git`](https://alchemy.run/git) | A git server on Workers, DOs and R2: smart HTTP, a typed REST plane with [pull requests](https://alchemy.run/git/pull-requests) (server-side merge base, tree diffs, ff and three-way merge) and a [GitHub REST v3 facade](https://alchemy.run/git/github-api) that `gh` and Octokit can point at | codeSplitter's own git plumbing (`mirror.ts`, merges, its GitHub-shaped API). Not a swap: codeSplitter stands on Cloudflare Artifacts and its own merge rules. Worth reading for the GitHub facade and the merge code, and comparing on the cases codeSplitter's tests already walk | Read: S. Adopt: L |
| 7 | `GitHub.Secrets` / `Variables` / `Environment`, a minted `Cloudflare.ApiToken` | CI credentials as code: the stack mints a scoped Cloudflare token and writes it to the repo's secrets | Hand-set repo secrets. The owner's call (AGENTS.md: secrets and settings are the owner's), so a stack the owner runs | S, owner-run |
| 8 | `Workers.Route`, `DNS.Record`, `Zone`, `CustomHostname` | Domains and DNS in the stack | Dashboard DNS for codeSplitter and the demos | S |
| 9 | [`Access`](https://alchemy.run/cloudflare/security/access) + the Worker `access` prop; `Turnstile.Widget` | Cloudflare Access in front of a preview stage or an admin page; a bot check on public forms | Bearer tokens on human-facing admin routes; hand-made Turnstile widgets | S |
| 10 | `AI.Gateway` (+ `ProviderKey`) | Caching, rate limits and spend caps in front of model calls | Nothing: no app routes model calls through a gateway today. A cost guard (excalibrawl ran its credit dry) | S |
| 11 | `Command.Exec`, [`Command.Dev`](https://alchemy.run/command/dev-servers), `alchemy logs --tail` | A migration or seed step in the deploy graph; a Vite or Bun dev server inside `alchemy dev`; every resource's logs in one tail | Pre-deploy steps the CLI runs by hand; per-Worker `wrangler tail` | S |
| 12 | `Workers.ObservabilityDestination`, `Logpush.Job`, `Axiom.*` | Our app's logs and traces shipped somewhere queryable, dashboards and monitors as resources | Only the Workers dashboard today. Costs money; price first | S-M |
| 13 | Typed RPC (`Workers.bindWorker`, `RpcDurableObject`, [schemaless RPC](https://alchemy.run/cloudflare/apis/schemaless-rpc)) | One schema on both ends of a Worker-to-DO call | codeSplitter's `stub.fetch(new Request(...))` plus JSON bodies (`privacy.ts`, `cuts.ts`). Pulls Effect into Worker code, which AGENTS.md keeps at the edges; Cloudflare's own DO RPC (`stub.method()`) gets most of this with no Alchemy | L |

## Also there, no use yet

- Libraries that run on Workers: `@alchemy.run/better-auth` (Better Auth with a D1 layer, six-part tutorial),
  `@alchemy.run/domain` (commands, aggregates, events; beta.84), Effect AI `LanguageModel`, AI Search, Effect SQL.
- Cloudflare: `Pipelines`, `Browser`, `Flagship` (feature flags), `Stream`, `SecretsStore`, `Pages`,
  `Website.*` (Vite, StaticSite, Astro, Next, Nuxt, SvelteKit, TanStack Start), `WorkersForPlatforms`, `Tunnel`,
  `LoadBalancer`, WAF `Ruleset`, `Alerting`, Email Routing, R2 event notifications, MCP Portal.
- Other providers: AWS (with local emulation), GCP, Docker, Kubernetes (Helm, kind), Fly, PlanetScale,
  Prisma Postgres, Turso, Stripe, and the rest of Hetzner (Firewall, Network, DNS) and Railway (Postgres, Redis,
  Bucket, domains). [Neon branches per PR](https://alchemy.run/neon/guides/preview-branches) go with #3.
- Data: Drizzle and Prisma with committed migrations applied on deploy, `SQL.Migrations`, `Neon.Migrations`.
- Tooling: `Alchemist` (the CLI as an Effect API: Stack, Drift, Logs, State; the hook for an agent or the office
  to drive deploys without shelling out), the `alchemy-test` runner (agent-friendly output, one Bun process),
  `alchemy state list|read`, `alchemy profile`, `KeyPair`, custom providers and "Actions" for anything missing.
- `alchemy unsafe nuke` deletes every resource the providers can list, whatever the stack or state. It is hidden
  from `--help` so agents don't find it; ours must never run it (`--local` only wipes the emulators).

## Things to know either way

- **Telemetry is on by default.** The CLI sends a random id, hashes of the git origin and branch, the repo's root
  commit SHA, and the command, resource types and operations to `otel.alchemy.run` (no secrets, values or source).
  `DO_NOT_TRACK=1` or `ALCHEMY_TELEMETRY_DISABLED=1` turns it off, and our sandbox Dockerfiles already set
  `DO_NOT_TRACK`; `rustybuns` doesn't when it runs `alchemy`. The Cloudflare state store's Worker sends its own
  signals even then. ([privacy](https://alchemy.run/privacy))
- **Agent mode.** The CLI notices `CLAUDECODE`, `CURSOR_AGENT` and `CODEX_CLI`, prints plain output and needs
  `--yes` to apply. `alchemy.run/llms.txt` and every page as `.md` are written for agents.
- **No hosted service, no pricing.** Everything runs in our own accounts; Alchemy is open source.

## Suggested order

1. Bump to beta.84 alone, with the import rename and a plan diff on codeSplitter's stack. Set
   `DO_NOT_TRACK=1` in the env `rustybuns` gives `alchemy`, or say in the docs that it's on.
2. `rustybuns drift` (#1): small, read-only, and it shows whether the bump or anything else moved the account.
3. `postgresState` on the Neon we already make (#2), then Worker Previews per PR (#3) on top.
4. `rustybuns test` on the test harness (#4), run against those preview stages.
5. Read `@alchemy.run/git` (#6) next to codeSplitter's merge code and file what's worth taking.
6. The rest as the apps need them. Every row that creates resources costs money at scale; price it first and
   keep the smallest tier (`packages/cli/src/costs.ts`, COSTS.md).
