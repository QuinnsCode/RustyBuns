# Roadmap

Rusty Buns is the resolver between what an app needs and what a target provides.
The table is the product. Each cell is either a Bun shell adapter (ours) or an
Alchemy resource (theirs). Type inference for the cloud cells comes from
Alchemy's `InferEnv`; the desktop cell is checked against the same type.

## The matrix

**A** = Alchemy resource (theirs, typed via `InferEnv`) · **RB** = Rusty Buns shell adapter (ours, in-process) ·
✅ built/tested · 🟡 generated, unverified live · 🔍 provider exists, resource name to verify · 🔲 not started

| Need | Cloudflare | Hetzner | Fly | Railway | Desktop |
|---|---|---|---|---|---|
| http | A `Cloudflare.Worker` ✅ | A `Hetzner.Service` 🟡 | A 🔍 | A `Railway.Service` / `Function` (Bun) 🔍 | RB `serve()` ✅ |
| static | A Worker `assets` ✅ / `Website.*` | A `Hetzner.Website.*` 🔍 | A 🔍 | A 🔍 | RB `--asset` ✅ |
| ws / stateful | A `Cloudflare.DurableObject` 🟡 | RB in-process DO ✅ | RB in-process DO ✅ | RB in-process DO ✅ | RB in-process DO ✅ |
| sql | A `Cloudflare.D1` ✅ | RB sqlite on A `Hetzner.Volume` 🔲 · A `Neon`/`PlanetScale` 🔍 | A Neon/PlanetScale 🔍 | A Neon/PlanetScale/Railway PG 🔍 | RB sqlite D1 + migrations ✅ |
| kv | A `Cloudflare.KV` ✅ | RB sqlite table ✅ | RB sqlite table ✅ | RB sqlite table ✅ | RB sqlite table ✅ |
| blob | A `Cloudflare.R2` ✅ | RB dir on Volume 🔲 | 🔲 | 🔲 | RB dir adapter 🔲 |
| queues | A `Cloudflare.Queues` 🔲 | RB in-process 🔲 | 🔲 | 🔲 | RB in-process 🔲 |
| logs | A `Cloudflare.Pipelines` 🔲 · A `Axiom` 🔍 | A `Axiom` 🔍 | A `Axiom` 🔍 | A `Axiom` 🔍 | stdout ✅ |
| auth | framework + A `BetterAuth` 🔍 | A `BetterAuth` 🔍 | A `BetterAuth` 🔍 | A `BetterAuth` 🔍 | RB launch token ✅ |
| server actions | framework RSC ✅ | RB host RPC ✅ | RB host RPC ✅ | RB host RPC ✅ | RB host RPC ✅ |
| network / TLS | A domains, DNS, Tunnel 🔍 | A `LoadBalancer` + `Certificate` + DNS 🔍 | 🔍 | 🔍 | 127.0.0.1 ✅ |
| containers | A `Cloudflare.Container` 🔍 | A `Docker` provider 🔍 | 🔍 | 🔍 | n/a |
| native (ffi / sab) | never | RB ✅ | RB ✅ | RB ✅ | RB ✅ |
| CI | A `GitHub` provider 🔍 | same | same | same | n/a |

What this says: Alchemy covers every managed cell and the cross-cutting ones (SQL, auth, logs, CI,
containers) on every column. Rusty Buns owns the in-process runtime cells on VMs and the laptop,
which is the one thing an infra tool structurally cannot provide. The 🔍 cells are a docs pass,
not engineering.

## Happy path (in order)

1. `plan` against a throwaway Cloudflare account; fix the Worker/DO generator. Unblocks the whole edge column.
2. Verify `Hetzner.Service` runtime (Bun vs Node); pick Service or Server+cloud-init. Unblocks the box column.
3. Restructure `gen/` around the matrix above; Fly and Railway become columns, not copies.
4. R2 -> directory adapter; `pipeline` binding type (pass-through on edge, stdout elsewhere).
5. `rustybuns add worker <name>` / `add rust <name> --front|--back`: typed worker RPC over SAB, TS body by default, WASM or cdylib drop-in.
6. `rustybuns test`: E2E gate (desktop binary, local workerd via Alchemy's test harness, preview stage) run by `deploy`.
7. Desktop updater: version manifest, signed download, swap on next launch; protocol-version handshake guidance.
8. `rustybuns package`: .app/.dmg, .msi, AppImage; signing + notarization; CI matrix for Rust cdylibs.
9. Example app: Three.js scene, n-body in a worker over SAB, Rust/WASM drop-in, networked through the world. Deploys to every column.
10. `worker` desktop mode with a full `cloudflare:workers` shim, for frameworks whose server output targets Bun/Node (TanStack Start first).

## Not on the roadmap

Console targets, mobile, native menus/tray, pixel-identical rendering across browsers.
