# vue-spa-example

> **What it proves:** a plain client-side Vue 3 + Vite app, with no server, is a desktop app. What `rustybuns init` wrote runs as it is. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

There is no Worker and no KV here: the page is built to static files and served by the desktop host behind its token. The count lives in `src/actions/counter.ts`, a `"use server"` module the host runs under Bun (it writes a file under `~/.vue-spa-example`), and the page imports it like any function. Without RWSDK this is desktop-only; on the web the same build is just static files, and the action has nowhere to run.

### What init wires in for the action

Because the page imports a `"use server"` module, `rustybuns init` adds two things (#4815). Without them the page is blank: the module, with its `node:fs` and `node:os`, would be bundled into the page and throw on load.

1. `vite.config.ts` loads the boundary plugin, first in the list. It swaps each `"use server"` import for a call to the host:
   ```ts
   import { rustybuns } from "./.rustybuns/vite.ts";
   export default defineConfig({ plugins: [rustybuns(), vue()] });
   ```
2. The web builds make that file first: `"build": "rustybuns boundary && vite build"` in `package.json`, and `rustybuns boundary && ` in front of `worker.build` in `rustybuns.config.ts`. The desktop build makes it on its own.

```sh
bun run desktop:dev        # build the dev host and open it
bun run desktop:build      # one binary in dist/
bun test test              # shell served behind the token, count 0, two increments, 2, restart, still 2
```

The test is `counterJourney(..., { spa })` in [`scripts/counter.ts`](../../scripts/counter.ts). It calls the action over `/__rb/action`, the way the page does, since a client-rendered page has no form or `count: N` in its HTML for the server-rendered examples' check to read.
