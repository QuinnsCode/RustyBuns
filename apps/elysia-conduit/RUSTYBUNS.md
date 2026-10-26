# elysia-conduit on Rusty Buns

This folder is [bedstack/elysia-drizzle-realworld-example](https://github.com/bedstack/elysia-drizzle-realworld-example) (MIT, © Yam Borodetsky and contributors; their [LICENSE](LICENSE) and [README](README.md) are theirs and unchanged). It is the RealWorld "Conduit" backend: Elysia 1.4, Drizzle, postgres.js and arkenv. It was copied at `f642e24` with nothing under `src/` edited. The aim is to show where Elysia plus Rusty Buns works well, and to say plainly where it doesn't.

## What we added

| file | why |
|---|---|
| `rustybuns.config.ts` | one `hyperdrive` binding: PGlite in the data dir on the desktop, with their Drizzle migrations applied at boot; Hyperdrive in front of `DATABASE_URL` on the edge |
| `rustybuns/worker.ts` | their `src/main.ts` calls `.listen()`; this exports `new Elysia().use(setupApp)` as a fetch handler instead. It copies the binding into `POSTGRES_*` before their modules load, and lets arkenv find its validator in a compiled binary |
| `rustybuns/cloudflare.d.ts` | types for `cloudflare:workers` |
| `test/postman.test.ts` | their own RealWorld Postman collection (`bin/api-tests`), run through newman against the desktop host |
| `tsconfig.check.json` | for the repo's TypeScript 7 typecheck, which no longer accepts their `baseUrl` |
| `.gitignore` | two lines for the generated `.rustybuns/` and `.alchemy/` |
| `package.json` | dev dependencies (`@rustybuns/*`, PGlite, newman, Alchemy), plus `@sinclair/typebox`: their `auth.service.ts` imports it without declaring it, which a hoisted install hides and the workspace's isolated install doesn't |

## Run it

```sh
bun install                                     # at the repo root
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
bun test test                                   # the Postman suite, about 3 s
bunx rustybuns build desktop --outfile dist/conduit && CONDUIT_BIN=dist/conduit bun test test
```

The API is at `/api`, and `/` redirects to their OpenAPI page. The desktop gates every request on its launch token, so a client other than the opened window (Postman, a separate RealWorld frontend) needs the `rb_token_<port>` cookie. `<data>/desktop.json` holds it.

## Where it works well

- **The desktop needs no source edits.** Their app, their Drizzle migrations and their Postman suite: 32 requests and 311 assertions pass, on the dev host and as a 109 MB binary. The binary embeds PGlite (about 17 MB of it), so it needs no Docker and no Postgres.
- **Postgres stays Postgres.** postgres.js speaks the wire protocol to PGlite's socket, named prepared statements included. Their migrations apply unchanged, and Drizzle can't tell the difference.
- **Elysia is already a fetch handler.** `app.fetch` is what Rusty Buns mounts, so the entry is a few lines.
- **It boots fast.** About 1 s from a cold start to serving, migrations included, on an M1 Pro.

## Where it hurts

- **Cloudflare: the unchanged app doesn't run.** There are five separate breaks, checked in local workerd, in [#2278](https://github.com/QuinnsCode/RustyBuns/issues/2278). Two are the app's own pattern: it builds one Postgres client at import time from `process.env`, and a Worker can neither read Hyperdrive at global scope nor reuse a socket across requests. Elysia's default AOT compiler uses `new Function`, which Workers forbid. arkenv loads its validator through a runtime `require`, and its `string.host` rejects hostnames. Fixing the first two means editing their `src/database/database.providers.ts`, which is the owner's call. `rustybuns plan` is clean; the run itself is [MANUAL RUN](#manual-run).
- **`rustybuns init` refuses it** ("no vite or rwsdk dependency"), and `--force` writes a Vite SPA config that can't build. The config here was written by hand. [#2274](https://github.com/QuinnsCode/RustyBuns/issues/2274)
- **A shim to pass the database's settings in.** The PGlite port is chosen at boot, and nothing puts it into `process.env`, so `rustybuns/worker.ts` copies it there. [#2275](https://github.com/QuinnsCode/RustyBuns/issues/2275)
- **`JWT_SECRET` on the desktop.** Nothing sets it, so the entry makes one up for each run, and sign-ins end when the app quits. [#2276](https://github.com/QuinnsCode/RustyBuns/issues/2276)
- **The dev host hid a binary-only crash.** arkenv's runtime `require` works in `--dev` (node_modules is on disk) and dies in the compiled binary, as it does in their own `bun build --compile`. The entry works around it with a Bun runtime plugin. [#2277](https://github.com/QuinnsCode/RustyBuns/issues/2277)
- **Their Drizzle client logs every query** (`logger: true`) to stdout. It's harmless, but noisy in a desktop app's log.

## Manual run

A real deploy needs Neon (or another Postgres), Hyperdrive and two secrets through varlock, and the edge needs #2278 settled first. The steps are in [#2279](https://github.com/QuinnsCode/RustyBuns/issues/2279).
