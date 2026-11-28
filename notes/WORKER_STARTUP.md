# Worker startup: cold starts on our rwsdk apps

A Worker has 1 s of CPU to parse and run its bundle at startup, on paid and free plans alike. A warm Worker hides a
slow startup: Lighthouse and a quick curl usually hit one that is already loaded, so they score well. A visitor who
arrives after a quiet spell, or lands on a colo that hasn't loaded the Worker yet, waits for that startup.

## How to measure it

- **What people see:** `bun scripts/ttfb.ts <url> [url ...] --rounds 15 --gap 40`. It asks for the same page over and
  over, with a fresh query string each time, and prints the server time and colo for each request. Round 1, and any
  round where the colo changes, is a cold start.
- **The startup itself:** build the app, then run `wrangler check startup` from the app folder. It prints the bundle
  size and the startup CPU, and writes `worker-startup.cpuprofile`, which opens in DevTools. Bob runs it with
  `bun run builder run apps/<app> sh -c 'bunx vite build && bunx wrangler check startup'`. For an app that is already
  built, copy `dist/worker` somewhere else, put an empty `client` folder next to the copy, and run
  `wrangler check startup --config wrangler.json` there.

## Where we stand (2026-11-28)

`wrangler check startup` on an M-series Mac. Cloudflare's CPUs are slower, so read these as lower bounds.

| App | Worker bundle | Startup CPU |
| --- | --- | --- |
| Druids Curse (its own repo) | 10.5 MB (3.4 MB gzip) | 385-424 ms over 3 runs, about 80 ms of it GC |
| eqosys | 1.7 MB | 57 ms |
| qCRM | 1.3 MB | 42 ms |
| excalibrawl | 458 KB | 6 ms |
| what-would-fantano-say | 418 KB | 4 ms |

Live time to first byte, `bun scripts/ttfb.ts` with 15 rounds 40 s apart, all eight apps at once from one place
(answered by SAN and LAX):

| App | Median | p90 | Max | Over 500 ms |
| --- | --- | --- | --- | --- |
| Druids Curse | 189 ms | 2127 ms | 3251 ms | 6 of 15, every one over 1 s |
| eqosys | 86 ms | 364 ms | 584 ms | 1 of 15 |
| qCRM | 97 ms | 269 ms | 684 ms | 1 of 15 |
| artstewengine | 97 ms | 503 ms | 917 ms | 2 of 15 |
| excalibrawl | 208 ms | 403 ms | 480 ms | 0 of 15 |
| what-would-fantano-say | 129 ms | 378 ms | 548 ms | 1 of 15 |
| hello-world | 128 ms | 379 ms | 504 ms | 1 of 15 |
| codeSplitter | 79 ms | 395 ms | 608 ms | 1 of 15 |

The others went over 500 ms only on round 1, the first request after a quiet spell. Druids Curse took 1.1-3.3 s on
round 1 and then each time traffic moved to a colo that hadn't loaded it (mostly LAX), about one request in three.
That is the pattern from the community report: a warm request looks fine, a cold one runs into the 1 s startup limit.

## Why Druids Curse is slow, and what fixes it

- **three.js is in the Worker.** rwsdk renders `"use client"` components on the server too, so whatever they import
  ends up in the SSR bundle. The game's components import `three` at the top of the file, so the renderer, the
  geometry and the addons are all parsed at startup. The two hottest parts of the minified bundle (about 235 ms of self
  time) hold three.js, React's server renderer and rwsdk's module wrappers. Fix: in client components, load three.js
  with `await import("three")` inside the effect that draws the scene, and use `import type` for types.
- **Classes built at import.** The module wrappers run every module's top level at startup, so the classes and tables
  built there (the game's rules, maps and scene setup) are built before the first request. Build them the first time
  they're used instead.
- **Prisma's query engine.** The 2.1 MB `query_engine_bg.sqlite` wasm is in the build twice (4.3 MB). D1 through
  Kysely or plain `env.DB.prepare`, as qCRM and eqosys do, needs none of it.
- **Data inlined in the code.** Maps, rules and a 178 KB model credits list are JSON pasted into the bundle. Large
  ones can live in R2, KV or static assets and be loaded when a page needs them.

Splitting one big Worker into smaller ones helps for the same reason: each Worker loads only what its own routes use.
