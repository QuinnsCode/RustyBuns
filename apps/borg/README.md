# borg

> **What it proves:** the local twins behave like Cloudflare, not just look like it. One small Worker uses every binding once, and the same suite checks it on the desktop host and on a deploy. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

This is **slim borg**, the thin one. It isn't an app anyone uses: it's the test rig you run a change against.

| Check | What has to hold |
|---|---|
| `kv` | put, get, list by prefix, delete |
| `d1` | insert with bound values, read back |
| `d1-batch` | a batch is one transaction: a failing statement rolls back the ones before it |
| `r2` | put, get, head, list, delete |
| `do` | ten concurrent read-then-write requests to one object land as ten counts (the input gate); another id starts fresh |
| `ws` | a hibernating socket keeps its attachment and echoes |
| `queue` | a sent message reaches the consumer |

Every run uses fresh keys, so it's safe against a store that already has data in it.

`--limits` goes over each limit the edge documents, on purpose, and says whether the target refused (✓, as the edge does) or accepted (✗, looser):

| Limit | The edge's |
|---|---|
| `d1-params` | 100 bound parameters per query |
| `kv-key` | 512-byte keys |
| `queue-size` | 128 KB messages |
| `do-value` | 2 MB values in a SQLite-backed object |
| `memory` | 128 MB per isolate |
| `cpu` | 10 ms per request on the Free plan (30 s on Paid, so it passes there) |

The twins refuse the first four with the edge's message. The desktop and box hosts measure each request for the last two and answer the edge's 503 when it goes over: RSS growth past 128 MB, or CPU time past `worker.cpuMs` (`RB_CPU_MS` overrides it, so `RB_CPU_MS=10` tries the Free plan's). The local test runs with `RB_CPU_MS=250` and pins all six, so loosening a twin fails it.

## Run it

```sh
cd apps/borg
bun test test                        # builds the desktop and box hosts, runs every check on the local twins
bun borg.ts https://borg-slim.<you>.workers.dev   # the same checks against a deploy
bun borg.ts http://127.0.0.1:<port> --token <t>   # or against a desktop host you started
bun borg.ts <url> --limits                         # and go over each edge limit
```

`bun test test` is what CI runs on every PR that touches this app or `packages/`. It's free: nothing leaves the machine.

Every other example gets a lighter tier 1 too: [`scripts/boot.ts`](../../scripts/boot.ts) builds its dev host, boots it on the local twins and checks the token gate, the page and cross-origin isolation. CI runs it for each app with `boot: true` in `scripts/ci-apps.ts`.

To check the edge, `rustybuns plan` then `rustybuns deploy` from here, run `bun borg.ts` against the URL, and `rustybuns destroy` when it's done. Everything in the stack is billed by usage, and one run sits inside Cloudflare's free allowances; `plan` lists each resource first.

## The nightly edge run

[`borg-edge.yml`](../../.github/workflows/borg-edge.yml) is tier 2: nightly, on a PR labelled `borg`, or from the Actions tab, it plans, deploys, runs `bun borg.ts <url> --limits`, destroys, and puts the grid in the job summary. [`edge.ts`](edge.ts) holds its guard rails:

- **Cost cap, read from the plan.** `bun edge.ts cap plan.txt` refuses the deploy if any resource bills fixed, needs Workers Paid (`BORG_ALLOW_PAID=1` lets it), or the stack grew past six resources (`BORG_MAX_RESOURCES`).
- **Its own stage.** Each run deploys under `borg<unix seconds>`, so every resource it makes carries its start time, and `destroy` runs even when the checks fail.
- **A sweeper.** `bun edge.ts sweep` deletes any `borg-slim-*` resource from a run over an hour old, before and after each run; on the way out it also takes whatever this run's destroy left. `--dry-run` lists without deleting.

It's off until the owner sets the repo variable `BORG_EDGE=1` and creates the `borg-edge` environment with required reviewers and the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.

## Where it's going

Slim borg checks each primitive once. What's left for it: the edge run on a Free-plan account ([#865](https://github.com/QuinnsCode/RustyBuns/issues/865)). Two bigger rigs are planned:

- **thick borg** ([#856](https://github.com/QuinnsCode/RustyBuns/issues/856)): a decent-sized app per common migration story (keep the database and move the code, leave a PaaS for a box, go all-edge).
- **fatty borg** ([#857](https://github.com/QuinnsCode/RustyBuns/issues/857)): the chunky examples (codeSplitter, tscircuit-desktop, park-hide-seek, agent-office) run through build, deploy and teardown.
