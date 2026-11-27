# Effect: patterns and rulings

When to reach for `effect` in this repo, with patterns taken from three codebases that use it well. The short
rule lives in [AGENTS.md](AGENTS.md#effect-where-it-fits): use it at the edges, where something must be cleaned up,
cancelled, retried, or can lose state, and the right answer to a failure depends on which failure it is. This page is
the long version.

## The test

Use Effect when all three are true:

1. The work crosses a boundary: network, child process, disk, another service.
2. It can fail in more than one way, and each way needs a different response (retry a timeout, give up on a 410,
   alert on a bad signature).
3. Something must be cleaned up, or must not be lost, if the work is interrupted.

One or two of three: a plain `try/catch`, `try/finally` or `AbortController` is enough. Per-tick and per-frame code,
the sim, pure functions and size-sensitive bundles (a Worker) stay plain.

## Credits

Read at `main` on 2026-10-17. Paths are in each repo.

- **[Alchemy](https://github.com/alchemy-run/alchemy)** (`packages/alchemy/src/Hetzner/*.ts`, `Workflows.ts`, `Nuke.ts`):
  deploying cloud resources. Retry policy, polling for eventual consistency.
- **[T3 Code](https://github.com/pingdotgg/t3code)** (`apps/server/src/serverSettings.ts`, `serverOwnership.ts`,
  `serverRuntimeStartup.ts`, `storageCleanup.ts`): a long-lived local server. Shared state, locks, background workers.
- **[Executor](https://github.com/UsefulSoftwareCo/executor)** (`packages/core/sdk/src/errors.ts`): a typed error
  catalog that survives a process boundary.

Read these repos; do not file issues, PRs or comments on them.

## Patterns

### 1. Retry only the failure worth retrying (Alchemy)

A provider answers "Locked" while another operation is in flight. Retry that and nothing else; every other error
passes straight through.

```ts
const retryLocked = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.retry({ while: (e) => e._tag === "Locked", times: 8, schedule: backoff }));
```

Use for: any call to a third party (a webhook receiver, a connector API, a registry). A 5xx or timeout is retried; a
4xx is a bug in our request and is not.

### 2. Backoff is a value, defined once (Alchemy)

```ts
const backoff = Schedule.min([Schedule.exponential(Duration.millis(500), 1.5), Schedule.spaced(Duration.seconds(5))]);
```

Grows exponentially and never waits more than 5 s. Alchemy declares one per provider and reuses it across resources.
The policy sits beside the call, not inside it, so changing "6 tries" to "10 minutes" touches one line.

### 3. Wait for "really gone" by retrying a made-up error (Alchemy)

After a delete, the zone may still be listed. Fail with `ZoneStillExists`, retry while that tag comes back, then turn
the final failure into success:

```ts
getZoneBy(id).pipe(
  Effect.flatMap((zone) => (zone === undefined ? Effect.void : new ZoneStillExists({ idOrName: id }))),
  Effect.retry({ while: (e) => e._tag === "ZoneStillExists", times: 8, schedule: backoff }),
  Effect.catchTag("ZoneStillExists", () => Effect.void),
);
```

Use for: anything eventually consistent (a DNS record, a deploy going live, a queue draining).

### 4. Absence is a tagged error, not a null (Alchemy)

`Effect.catchTag("NotFound", () => Effect.succeed(undefined))` makes "it does not exist" a normal outcome at the one
place that cares, and an error everywhere else.

### 5. One writer at a time: `Ref` plus `Semaphore` (T3 Code)

Settings live in a `Ref`; every write is read, patch, normalize, set under `Semaphore.make(1)`:

```ts
writeSemaphore.withPermits(1)(
  Ref.get(ref).pipe(Effect.flatMap(update), Effect.flatMap(normalize), Effect.tap((next) => Ref.set(ref, next))),
);
```

Two concurrent writes cannot interleave. Use for: per-connector state on a long-lived host (a token refresh that two
events could race on). Not for a Worker, where each request is its own isolate and D1 is the lock.

### 6. Changes as a stream: `PubSub` (T3 Code)

A `PubSub.unbounded` publishes each settings change, and `Stream.fromPubSub` hands subscribers a stream. One source of
truth, many listeners, no polling.

### 7. A lock that releases itself: `acquireRelease` (T3 Code)

`serverOwnership.ts` takes an exclusive SQLite lock inside `Effect.acquireRelease`. The lock is dropped when the scope
closes, however it closes, and the failure type separates "already running" from every other error. Use for: PID files,
single-instance locks, temp dirs, anything with a matching undo. This is what `spawnScoped` in `packages/cli` is for.

### 8. Background workers tied to the host's life: `forkScoped` and `Schedule.spaced` (T3 Code)

`Effect.forkScoped(worker)` ends the worker when the host's scope ends. A cleanup job is
`Effect.repeat(Schedule.spaced("1 hour"))`. No orphaned timers after shutdown.

### 9. A catalog of typed errors that crosses processes (Executor)

About 15 `Schema.TaggedErrorClass` errors (`ToolNotFoundError`, `ToolBlockedError`, `ConnectionNotFoundError`).
Because they are Schemas they serialize over a wire and arrive typed on the other side. A new failure you forget to
handle is a compile error, not a silent `catch {}`.

### 10. Give errors a `message` (Executor)

A schema error's `message` is empty by default, so spans, `Cause.pretty` and logs show a blank failure. Executor adds a
getter derived from the fields, and says why in a comment:

```ts
override get message() { return `Tool not found: ${this.address}`; }
```

Do this for every error that can reach a log.

## Rulings

1. **Edges only.** Effect wraps the call out and the cleanup. The pure mapping inside stays a plain function that
   never imports `effect`.
2. **Durability is not Effect's job.** Where a queue and a database row already keep work from being lost (the Cloudflare
   `HOOKS` queue and D1 deliveries in qCRM), Effect does not replace them. It names the failures inside one run.
3. **Name every failure, then decide.** Define tagged errors first (`Transient`, `RateLimited`, `Permanent`), then one
   policy block that retries the first, waits on the second and parks the third. No path ends in a dropped event.
4. **Backoff constants live next to the client**, one per provider, not copied per call.
5. **Retry with `while`, never blind.** A retry without a tag check retries bugs.
6. **State on a long-lived host: `Ref` plus `Semaphore`. State on a Worker: D1.** Do not carry host patterns into a
   Worker.
7. **Undo with `acquireRelease` or `Effect.scoped`**, not nested `try/catch`, once a flow has more than one step that
   needs undoing ("create the customer, then the subscription; delete the customer if the subscription fails").
8. **Every error that can be logged has a `message`.**
9. **Keep it out of Workers unless it earns its bytes.** qCRM's webhook sender is plain code on purpose: the queue
   gives it retries, backoff and a dead state. See the third-party relay below for where that would change.
10. **Plain beats Effect when plain fits.** One `fetch` and one `Bun.spawnSync` in a script is not an Effect.

## Example: relaying one third party to another

PayPal calls us; we call a second service. Receive, verify the signature, dedupe on the provider's event id, write to
D1, enqueue and answer 200: all plain. The queue consumer that calls the second service is where Effect fits:

```ts
class Transient extends Schema.TaggedError<Transient>()("Transient", { status: Schema.Number }) {}
class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", { retryAfter: Schema.Number }) {}
class Permanent extends Schema.TaggedError<Permanent>()("Permanent", { status: Schema.Number }) {}

const relay = (evt: Event) =>
  call(evt).pipe(                                         // sends idempotency-key: evt.id
    Effect.retry({ while: (e) => e._tag === "Transient", schedule: backoff, times: 6 }),
    Effect.catchTag("RateLimited", (e) => Effect.sleep(`${e.retryAfter} seconds`).pipe(Effect.andThen(call(evt)))),
    Effect.catchTag("Permanent", (e) => markDead(evt.id, e.status)),   // alert, no retry
    Effect.catchTag("Transient", () => requeue(evt.id)),               // out of tries: back to the queue
  );
```

The idempotency key is what makes a retry safe. The row in D1 is what keeps the event from being lost.

## Where it fits here: the survey (2026-11-22)

Read across `apps/`, `packages/` and `scripts/` for hand-rolled cleanup, retries, signal handlers, locks and background
loops. Effect is in use today in `packages/cli` (`runScoped`, `spawnScoped`, the error catalog), codeSplitter's CLI and
client, and `packages/shell-bun`'s scheduler. Ranked by what a failure costs now:

| Where | What it hand-rolls | Fit | Status |
| --- | --- | --- | --- |
| `packages/cli/src/containers.ts` (`containers run`, `smoke`) | `docker rm` on SIGINT only; SIGTERM or an error left containers, a network and a temp dir behind | all three tests; Effect already in the package | done: `runScoped` + `acquireRelease` |
| `scripts/remote-ci.ts` `attempt()` (the builder client every agent's tests go through) | slot lock given back by hand from `once`/`off` signal handlers and a `finally`, a `setInterval` heartbeat, a retry loop on `LOST`, `setTimeout` kills on push and ssh | all three: patterns 3, 7, 8; `LOST` and `PUSH_FAILED` become tagged errors | done ([#5736](https://github.com/QuinnsCode/RustyBuns/issues/5736)): `scripts/remote-ci-run.ts`, loaded by a dynamic import from `main`, takes `effect` through `packages/cli/src/lifecycle.ts`'s re-export (root `scripts/` can't resolve it) |
| `apps/agent-office/scripts/mama.ts` and `dev.ts` | two copies of one supervisor: keep a child alive, crash backoff that resets after 60 s up, SIGTERM then SIGKILL | patterns 2, 7, 8 as one `supervise` beside `spawnScoped` | [#5737](https://github.com/QuinnsCode/RustyBuns/issues/5737): agent-office has no `effect` dependency, and `stopChild`'s grace logic is the piece to share either way |
| `apps/agent-office/live/*` (ci-loop, reaper, storage, github, brawl, overlap), `triage`, `train` | eight "every N ms, one round" loops; some guard against overlap, ci-loop and reaper don't | **plain**: one `every(ms, round)` helper (no overlap, catch and log, `unref`, a stop) is enough; ruling 10 | [#5738](https://github.com/QuinnsCode/RustyBuns/issues/5738) |
| `apps/codesplitter/src/agent-run.ts` | an agent round: abort signal, `Interrupted`, retry on 409 | fits ("agent runs"), but it is the largest flow and already names its failures | later, as its own change |
| `apps/codesplitter/src/git.ts`, `levels.ts`, other Worker code | retry loops | **plain**: Worker code (ruling 9) | stays |
| `packages/shell-bun/src/bindings/workflow.ts` | step retries with backoff | **plain**: it copies Cloudflare Workflows' own retry rules | stays |
| Game sims, `for (let tries...)` placement loops, page sockets | seeded placement tries; `connectSocket` covers sockets | not Effect | stays |
