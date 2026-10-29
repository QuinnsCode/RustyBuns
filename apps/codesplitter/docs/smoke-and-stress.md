# Smoke and stress testing without a bill

Three tiers, cheapest first. Each tier only runs when the one below is green.

`bun run smoke` (`scripts/smoke.ts`) is tiers 1 and 2 in one go, led by the security model in
[REFERENCE.md](../REFERENCE.md#the-security-model-your-code-your-app-your-provisioning-your-destruction): it runs
every test a promise cites (one `bun test --parallel`, read back from its JUnit report) and prints a row per promise,
then `scripts/stress.ts --paid-paths`. Exit 0 means every promise and every stress rule held.

## Tier 1: free, in-process (exists)

`bun run stress` (`scripts/stress.ts`, see [REFERENCE.md](../REFERENCE.md)) runs the whole app on the
local twins. Nothing leaves the machine. It covers every rule that costs nothing: repos, files,
branches, search, hooks, commits, line edits, rate limits, webhook fan-out and retries.

The tour has its own smoke run, in a real Chrome on the local twins: `bun scripts/tour-smoke.ts`. Nine checks per chapter, three for each way the
tour is driven (a person's buttons, autoplay, an agent's WebMCP tools). A chapter is a row in `CHAPTERS` in the script, so adding one is data:
- "Mervin and Ester queue it": the board, the merge waves, the red tests, and the merge that only a person presses.
- "Agents on one repo": claims, same-line, smart merges, rebase, hosted agents (a person's press) and agents that can't ship.
- "Your repo, your history": living lines, owning the git history, where git truth lives (a person's choice), a repo that builds itself, deploy anywhere.
- "Together, line by line": multiplayer, live editing, private lines (a person's choice).

It also checks that every feature id a step carries (`feat`) is on the strip (`features/order.txt`). Needs Chrome (`--chrome` for a path); about 90 s. `--only <chapter>` runs one chapter.
It is not in CI (no Chrome on the runner), so it is a manual run: [#1794](https://github.com/QuinnsCode/RustyBuns/issues/1794).

## Tier 2: the paid paths, with the paid part faked (hosted agents built, the rest to build)

`bun run stress --paid-paths` runs hosted agents against a counting `AGENT_SANDBOX` fake in three modes (ok, fails, garbage):
the site's `hosted` budget must start exactly 30 containers out of 55 asks, 429 the rest, and end every run.

The paid paths are each behind one seam, so a stress run can hit the real route, queue, lock and
budget code and swap only the thing that bills:

| Path | Billed thing | Seam to fake | What to assert |
| --- | --- | --- | --- |
| Hosted agents | container-seconds, model tokens | `AGENT_SANDBOX` binding (`src/sandbox.ts`) | `max_instances` queueing, budget cut-off (`src/budget.ts`), egress list per run |
| Deploys | container-seconds, Workers deploys | `DEPLOY_RUNNER` (`src/deploy-runner.ts`) | one deploy per repo at a time, a failed run books a result, nothing runs without a key |
| Checks | container-seconds | `CI_RUNNER` (`src/ci-runner.ts`); `localMachine()` already runs them on the desk | queue drains, timeouts fire, a dead machine is retried once |
| Search | Workers AI embeds, Vectorize reads | `AI` stub returning fixed vectors | fan-out count per query stays at the cap of 10 |
| News watch | Anthropic tokens | `fetcher(env)` in `src/watch.ts` | `WATCH_NEWS` off means zero calls; on means at most one per day |

Rules for the fakes:

- The fake counts calls and fails the run if a call exceeds a ceiling, so a fan-out bug shows up as
  a test failure, not an invoice.
- Fakes sleep for a realistic time (seconds, not ms) in one dedicated "slow" mode, so queueing and
  timeouts are actually exercised.
- Each fake can be told to fail, hang or answer garbage.

Cost of a run: nothing. The rest go in `scripts/stress.ts` as more sections behind `--paid-paths`.

## Tier 3: live smoke, tiny and capped (manual, owner-run)

One real run per paid path, on a throwaway repo, to prove the fakes still match reality. Before it:

1. Price it first and write the number in the PR. A basic container for a minute is cents.
2. Cheapest model, a short prompt, `max_tokens` low, and the run budget in `src/budget.ts` set tiny.
3. `max_instances` is already 1 to 2 in `wrangler.jsonc`; leave it.
4. Deploy with only the flag under test (`CODESPLITTER_AGENTS=1`, `..._DEPLOYS=1`, `..._CHECKS=1`), on the
   test account, with secrets through varlock. Agents do not fetch them, so the owner runs the deploy.
5. Count requests per run (a cron or webhook that fans out multiplies cost), run it once, read the
   Cloudflare and Anthropic usage pages, then destroy the resources.

Never load-test tier 3. Load goes through tier 2.

## Load numbers to watch

- 429 rate on each limited rule equals `requests - cap`, never a 5xx.
- Per-request fan-out: Durable Object calls, D1 queries, outbound fetches. Log them in the fake and
  fail on a rise.
- Queue depth and drain time for agents, deploys and checks at 10x `max_instances`.
