# Kitesurf Bench

> **What it proves:** a `browser` binding is one line of config, and Cloudflare's Kitesurf engine can be measured against Chromium on our own pages, from inside a Worker. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

One Worker with a Browser Run binding and one page. **Run the bench** takes each of our live pages
(eqosys, qCRM, codeSplitter, ShareSplat, the Playground, Hello World, and Skate Tech Park to see what
WebGL does) through three Quick Actions (`content`, `markdown`, `screenshot`). Kitesurf and Chromium
take turns, and the page shows the median time for each, the browser time Cloudflare reports when it
sends one, and any errors. **Copy results** puts the raw runs on the clipboard as JSON.

The times are from inside the Worker, from the call to the last byte. They're not Cloudflare's CPU and
memory figures: those come from inside the engine, and a Worker can't see them.

```sh
bunx rustybuns plan          # a Worker with a browser binding, nothing else
bunx rustybuns deploy        # then open the URL it prints and press Run
bunx rustybuns destroy       # when the numbers are copied
bun test test                # the bench against a stand-in binding
```

The page list is fixed in `src/bench.ts`, so the deployed Worker can't be pointed anywhere else. Each
isolate stops after 600 browser calls. Kitesurf is free in beta. A full run at three turns uses about a
minute of Chromium browser time.

## First numbers (2026-11-13)

The owner's first live run ([#4369](https://github.com/QuinnsCode/RustyBuns/issues/4369)): 7 pages × 3
actions per engine. Turns 2 and 3 hit Browser Run's 5-second cache, so only turn 1 was a real render
(the bench now passes `cacheTTL: 0`, #4426). One sample per cell: read it for direction.

| Over the 20 cells both engines finished | Kitesurf | Chromium |
|---|---|---|
| Failures (of 21 calls each) | 0 | 1 (network closed, Hello World screenshot) |
| Median browser time Cloudflare reported | 1337 ms | 1198 ms |
| Median total time from the Worker | 2782 ms | 1503 ms |
| Median time outside the browser (total − browser) | 1370 ms | 225 ms |
| Cells where it was faster (browser time / total) | 10 / 8 | 10 / 12 |

What it says:

- **Kitesurf works on all our pages**, the WebGL one (Skate Tech Park) included, with no failures.
- **Inside the browser, it's a tie**: each engine was faster on 10 of the 20 cells, and the medians are
  about 10% apart.
- **The gap is outside the browser**: about 1.4 s per call for Kitesurf against 0.2 s for Chromium.
  That looks like queueing or start-up on the beta side, not page work, so it is the number to ask
  Cloudflare about.

Full table, cell by cell, in [the issue's first comment](https://github.com/QuinnsCode/RustyBuns/issues/4369).
