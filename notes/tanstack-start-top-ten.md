# TanStack Start: ten public apps for the pitch (#2167)

Found 2026-11-09 with `bun scripts/trial-github.ts --dep @tanstack/react-start --list --stable` (GitHub code
search: 706 hits in 703 repos), then each repo's `package.json`, `vite.config.ts`, `wrangler.*` and
`.gitattributes` read through the GitHub API. TanStack's own e2e fixtures, benchmarks and vendored copies
are left out. Stars are the repo's; for a monorepo app, the folder after the colon is the app.

None of them uses Git LFS. "Trips on" is read from the config against `init` in `packages/cli`; no app's
code was installed or run (see "Trial" below).

| app | stars | last push | Cloudflare | what `init` would trip on |
|---|---|---|---|---|
| [RavelloH/InsightFlare](https://github.com/RavelloH/InsightFlare) (analytics) | 713 | 2026-11-09 | `cloudflare()` plugin, `wrangler.toml`: D1, a Durable Object | `build` is `tsx scripts/build.ts --target cf`, which applies D1 migrations `--remote`: init rightly skips it, but then used a bare `vite build` and missed `build:start` (builds the workspace UI packages first). **Fixed here.** Its vite config picks the wrangler file by `--mode`. |
| [TanStack/devtools:examples/react/drizzle](https://github.com/TanStack/devtools/tree/main/examples/react/drizzle) | 513 | 2026-11-09 | no; Postgres via `pg` | no `build` script and no Nitro, so the default `vite build` and `dist/server/server.js` fit; needs a Postgres it can reach. |
| [elevenlabs/packages:examples/agent-testbench](https://github.com/elevenlabs/packages/tree/main/examples/agent-testbench) | 118 | 2026-11-07 | no; `nitro` | `nitro()` with no preset: init sets `NITRO_PRESET=standard`. Needs an ElevenLabs key (fake secret). |
| [Balastrong/confhub](https://github.com/Balastrong/confhub) | 98 | 2026-06-10 | no; Netlify plugin (`edgeSSR`), Postgres, better-auth | the Netlify plugin moves the server build; `startLayout` reads it as "no Nitro" and expects `dist/server/server.js`. `build:deploy` runs `db:push`, which init must (and does) skip. |
| [josephmqiu/game-theory-model](https://github.com/josephmqiu/game-theory-model) | 81 | 2026-07-06 | no; `nitro`, Electron, bun | `preset: "node-server"` sits inside `...(isElectronBuild ? {...} : {})`, but `startLayout`'s regex sees it and warns the preset starts its own server, and drops `NITRO_PRESET=standard`: [#4107](https://github.com/QuinnsCode/RustyBuns/issues/4107). |
| [helpin-ai/helpin:help-center](https://github.com/helpin-ai/helpin/tree/main/help-center) | 74 | 2026-11-09 | no; Redis, its own `serve.mjs` | a custom Node server (`serve.mjs`, compression, render cache) and an `index.html` beside Start: init would run Start's server and skip theirs. `build` starts with `tsc -b`. |
| [jiahao-jayden/vibe-any-tanstack](https://github.com/jiahao-jayden/vibe-any-tanstack) (SaaS starter) | 70 | 2026-07-09 | `wrangler deploy` script, but `nitro()` in the vite config; Postgres, Stripe, better-auth | `nitro()` with no preset: `NITRO_PRESET=standard` fits. Build sets `--max-old-space-size=8192`. Many secrets to fake. |
| [ephraimduncan/duncan.land](https://github.com/ephraimduncan/duncan.land) (blog) | 40 | 2026-10-30 | `cloudflare()` plugin (off under Vitest), R2, libsql | builds with `vp build` (vite-plus), which init keeps from `deploy`. `main` is `@tanstack/react-start/server-entry`, a module, not a file. |
| [Weldawadyathink/Audiobook-Covers](https://github.com/Weldawadyathink/Audiobook-Covers) | 27 | 2026-08-30 | `cloudflare()` plugin, Hyperdrive (Postgres), R2 | no `scripts` at all (a Taskfile drives it), so the default `vite build`; Hyperdrive needs a Postgres or a PGlite twin. |
| [jillesme/readytotalk](https://github.com/jillesme/readytotalk) | 22 | 2026-03-04 | `cloudflare()` plugin, `wrangler.jsonc`: D1 (`migrations_dir: ./drizzle`), two Durable Objects | the closest to `apps/tanstack-start-example`: Worker entry `src/server.ts`, D1 migrations in `./drizzle`. `vars.BETTER_AUTH_URL` is the live domain, so sign-in on the desktop would point there. **Best pitch candidate.** |

Also seen, left out as not standalone apps: TanStack/ai examples, axiomhq/axiom-js's example, TIHLDE/Kvark
(20 stars, `nitro()`, Vercel), peerborne's example.

## Trial

`scripts/trial-github.ts --local jillesme/readytotalk` (sandboxed: empty HOME, dead Cloudflare
credentials, no deploys, no `plan`) was not run: this session's permission check refused running a cloned
repo's install and build, on this Mac and on the builder alike, and also refused our own `init` inside the
clone. The trial, the Chrome look and the desktop binary wait on that permission: [#4108](https://github.com/QuinnsCode/RustyBuns/issues/4108).
