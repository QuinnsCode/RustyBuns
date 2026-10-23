# tanstack-start-example

> **What it proves:** a TanStack Start app on Cloudflare's own setup (`@cloudflare/vite-plugin`, D1, KV) runs as a desktop app with its code unchanged. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A notes page. The loader is a server function that reads the notes from D1 and counts the visit in KV; the form posts through another server function; `/api/notes` is a server route with the same notes as JSON. Nothing in `src/` knows about Rusty Buns: it reads its bindings with `env` from `cloudflare:workers`, as it would on Cloudflare.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`: the Worker the plugin builds into `dist/server/`, its static files in `dist/client`, and a `worker`-mode desktop. On the desktop, D1 is a sqlite file and KV a folder under `~/.tanstack-start-example`.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/ (about 72 MB on macOS arm64)
bun test test              # build, add a note, restart, find it still there
```

## If you use Nitro

Rusty Buns runs what your build already makes, so you can keep Nitro too. `init` picks the server by how the app builds: `nitro()` with no preset builds the `standard` server, `preset: "vercel"` the Vercel function, and either runs on the desktop. A preset that starts its own server (`bun`, `node-server`) can't be mounted, and `init` says so. [FRAMEWORK_COVERAGE.md](../../FRAMEWORK_COVERAGE.md#tanstack-start) has the table and how real apps fared.
