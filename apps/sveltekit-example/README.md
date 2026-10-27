# sveltekit-example

> **What it proves:** a SvelteKit 3 app on `@sveltejs/adapter-cloudflare` (a `wrangler.jsonc`, one KV binding, a `load` and a form action) is a desktop app with no edits and no extra adapter. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

The [sample app contract](../../FRAMEWORKS.md#the-sample-app-contract): `/` shows `count: N` read from the `COUNTER` KV binding in `+page.server.ts`'s `load`, and the page's `<form method="post">` runs the default form action, which bumps it; SvelteKit re-renders the page with N+1. `src/` is a plain SvelteKit app and knows nothing about Rusty Buns: it reads the binding with `import { env } from "cloudflare:workers"`, which the desktop host backs with a folder under `~/.sveltekit-example`.

`rustybuns.config.ts` is what `rustybuns init` wrote from `wrangler.jsonc`, unedited: `vite build` runs the adapter, which writes the Worker and its assets into `.svelte-kit/cloudflare/`, and a `worker`-mode desktop runs that Worker under Bun.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # the contract: count 0, two posts, count 2, restart, still 2 (about five seconds, mostly vite build)
bunx rustybuns plan --offline   # the edge: a Worker, its build and a KV namespace, nothing else
```

The test is [`scripts/counter.ts`](../../scripts/counter.ts), shared by every `apps/<framework>-example`: it finds the count and the form in the page over HTTP, so a framework can render them however it likes.

What hurt, all on SvelteKit's side, none on Rusty Buns':

- SvelteKit 3 dropped `svelte.config.js`; the adapter goes in `sveltekit({ adapter: adapter() })` in `vite.config.ts`.
- `event.platform` is gone from the Worker `@sveltejs/adapter-cloudflare` 8 builds (`load` saw `platform` as `undefined`): bindings come from `import { env } from "cloudflare:workers"`, which the host already shims.
- Kit 3 writes `node_modules/$app/tsconfig.json` on sync and wants `tsconfig.json` to extend it, which a fresh checkout doesn't have, so `tsconfig.check.json` (what `bun run typecheck` reads) checks the `.ts` files on their own.
