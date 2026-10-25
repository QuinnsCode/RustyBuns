# Wasp and RWSDK: how close are they to Rusty Buns?

Read from wasp.sh/docs and docs.rwsdk.com on 2026-10-25. Neither page was exhaustive (Wasp's deploy page names no
Fly or Railway; RWSDK's hosting page wasn't read), so treat the gaps as "not found", not "absent".

## One line each

- **Wasp**: a full-stack framework with its own spec file (`main.wasp.ts`) that a compiler turns into a React client,
  a Node/Express server and a Prisma database. You write your app *in* Wasp.
- **RWSDK** (RedwoodSDK): a React framework for Cloudflare, shipped as a Vite plugin. SSR, React Server Components,
  server functions, a standards-based router, Durable Objects, D1, R2, Queues, with Miniflare for local dev.
- **Rusty Buns**: a tool you add *beside* an existing app. One config packs it as a desktop binary, a Cloudflare
  Worker and a Linux server, by giving every Cloudflare binding a local twin on Bun and sqlite.

## Against Rusty Buns

| | Wasp | RWSDK | Rusty Buns |
|---|---|---|---|
| What it is | App framework plus compiler | App framework (Vite plugin) | Packaging and runtime layer under a framework |
| Do you write your app in it? | Yes (spec, operations, auth) | Yes (routes, RSC, server functions) | No: dev dependency, never edits `src/` |
| Backend runtime | Node, Express | Cloudflare Workers | Worker on Cloudflare, Bun elsewhere |
| Data | Prisma, Postgres | D1, R2, Durable Objects, Queues | The same D1/KV/R2/DO, on sqlite locally |
| Targets | Docker, `wasp deploy`, self-host, static CDN for the client | Cloudflare (local via Miniflare) | Desktop binary, Cloudflare, Hetzner, Railway |
| Desktop binary | Not found | No | Yes |
| Cloudflare Workers | Not found (CDN for the client only) | Yes, the whole point | Yes |
| Auth, email, jobs | Built in | Built in or experimental | Left to your framework; identity is one of five primitives |
| Lock-in | High (Wasp spec and generated code) | Medium (the framework's APIs) | Low by design: `git rm` |

## How close

**RWSDK: adjacent, and a friend.** It is not a competitor, it is an input. RWSDK apps are the app shape Rusty Buns was
first built to box (Druids Curse), and we shim `cloudflare:workers` and `rwsdk/worker` so 153 of 180 public RWSDK apps
boot unchanged ([coverage](../FRAMEWORK_COVERAGE.md#rwsdk)). What they share: Cloudflare-shaped primitives. Where they
differ: RWSDK stops at Cloudflare and Miniflare; we take the same app to a desktop file and a rented box. Overlap is
the local-dev story (Miniflare vs. our Bun twins). If RWSDK ever shipped a first-class non-Cloudflare host, that
would be the one real threat to the "run it anywhere" claim.

**Wasp: same ambition, opposite method.** Both say "describe the app once, get the deployable parts generated", and
both sell "no vendor glue to write". But Wasp is a language-level framework that owns your app's structure and picks
Node, Prisma and Postgres for you; Rusty Buns owns nothing of your code and picks the Cloudflare shape as the standard.
Wasp has no Cloudflare Workers or desktop target that we found, and RWSDK-style Durable Objects have no Wasp analogue.
A Wasp app is not something `init` can read today (no `wrangler.jsonc`, Express plus Prisma), so there is no
integration path short of a Node/Prisma shim, which is a different product.

## Things worth taking

- Wasp's batteries (auth UI, jobs, email, type-safe client calls) are the part of "full-stack" Rusty Buns
  deliberately leaves to the framework. The five-primitives page could say so plainly.
- Wasp ships a single typed spec with a compiler checking it; our `rustybuns.config.ts` is the same idea for deploy only.
- RWSDK's Queues, Cron and Email are bindings we should check the local twin of ([FRAMEWORKS.md](../FRAMEWORKS.md)).

## Addendum: ElysiaJS

Read from elysiajs.com on 2026-10-25.

- **What it is**: a backend framework built for Bun, with types inferred from code (TypeBox, or Zod, Valibot and ArkType
  through Standard Schema), an Eden client that reuses server types with no codegen, and plugins (OpenAPI, JWT, CORS,
  Cron, WebSocket).
- **Runtime**: Bun first, but WinterTC-compliant, so it is a `fetch` handler that also runs on Node, Deno, Vercel and
  Cloudflare Workers.
- **Workers**: an experimental `CloudflareAdapter` plus `.compile()`. Bindings come from the `cloudflare:workers` import.
  No `fs`, so `Elysia.file`, the Static plugin and OpenAPI type generation don't work there. WebSocket and Durable Objects
  aren't covered on that page.
- **Against Rusty Buns**: a server framework we would sit under, like Hono. It answers the Wasp question the other way:
  an Express-free backend that already runs on Bun, on Workers, and as a `fetch` handler, which is the shape `init`
  mounts today (ADOPTION: "a Node backend ... mount it as the `fetch` handler"). Its Cloudflare path uses the same
  `cloudflare:workers` import that we shim, so a bound Elysia app should box with little work.
- **Not checked**: no Elysia app was run through `init`, and FRAMEWORK_COVERAGE has no Elysia row.

## Not done

No code was run against either framework. A trial of Wasp apps through `scripts/trial-github.ts` would settle
"can we box a Wasp app" with numbers; it needs a Node/Prisma-on-Bun story first, so it is not filed as a task.
