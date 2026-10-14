# Alchemy in codeSplitter: from config to the world

The idea in one line: **we only connect dots, and Alchemy is the type guarantee that the dots are real.**
Nobody writes infrastructure by hand. One typed config says what the app is, `rustybuns` turns it into an Alchemy stack, Alchemy checks that stack against the types before it touches an account, and only then does it make, change or delete anything.

## The steps

| # | Step | What happens | Where |
| --- | --- | --- | --- |
| 1 | **Declare** | `rustybuns.config.ts` names the Worker, every binding (D1, Durable Objects, queues, R2, Artifacts, containers, secrets, vars), crons and stages. `defineConfig` types it, so a wrong binding fails in the editor. | `apps/codesplitter/rustybuns.config.ts`, `packages/cli/src/config.ts` |
| 2 | **Gate flags** | Paid or risky parts are off until the deploying shell turns them on: `CODESPLITTER_AGENTS`, `_DEPLOYS`, `_CHECKS`, `_VECTORS`, `_WATCH_NEWS`, `_MAIL_FROM`. Secrets are `op://codesplitter/…` references, resolved by varlock behind Touch ID, never exported. | top of the config, `.env.schema` |
| 3 | **Generate** | `generate` writes `.rustybuns/alchemy.run.ts` (readable, committable) plus `wrangler.jsonc` and `.env.schema`. Crons and `cpuMs` are validated here, so a typo fails before Cloudflare sees it. | `packages/cli/src/gen/alchemy.ts` |
| 4 | **Typecheck the stack** | The generated stack is type-checked before Alchemy runs. This is the guarantee: a binding that doesn't line up with a resource doesn't plan. | `checkStack` in `packages/cli/src/index.ts` |
| 5 | **Cost and protect report** | Every plan and deploy prints the monthly cost estimate and which resources `destroy` would keep (`protect: true`) and which it would remove. | `costs.ts`, `protect.ts` |
| 6 | **Guards** | A deploy is refused when HEAD is behind `origin/main` (it would roll the live site back), when the Alchemy state sits under an old app name, or when it would delete a stateful resource and its data (`--allow-delete` to mean it). | `guardDeploy` |
| 7 | **Plan** | `rustybuns plan` creates nothing. Under `targets.edge.adopt` an empty state says that a `create` of the Worker or D1 is an adopt of the live one by name. `plan --offline` needs no login or state at all. | `rustybuns plan` |
| 8 | **Login and build** | Cloudflare login first (so a missing login costs a second, not a build), then the Worker builds with the deploy's credentials stripped, then source maps are named. | `cloudflareLogin`, `buildWorker` |
| 9 | **Deploy** | Alchemy applies the plan. Without `--yes` the deploy refuses unless a plan for this exact config was made first. D1 migrations apply here (Alchemy's `__alchemy_migrations` is the only ledger), Durable Object migrations append their next tag. | `rustybuns deploy` |
| 10 | **After** | Workers Logs query-string redaction is set again (each upload resets it), and the mode line (`FRESH` or `ADOPT`) is printed last. | `redactAfterDeploy` |
| 11 | **Destroy** | `rustybuns destroy --stage <name>` removes a stage's resources except the protected ones. | `rustybuns destroy` |

Every step runs inside one scope: a signal or failure stops Alchemy, then frees the state lock (`lifecycle.ts`), so an interrupted deploy never leaves an orphan behind.

## Three places it runs

- **Releases to the live site** go through `scripts/release.ts` (the owner's `release-codesplitters.sh`): it plans first, fixes what it safely can, and stops on any row that deletes, replaces, unbinds or makes something.
- **Hosted deploys of other people's repos** run `rustybuns deploy` in the `DeployRunner` container with the repo's sealed, write-only deploy key. Only the owner ships; agents get previews at most.
- **Previews** deploy to their own `preview-<id>` stage, are checked for a non-5xx answer, and are destroyed.

## Stages

A stage is a name for a whole copy of the stack: `live_$USER` by default, `office-preview` for the throwaway Agent Office, `preview-<id>` for previews. Each stage names its own D1, queues and bucket in the config's `stages` block, so destroying one touches nothing live. State is shared by all worktrees of a clone; a different clone starts empty and adopts by name.

## Where it reaches

Cloudflare is the home of everything today (Worker, D1, Durable Objects, Queues, R2, Artifacts, Vectorize, Containers). `targets.box` adds a Hetzner or Railway box beside it, so one stack can span clouds, and `rustybuns infra --json` already returns the whole thing as a graph of nodes and edges (the repo page's infra map reads it). That graph is the data the global health view would draw: see the follow-up issues.

## Checking the dots are connected

```sh
cd apps/codesplitter
bun ../../packages/cli/src/index.ts infra           # the stack as a list: what is kept, what is removed
bun ../../packages/cli/src/index.ts plan --offline  # no login, no state, nothing touched
bun ../../packages/cli/src/index.ts plan            # the real plan; creates nothing
```
