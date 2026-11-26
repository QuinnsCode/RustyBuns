# Postgres in a Durable Object: the spike

> **What it asks:** can a preview's Postgres be a Durable Object instead of a Neon branch: made by its first
> request, branched with one call, gone with the stage, with no API key and no extra resources in the deploy?

Real Postgres 18.3 (PGlite 0.5.8, the same package the desktop twin uses) runs in a SQLite-backed Durable Object,
one per database name. It works in local workerd today. It doesn't deploy as is: see "Before it can go live".

## Run it

```sh
cd apps/borg-postgres
bun do/setup.ts                                        # PGlite's files, an empty cluster, the callback modules
(cd do && bunx wrangler@4.156.0 dev --port 8799)      # leave running
bun do/bench.ts                                        # seeds the template, then times five runs
```

Then `curl '127.0.0.1:8799/q?name=pr-12&sql=select%20version()'` makes database `pr-12` and asks it.
`/branch?name=pr-12-b&from=pr-12` copies one, `/restart?name=pr-12` throws the instance away as an eviction would.

## What it measured

Local workerd on the office Mac (M-series, 16 GB), 2026-11-24, five runs, milliseconds:

| Step | Median | Max |
|---|---|---|
| New database, first query | 315 | 571 |
| Warm query | 7 | 39 |
| 10k rows written and saved | 530 | 578 |
| After a restart (eviction, deploy), first query | 391 | 474 |
| Branch of a database holding 10k rows | 342 | 660 |

A saved database is 4.8 MB (gzip tarball of the data dir, mostly the empty cluster).

**With page saving (PageFS, #5866 step 2), 2026-11-26, same Mac, five runs:**

| Step | Median | Max |
|---|---|---|
| New database, first query | 683 | 785 |
| Warm query | 4 | 6 |
| 10k rows written and saved | 96 | 116 |
| One row written and saved (1 page) | 4 | 5 |
| After a restart, first query | 145 | 159 |
| Branch of a database holding 10k rows | 1226 | 1454 |

Writes now cost the pages they change, and a restart reads only the pages Postgres asks for. The price: a new
database or a branch unpacks the template's tarball into page rows (about 33 MB stored, uncompressed, against the
4.8 MB gzip dump), so it is about twice as slow to make and holds seven times the storage. The slimmed cluster
(step 1: no template0/template1, a 1 MB WAL segment) and copying page rows between DOs instead of a tarball are the fixes.
The Worker uploads at 5.7 MB gzip: under the paid plan's 10 MB, over the free plan's 3 MB.

**What a deploy does differently.** A Neon-backed stage (`origin: { neon }`) creates a Neon branch and a Hyperdrive
config at deploy and deletes both at destroy, behind `NEON_API_KEY`. Here a deploy creates nothing: the database is
made by the first request (about 0.3 s), a branch is one HTTP call, and `destroy` takes it with the DO namespace. No
secret, no Touch ID, no API calls for an agent to make or wait on. The cost moves into the Worker upload, which is
5.7 MB bigger on each deploy.

## What it costs

Durable Objects on Workers Paid ($5 a month already paid): requests $0.15 per million (1 million included),
duration $12.50 per million GB-s (400,000 GB-s included), SQLite storage $0.20 per GB-month (5 GB included).
Rates from Cloudflare's Durable Objects pricing page; check it before relying on them.

| Use | Per preview database |
|---|---|
| Storage, 5 MB | 1,000 of them fit in the included 5 GB |
| Awake time, billed at 128 MB while it handles requests (asleep when idle) | 1 hour of use = 450 GB-s; the included 400,000 GB-s cover about 890 hours a month |
| Requests | a busy preview's few thousand are lost in the included million |

So a preview database is $0 on the current plan unless previews run hundreds of active hours a month. Neon's free tier
(0.5 GB a project, 100 compute-hours a month, per `packages/cli/src/costs.ts`) is also $0 at this size. The gain isn't
the bill: it's no second vendor, no key, and a database that exists 0.3 s after you name it.

## How it works, and the three things workerd needed

- **No initdb in workerd.** Emscripten's `addFunction` compiles a tiny WASM module at runtime for each JS callback,
  and workerd forbids compiling WASM at runtime. So `setup.ts` runs initdb once in Bun and saves the empty cluster.
  The Worker keeps it in a `__template` DO (`POST /seed`), and every new database starts as a copy. A branch is the same copy, from another database.
- **Precompiled callbacks.** PGlite itself also uses `addFunction` (two trampolines). `setup.ts` records their bytes,
  the bundle ships them as `.wasm` modules, and `src/shim.ts` hands back the precompiled one when
  `new WebAssembly.Module(bytes)` asks for the same bytes.
- **No `nodejs_compat`, and a fixed `import.meta.url`.** With the flag, Emscripten takes its Node path and calls
  `process.binding`. Without it, it reads `self.location`, which the shim fills.

A failure inside PGlite (initdb, a refused compile) hung the request at 100% CPU instead of throwing. In production
the CPU limit would end it, but look for a hang first when this breaks.

## Before it can go live

1. **Memory.** Stock PGlite asks for 128 MB of WASM memory at start (smaller fails to link). That is a whole
   Durable Object's limit, before the JS heap. Live, it needs a PGlite built with a smaller initial memory (64 MB),
   which means an Emscripten build of PGlite from source.
2. **Saving.** Done: `src/pagefs.ts` keeps Postgres's 8 KB pages as DO SQLite rows (all-zero pages take no row),
   written in one `transactionSync` after each query, before the reply goes out. Tested in Bun over bun:sqlite
   (`test/pagefs.test.ts`) and run in local workerd by `bench.ts` (numbers above).
3. **How an app reaches it.** Apps here speak postgres.js over a URL (Hyperdrive on the edge, `pgliteHyperdrive` on
   the desktop). A DO database needs the wire protocol through a DO stub's TCP `connect()`, reusing `SessionQueue` from
   `packages/shell-bun/src/bindings/pglite.ts`, so app code stays the same.
4. **The binding.** A `hyperdrive` binding with an edge twin (the DO, in place of Neon) that the Alchemy stack emits
   instead of `Neon.Branch` plus `Hyperdrive`.

psql from outside (the demo's orange button) needs Spectrum to bring TCP in, priced separately. Previews don't need it.
