# Oct 1 plans: Cloudflare Birthday Week 2026 -> Rusty Buns

Source: Cloudflare blog + Ashley Peacock's daily X summaries (days 1-4; day 5 not out when written).
Spike run in a scratchpad with `cf` 1.0.0-beta.11 and wrangler 4.146. Nothing in the repo was changed by the spike.

## Decisions

- Workers **Issues** is **opt-in**, never default (it ships stack traces and logs to a third-party agent).
- Unsupported bindings in `cloudflare.config.ts` **error**, naming the binding. No silent skipping.
- **K2** binding waits.

## Priority list

1. `cloudflare.config.ts` support in `init` and the stack generator (see below). Most likely thing to break migrated apps.
2. Opt-in `observability.issues.enabled` in the generated `wrangler.jsonc`.
3. Containers: legacy `Container` / `Sandbox` classes stop getting updates at end of 2026. Grep for use.
4. K2 binding (deferred). Would be the first new binding type; sqlite append-only table with lease-based polling as the local stand-in.
5. Test builds against Vite+ v1 and Vinext 1.0.
6. Watch: AI Gateway inference (AutoRouter), Workers KV Instant (private beta, same API, different pricing), Artifacts binding (open beta), Bun support for ML-KEM / ML-DSA (Workers Web Crypto now has them).

Not relevant: Basin, Clef models, Certificate Authority, Application Profiles, Threat Signals, Registrar, Forge, EmDash, KiteSurf, CloudflareOS, Pay Per Use / Monetization Gateway.

## cloudflare.config.ts support

### Why

`cf` CLI (open beta) introduces `cloudflare.config.ts`, a TypeScript replacement for `wrangler.jsonc`. `cf migrate` converts Vite-based Workers. Wrangler stays supported (reported 18 months after beta ends; the changelog gives no date, so unconfirmed).

Current gaps:
- `packages/cli/src/glue/infer.ts:105` only looks for `wrangler.jsonc|json|toml`.
- `packages/cli/src/index.ts:93-97` throws if none found, and throws on `.toml`.
- `parseWrangler` is `JSON.parse(stripJsonc(...))`, which cannot read executable TS.

### Spike findings

- Bun can evaluate the file: `import("./cloudflare.config.ts")` works, `cf/config` resolves from the app's `node_modules`, `defineConfig` returns plain data.
- Bindings come back as `{ type: "d1" | "kv" | "r2" | "text" | "durable-object" | "assets", ... }`.
- Function form `defineConfig(({ mode }) => ...)` is a function; call it with `mode: "production"`.
- `import * as entrypoint from "./x" with { type: "cf-worker" }` evaluates under Bun as a plain module namespace. That **runs the worker module** at config load and **loses the path**. Get `main` from existing `workerEntry` inference or by parsing the import specifier.
- `cf migrate` needs wrangler >= 4.100 locally; it picks Vite only if `@cloudflare/vite-plugin` is declared.
- `cf migrate` output is not finished: it writes `throw new Error("Migration incomplete...")` at the top and drops, with required follow-ups:
  - `assets.directory`
  - D1 `migrations_dir`
  - Durable Object binding review
  - DO migrations, replaced by `exports: { Room: exports.durableObject({ storage: "sqlite" }) }`
- Cloudflare's own migration (cloudflare-os PR #597) keeps a generated `wrangler.jsonc` beside `cloudflare.config.ts`, with unsupported settings in named `wrangler` and `migrations` exports. Both formats will coexist for a while.

Example `cf migrate` output shape:

```ts
import { bindings, defineConfig } from "cf/config";
export default defineConfig({
  worker: {
    name: "spike-app",
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "src/worker.ts",
    env: {
      API_URL: bindings.text("https://example.com"),
      DB: bindings.d1({ name: "spike-db", id: "abc" }),
      CACHE: bindings.kv({ id: "kvid" }),
      UPLOADS: bindings.r2({ name: "spike-uploads" }),
      ROOM: bindings.durableObject({ worker: "spike-app", exportName: "Room" }),
      ASSETS: bindings.assets(),
    },
  },
});
```

### Work, in order

1. **Reader** (`packages/cli/src/cloudflare-config.ts`, `cloudflareToConfig`, mirroring `wranglerToConfig`):
   - Evaluate in a **subprocess**, not in-process, so worker side effects cannot touch the CLI.
   - Call the function form with `mode: "production"`.
   - Map `d1`, `kv`, `r2`, `text`, `secret`, `durable-object`, `assets`; read `exports.durableObject({ storage: "sqlite" })` for sqlite DO classes.
   - Error, naming the binding, on `queue`, `ai`, `vectorize`, `worker` and anything unknown.
   - If evaluation throws "Migration incomplete", report it clearly and tell the user to finish the TODOs.
2. **Detection order:** `cloudflare.config.ts`, `wrangler.jsonc`, `wrangler.json`, `wrangler.toml`. Point toml users at `cf migrate`.
3. **D1 migrations dir and assets directory:** not in the TS file. Use the existing `migrations/` fallback in `init` plus `rustybuns.config.ts`.
4. **Issues flag:** opt-in `observability.issues.enabled: true` in the generated `wrangler.jsonc`, behind a `rustybuns.config.ts` option, default off.
5. **Generated `wrangler.jsonc`:** the "hand-written and differs" conflict logic must treat a generated file as expected when the source is `cloudflare.config.ts`.
6. **Tests** in `packages/cli/test/glue.test.ts`: happy path, function form, unsupported binding, incomplete-migration throw. Fixtures from the spike outputs above.

### Open decision

Durable Object sqlite declaration lives in `exports`, not a migrations list. Plan: read `exports.durableObject({ storage: "sqlite" })` when present; if absent, treat as KV-backed storage, matching how `wranglerToConfig` treats `new_classes` today.

## Sources

- https://blog.cloudflare.com/cloudflare-cf-cli-launch/
- https://developers.cloudflare.com/changelog/post/2026-09-28-cloudflare-cli-beta/
- https://github.com/cloudflare/cloudflare-os/pull/597
- https://blog.cloudflare.com/real-time-issue-detection/
- https://blog.cloudflare.com/cloudflare-k2-streams/
- https://blog.cloudflare.com/faster-agent-sandboxes/
- Ashley Peacock's Birthday Week day 1-4 threads on X (pasted by the user)
