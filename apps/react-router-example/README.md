# react-router-example

> **What it proves:** a React Router 7 framework-mode app on Cloudflare's own template (`workers/app.ts`, `@cloudflare/vite-plugin`, one KV binding) is a desktop app with no edits and no adapter. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` shows `count: N`, read in the route's `loader` from the `COUNTER` KV binding, and a `<Form method="post">` runs the route's `action`, which bumps it and redirects back. `app/` and `workers/` are Cloudflare's `react-router-starter-template` with the welcome page swapped for the counter; nothing in them knows about Rusty Buns. `context.cloudflare.env.COUNTER` is the Worker's binding, which the desktop host backs with a folder under `~/.react-router-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: the Worker the plugin builds into `build/server/index.js`, its client assets in `build/client`, and a `worker`-mode desktop that runs the same Worker under Bun.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (a few seconds)
bunx rustybuns plan --offline   # the edge: a Worker, its build and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

## What hurt

- A bare `<form method="post">` on an index route answers 405: React Router aims a POST at `/` to the parent route, which has no action. The index route's action is at `/?index`, which `<Form>` writes into the `action` attribute for you.
- React Router 7.18 renamed the template's `future.unstable_viteEnvironmentApi` flag to `v8_viteEnvironmentApi`; the old name is an error, not a warning.
- `virtual:react-router/server-build` is typed by `react-router typegen` into `.react-router/types`, which isn't checked in, so `workers/cloudflare.d.ts` declares it (and the two binding types) for the repo-wide typecheck.
