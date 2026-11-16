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

## First numbers (2026-11-13 and 2026-11-16)

Two live runs by the owner ([#4369](https://github.com/QuinnsCode/RustyBuns/issues/4369)), 7 pages × 3
actions per engine. In both, turns 2 and 3 hit Browser Run's 5-second cache, so only turn 1 was a real
render (the bench now passes `cacheTTL: 0`, #4426; a deploy from a checkout that has it gives three).
One sample per cell per run: read them for direction.

| Turn 1, medians over the cells | Kitesurf 11-13 | Chromium 11-13 | Kitesurf 11-16 | Chromium 11-16 |
|---|---|---|---|---|
| Failures (of 21 calls) | 0 | 1 (network closed) | 0 | 0 |
| Browser time Cloudflare reported | 1337 ms | 1198 ms | 727 ms | 824 ms |
| Total time from the Worker | 2782 ms | 1503 ms | 1249 ms | 1023 ms |
| Outside the browser (total − browser) | 1370 ms | 225 ms | 413 ms | 177 ms |
| Cells where it was faster (browser / total) | 10 / 8 | 10 / 12 | 12 / 7 | 9 / 14 |

What it says:

- **Kitesurf answered every call on every page**: 0 failures in 42.
- **Inside the browser, it's a tie or a little ahead.** Cloudflare's own pitch is less CPU and memory
  per page at 1.7–1.8× the wall time; a Worker can't see CPU or memory, so this bench can't check that part.
- **The gap is outside the browser**, and it moves: 1.4 s per call on the first run, 0.4 s on the
  second (Chromium: about 0.2 s both times). That looks like queueing or start-up on the beta side.
- **WebGL is not shown to work.** Kitesurf answered on Skate Tech Park, but an answer is not a
  rendered scene. Chromium's markdown there was 6042 bytes against Kitesurf's 1390, so the game's
  script likely got further in Chromium. Screenshot sizes don't settle it: Kitesurf's PNGs are bigger
  on every simple page too (Hello World 54 KB against 16 KB), so the encoders differ. Look at the two
  screenshots before saying either engine draws the park.
