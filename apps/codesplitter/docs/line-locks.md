# Line locks: many agents, one file

A design doc, not a feature. The question: what line-locking model should codeSplitter use so many agents can edit one file at once without clobbering each other, in every setup it runs in?

**Short answer:** keep optimistic edits as the floor. Turn the claims the file Durable Object already has into short, renewable **leases** that every surface can reach. Then add an opt-in **queue** behind a lease and a **word-level rebase** for stale edits. Don't build CRDT or OT.

## 1. How editing works today

| Piece | What it does | Where |
|---|---|---|
| Line id | `L<n>`, minted by the file on insert and never reused. Ops name lines by id, never index | `src/lines.ts` `step` |
| Line rev | The file rev at which the line was last written. `set` and `delete` carry it as `base` | `Line.rev`, `Op.base` |
| File rev | One counter per file, +1 per applied op. `ifRev` pins a whole batch to it | `apply(…, ifRev)` |
| Batch | All or nothing: one stale op fails the batch with a **409** listing `{index, reason}` | `apply`, `POST do/ops`, socket `nack` |
| Retry | A CLI agent diffs its text against its snapshot (`diffToOps`), drops ops whose line moved (`rebase`), posts the rest, and re-runs with "someone changed these lines" in its prompt | `src/sync.ts`, `src/agent-run.ts`, `harness.ts` `taskPrompt` |
| Branch | First touch forks main's file DO into a branch DO, every id and rev intact | `src/branches.ts`, DO `fork` |
| Merge | Three-way by line id, applied by main's DO as one batch with one author per op. Claims don't apply to it | `merge` in `lines.ts`, `edit(by: string[])` |
| **Claims (already here)** | `POST do/claims {id?, lines, task?, ttl?, release?}`. A line is in at most one claim, and an edit to another's claimed line is a 409 with `claim` and `held by @who: task`. An agent's claim lapses after 30 min; a person's hold has no TTL. The holder's inserts inside the claim join it, and deleted lines leave it. Any crew member can lift any claim. Changes go out over the socket as `claim`/`unclaim` | `src/file-do.ts` `Claim`, `claim`, `held`, `follow` |

**Optimistic vs serialized.** Each file is one Durable Object, the only writer for that file. `held()` and `apply()` run synchronously on the in-memory doc, so two edits never interleave: **within a file, edits are totally ordered**, and conflicts are detected rather than prevented. Nothing serializes **across files**: a cross-file rename is N independent batches. Branches are optimistic too, and their conflicts surface at merge.

**Gaps in today's claims:**

| Gap | Effect |
|---|---|
| Not in `openapi.ts` or the palette | No MCP tool, no CLI command (both are generated from the spec) and no WebMCP tool. Only `agent-run.ts` and the file page's Hold button use claims |
| Lazy expiry | A lapsed claim stops blocking right away (`held` checks `until`), but `unclaim` only goes out when someone next reads claims. Pages show a ghost hold |
| 30 min TTL, no heartbeat | A crashed hosted run blocks its lines for up to 30 min. A long run silently loses its claim at 30 min |
| `held` conflicts are dropped | `taskPrompt` skips them and the run gives up on those lines. Nothing says "wait" or "work elsewhere" |
| `edit_lines` 409 has no `retryAfter` | An agent has nothing to pace its retry by |

## 2. Candidate models

| Model | Latency | Fairness | Deadlock / starvation | Agent crashes holding one | DO cost |
|---|---|---|---|---|---|
| **A. Pure optimistic** (today without claims) | Best: one round trip | Fastest writer wins. A slow agent on a hot line can lose forever | No deadlock. **Starvation** on hot lines: an LLM's think time (10–60 s) is much longer than a human's keystroke | Nothing held | 1 request, 1 row written per op |
| **B. Lease on lines/range, TTL + heartbeat** (today's claims, finished) | One extra round trip to claim, then normal edits | First claimer wins; others get 409 with the holder and `until` | No deadlock while claims never *wait* (claim is try-once, all or nothing). Starvation if one agent keeps renewing; cap total lease age | Lapses at TTL (proposed 2 min, renewed by each edit) | 1 row per claim/renew. Renewing on edit adds none. Alarm: 1 row per `setAlarm` |
| **C. Per-line edit queue** (wait in line, granted in order) | Waiters block for the holder's whole task | FIFO: best fairness | **Deadlock** if an agent waits on file 2 while holding file 1 and another does the reverse; needs no-wait-across-files or a wait timeout. Starvation gone within a file | Holder lapses at TTL, then the next waiter gets a short grant window, so a dead waiter can't block either | Wait over hibernatable WebSocket: ~free. A request held open keeps the DO awake (duration billed). An alarm per grant window |
| **D. Intent / reservation** ("rewriting 40–80") | None: advisory | Social, not enforced | None | Shown until TTL. Harmless | 1 row per intent |
| **E. CRDT / OT inside a line** | Best: never rejected | Everyone's keystrokes land | None | Nothing held | More ops per edit, bigger log, and the 2,000-op snapshot cadence fires sooner |

What each model means for **code**:

| Model | Fits code? |
|---|---|
| A | Yes for scattered edits; poor for "rewrite this function" by two agents (the second redoes its work) |
| B | Yes: an agent rewriting a block owns it, and people see it on the page |
| C | Useful when an agent's task *needs* the held lines. Otherwise "work elsewhere" is better than waiting |
| D | Cheap coordination for planners and humans; a soft form of B |
| E | **No.** Interleaving two agents' characters in one line of code yields text neither wrote and that may not parse. The line-id model already gets CRDT's main win (stable identity) at line granularity. A narrow cousin is worth it: on a stale `set`, try `mergeWords(base, theirs, mine)` (already in `lines.ts` for merges) and land it when the words don't overlap |

## 3. Runtimes

Found in code: `rustybuns.config.ts` targets, `@rustybuns/shell-bun` bindings, `src/local.ts`.

| Runtime | How it runs | File DO storage | Single-threaded? | Eviction / restart | Clock | Alarms |
|---|---|---|---|---|---|---|
| **Cloudflare** (`targets.edge`) | Worker plus SQLite-backed `FileDurableObject`, one per file and per branch copy | DO KV API on SQLite. `claim:<id>` keys | Yes, with input gates | Evicted when idle (hibernates with sockets). Constructor re-reads `claim:*` in `blockConcurrencyWhile` | `Date.now()` advances only across I/O; fine at second scale. One DO, one clock | Durable; survive eviction. Billed: 1 request plus 1 row per `setAlarm` |
| **Desktop** (`targets.desktop`, `bun run desktop`) | One Bun process, `durableObject()` twin | `~/.codesplitters/do_FILES_<id>.sqlite`, the same keys | Yes: the twin emulates the input gate | Never evicts. Restart = all instances rebuilt from sqlite | Machine clock. Sleep or clock jumps can expire leases early or late | **setTimeout only: lost on restart.** Re-arm from stored `until` in the constructor |
| **Box** (`targets.box`, Hetzner or Railway: "the same Bun host the desktop build uses") | Not declared in codeSplitter's config today; the self-hosted server mode would be this | sqlite on a volume, as desktop | Yes, **if one process**. Two replicas on one volume would be two writers per file: unsupported | Railway sleeps when idle; `memMaxMb` restarts on purpose. Same as desktop restart | Server clock (NTP) | As desktop |
| **Phone / tunnel** | `tailscale serve` or Cloudflare Tunnel in front of the desktop | The desktop's | The desktop's | The desktop's | The desktop's | The desktop's |
| **Tests / `agents.ts` demo** (`src/local.ts`) | In-process, `d1(":memory:")` | `memoryStorage()` | Yes | `namespace.evict(id)` simulates CF eviction | Test clock | setTimeout |

**Where lock state lives:** in the file's DO, everywhere. It's already per file, already the serialization point, and already persisted as `claim:<id>`. D1 is the wrong home: every edit would make a second round trip, and D1 isn't in the edit's critical section. Keep one rule: **TTLs are durations sent by clients; `until` is computed by the DO from its own clock.** That way client clock skew never matters, in any runtime.

**Branches:** a branch DO is its own file with its own lines, so locks on main don't need to fork. Agent runs on a branch already claim **main's** lines (`agent-run.ts` `onMain`) so people stay off them. Keep that. The fork must not copy `claim:*` (today it doesn't).

## 4. How locks reach agents

| Surface | Today | Proposed |
|---|---|---|
| REST | `GET/POST do/claims`, not in the spec | In `openapi.ts`: `list_claims`, `claim_lines`, `release_claim`, and `claim` on `edit_lines` |
| MCP (`/api/mcp`) | No claim tools | Generated from the spec, no new code. `release_claim` stays not destructive (it's the agent's own); lifting someone else's is marked risky |
| CLI (`codesplitter tools`) | None | Generated from the spec as well |
| WebMCP | None: Hold is a file-page button (`#hold`), not a palette command, so no browser tool | "Hold selected lines" and "Lift claim" as palette commands, so WebMCP gets them. Waiting is socket-driven: the page already gets `claim`/`unclaim` |
| Hosted / local CLI agents (`agent-run.ts`) | Claim the given lines for the run, release in `finally` | Same, plus renew on each edit and a heartbeat while the CLI thinks |
| Live socket | `claim` / `unclaim` broadcast | Adds `grant` for queue waiters, and `unclaim` on expiry from the alarm |

**What an agent sees when a line is held** (`edit_lines` or `claim_lines` 409):

```json
{ "conflicts": [{ "index": 0, "reason": "held by @agent-codex: rename parseArgs", "claim": "run-abc" }],
  "claims": [{ "id": "run-abc", "who": "agent-codex", "task": "rename parseArgs", "until": 1760000000000, "lines": ["L40", "…"] }],
  "retryAfter": 95 }
```

The tool description tells the agent what to do, in order: **work elsewhere** (other lines, then come back); **queue** (`claim_lines {wait: true}` returns a place in line, from Phase 2); or **ask** (a person can lift the claim). An agent never busy-polls: it waits at least `retryAfter`.

## 5. Recommendation

**B as the backbone, A as the floor, D as a flavor of B, C opt-in, a narrow E (word rebase) and no full CRDT.**

| Decision | Why |
|---|---|
| Keep optimistic revs on every op | It's the safety net when nobody claims, and it's what makes leases non-fatal when they lapse |
| Leases default to 2 min for agents, renewed by any edit carrying `claim`, plus an explicit renew | A crashed agent frees lines in about 2 min instead of 30. Renew-on-edit costs no extra writes |
| Cap a lease's total age (e.g. 30 min) unless a person extends it | Stops one agent from starving the rest |
| Claims never block across files | No cross-file hold-and-wait, so no deadlock. Queues are per file, and a waiter that holds claims in another file is refused `wait` |
| Expiry via DO alarm at the earliest `until`, re-armed in the constructor | Proactive `unclaim` broadcast. Works on CF (durable alarm) and on desktop and box (setTimeout re-armed after restart) |
| Intent = `claim {soft: true}`: shown and listed, but edits aren't refused | Planner agents and people announce work without blocking |
| Person holds stay TTL-less | Unchanged: people steer agents |

**Cost on Cloudflare** (Workers Paid, priced 2026-10-12 from [Cloudflare's DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)): rows written $1.00 per million after 50M, requests $0.15 per million after 1M, WebSocket messages in at 20:1, and each alarm is 1 request plus 1 row. A lease's lifecycle is about 3 rows (claim, alarm, release), so 1M claims ≈ $3. A queue wait over the socket is ~free. A wait held as an open HTTP request keeps the DO awake (duration billed), so MCP and CLI waits are capped at about 20 s per call and then answer "still queued, place N".

## Phased plan

| Phase | Scope | Done when |
|---|---|---|
| **1. Leases everywhere** | Claims in `openapi.ts` (so MCP, CLI and the docs site get them). `claim` on `edit_lines`. 409 with `claims` and `retryAfter`. Renew on edit, 2 min agent default, total-age cap. Alarm expiry re-armed in the constructor. `agent-run` heartbeat. Held conflicts told to the agent ("work elsewhere") | Tests on the local twin: crash → lapse → `unclaim`, `evict()` mid-lease, restart re-arms, MCP tool list includes the claim ops |
| **2. Queue and intent** | `claim_lines {wait: true}`: FIFO per claim, socket `grant` with a 15 s grant window, MCP/CLI long-poll capped at 20 s, `soft: true` intents shown on the page, no `wait` while holding claims in another file | Two agents on one block take turns in order. A dead waiter is skipped after its grant window |
| **3. Word-level rebase** | On a stale `set`, read the base text from `op:<base>` and try `mergeWords`. Land it (blamed on the sender) when the words don't overlap, else 409 as now | Two agents changing different words of one line both land, with no retry |

Not planned: character-level CRDT or OT, cross-file transactions, and lock state in D1.
