# svelte-spa-example

> **What it proves:** a plain client-side Svelte 5 + Vite app, with no server, is a desktop app with no edits to `rustybuns init`'s output. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

There is no Worker and no KV here: the page is built to static files and served by the desktop host behind its token. The count lives in `src/actions/counter.ts`, a `"use server"` module the host runs under Bun (it writes a file under `~/.svelte-spa-example`), and the page imports it like any function. Without RWSDK this is desktop-only; on the web the same build is just static files, and the action has nowhere to run.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # shell served behind the token, count 0, two increments, 2, restart, still 2
```

The test is `counterJourney(..., { spa })` in [`scripts/counter.ts`](../../scripts/counter.ts). It calls the action over `/__rb/action`, the way the page does, since a client-rendered page has no form or `count: N` in its HTML for the server-rendered examples' check to read.
