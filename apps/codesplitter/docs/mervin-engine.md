# Mervin as a dual-use engine

Design note. Nothing here is built yet. Mervin ([mervin.md](mervin.md)) should run the same merge on a laptop
and on Cloudflare, with one core and thin hosts.

## Shape: one core, three hosts

```
            mervin-core            pure: text in, merge / plan / shadow out
           (src/lines.ts, merge-plan.ts; no I/O, no bindings)
          /          |            \
   local (Bun)   Worker (wasm or TS)   MervinDO (per repo)
   bun:ffi cdylib   same core            queue + overlap map + outcomes
```

- **Core** stays I/O-free. Today `lines.ts` / `merge-plan.ts` import only `smol-toml`, `yaml`, `policy`, `sync`
  and `lint`. Keep it that way; an import check in a test pins it, like the `openapi.ts` / `mcp-tools.ts` rule.
- **Local host** is a CLI / library (`mervin merge|plan|shadow`) over a working tree or bare repo. No network, no
  account. The scorecards (`mervin-score.ts`, `mervin-corpus.ts`) are already this host.
- **Worker host** calls the core for one request. CPU-heavy merges (3,000-line files, the `lint:tests` build) go to
  the sandbox, never inside the DO.
- **MervinDO** (one per repo, SQLite-backed) owns state and ordering only: a serialized merge queue, line-id sets
  of open PRs (so "PR A will fight PR B" is a lookup, updated on push), and settled hunks / card outcomes for reuse.
  It calls the core through the Worker host.

## Rust / TS interop

The repo already has the pattern; Mervin follows it instead of inventing one:

1. A `mervin` crate in `native/crates/` builds as a `cdylib` for `bun:ffi` and, behind the `wasm` feature, for
   Workers (`rb_hello` shows both).
2. `@rustybuns/native`'s `loadNative("mervin", ...)` returns `null` when no library is present. `null` is a
   capability signal: the TS core runs. The Rust port is an accelerator, never a requirement.
3. The TS core is the spec. A parity test runs both engines over the `mervin-corpus.ts` merges and fails on any
   difference in settled text. Port line-id diff and stretch-blend first (the hot path); leave yaml/toml/lint in TS
   and pass their results across the boundary.
4. Wire format: UTF-8 buffers in, one JSON blob out (merged text, conflicts, cards). No shared structs, so the same
   ABI serves ffi and wasm.

## Surface

One small API, served three ways (CLI, HTTP, MCP): `merge(base, ours, theirs, policy)`, `plan(prs)`,
`shadow(file, truth)`. Endpoint changes go through `src/openapi.ts` and `src/mcp-tools.ts`, which feed the docs site.

## Order of work

1. Pin core purity with a test; extract a `mervin` CLI over the existing scripts (local host, TS only).
2. `MervinDO` with the overlap map and `GET /plan`, behind a flag. Needs a wrangler migration and a deploy with
   `DEPLOYS=1 AGENTS=1 CHECKS=1`.
3. Rust `mervin` crate for line-id diff + stretch-blend, with the parity test.

## Learning store

Opt-in outcome events (no file contents) stream from the Worker host through a Pipeline into an Iceberg table
in R2 and are queried with R2 SQL, so the merge plan can learn what works for a repo. The core never reads it:
learning changes plan weights and which resolver levels are trusted, never the merge itself. Design in
[mervin.md](mervin.md#learning-your-merge-patterns-opt-in-not-built-yet).

## Constraints

- Contest: keep `main` working and the demo matching its video until October 21, 2026. Build on branches; step 2
  lands after that or stays flagged off.
- The DO must not run merges; it queues and remembers.
