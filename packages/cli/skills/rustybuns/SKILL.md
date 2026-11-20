---
name: rustybuns
description: Build, run and ship an app with Rusty Buns (rustybuns.config.ts, the rustybuns CLI, @rustybuns/* packages). Use when adding a feature, a binding, a deploy target or a desktop build to a Rusty Buns app.
---

# Building with Rusty Buns

Rusty Buns is a dev dependency. It reads the app you have, and from one file (`rustybuns.config.ts`) it makes a
desktop binary, a Cloudflare Worker and a Linux box. Your `src/` stays yours: Rusty Buns writes only
`.rustybuns/`, `wrangler.jsonc` and the config.

## The loop

| Step | Command | Notes |
|---|---|---|
| Start | `rustybuns init` | Reads `package.json`, vite config, wrangler. Writes the config. `--spa` for desktop-only. |
| Change the config | edit `rustybuns.config.ts`, then `rustybuns generate` | Never edit `.rustybuns/` or a generated `wrangler.jsonc` by hand. |
| Run locally | `rustybuns dev` (edge) or `rustybuns run desktop` | The local twin of each binding is sqlite or a folder: no account needed. |
| See the stack | `rustybuns infra` | From the config alone, no login. |
| Price and check | `rustybuns plan` | Always before `deploy`. `deploy` refuses without a plan for this exact config. |
| Ship | `rustybuns deploy` | Cloudflare, plus a Hetzner or Railway box if the config has one. |
| Desktop file | `rustybuns build desktop` | One file in `dist/`. `--dev` to bundle without compiling. |
| Does it run? | `rustybuns smoke [dir]` | Installs, inits, builds and boots a throwaway copy. |
| Stuck | `rustybuns triage` | Starts your agent with this machine's facts. |

`rustybuns help` lists every command. Every command checks the config on load and names the bad field.

## The five primitives

Write against the Cloudflare shape; each has a local twin, so the same code runs on the desktop and the box.

- **HTTP**: a Workers `fetch(request, env, ctx)` handler (Hono, RWSDK or plain fetch all fit).
- **SQL**: D1 (`{ type: "d1", migrationsDir }`). sqlite locally. Number migrations in order, never edit a shipped one.
- **KV and files**: KV and R2.
- **Rooms**: a Durable Object per room, game or document, with its sockets.
- **Secrets**: `{ type: "secret" }`. Values come from a secret manager at deploy time (varlock), never from a
  shell export, never in the repo, never printed.

Put `protect: true` on a database, bucket or room that holds data people care about; `destroy` keeps it.

## Code habits

- **Check what comes in.** A request body, fetch reply, socket message or stored string is `unknown` until a
  guard reads it. Guards are in `@rustybuns/util/guard` (`obj`, `str`, `num`, `int`, `oneOf`, `arr`, `opt`,
  `or`); the type comes from the guard (`type Msg = Of<typeof Msg>`). No `as { ... }`, no `any`. Put the guard
  in a file both server and page import, have the server write `json(x satisfies Reply)`, and read it with
  `getJson(url, Reply)` / `readJson(req, Body)` from `@rustybuns/util/http`. Test the wrong shape.
- **Things are functions.** An operation (name, input, permission, `run`) lives in one place. A route, an MCP
  tool, a page's Cmd+K and a CLI command call it; they hold no rules. Check permission inside the operation too.
- **Import before you write.** `@rustybuns/util` has `clamp`, `lerp`, `esc`, seeded randoms (`mulberry32`),
  `json` replies, the socket client (`connectSocket` in `/socket`), room fan-out (`Sockets` in `/room`), rate
  limits (`/limits`) and bytes and hashes (`/bytes`). Grep before adding a helper; if one exists twice, keep one.
- **Effects at the edges.** Use Effect (or plain `try/finally`, `AbortController`) where something must be
  cleaned up, cancelled or retried: processes, sockets, saves, deploys. Keep it out of per-frame code and pure logic.
- **TypeScript wide, Rust deep.** Start in TypeScript. Move only a measured hot path (audio, physics, geometry) to
  Rust via `@rustybuns/native`; keep a TypeScript twin that gives the same answer and test the two against each
  other, so the app still runs when Rust can't load.
- **Give the page a handle.** A game or tool puts `window.<name>.state()` (and a few verbs) on the page, so an
  agent reads numbers instead of screenshots.

## Tests

- One journey through the running app per feature; units only for real corner cases (parsers, limits).
- Test what the code does, never its source text (`expect(html).toContain(...)` breaks on every refactor).
- A fix's test must fail on the old code.
- Run the test files you changed, not the whole suite; CI runs the rest.

## Safety

- `plan` before `deploy`, and read its `[KEPT]` / `[REMOVED]` list. Ask before any `destroy`.
- Pick the smallest resources and say what a new one costs before adding it.
- Don't read `.env*` (other than `.env.schema` / `.env.example`) or print the environment.

More: the repo's [REFERENCE.md](https://github.com/QuinnsCode/RustyBuns/blob/main/REFERENCE.md) (commands, config),
[ADOPTION.md](https://github.com/QuinnsCode/RustyBuns/blob/main/ADOPTION.md) (the primitives) and
[agentic-processes/CODE_PRINCIPLES.md](https://github.com/QuinnsCode/RustyBuns/blob/main/agentic-processes/CODE_PRINCIPLES.md).
