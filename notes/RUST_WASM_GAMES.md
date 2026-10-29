# Rust/wasm workers for the games: is it worth it?

Asked 2026-10-28: would any game gain from moving logic into Rust compiled to WebAssembly, run in a
worker? Short answer: **not today.** Every game's logic runs in well under its time budget in plain
TypeScript, and the one game already ported (Hippo Tycoon) shows how little the port buys for a
small sim. The only real cost centre, Git Recon's 120 Hz battle on a Durable Object, has cheaper
TypeScript wins that come first. Where wasm does belong (custom audio DSP), FM DAW already has it.

## What was measured

Bun 1.4 on the 16 GB office Mac (busy, so read rows against each other). Each number is the game's own
sim, headless, the way the page, the desktop world or the Durable Object steps it.

| game | what runs | rate | cost per step | share of its budget |
|---|---|---|---|---|
| Git Recon | battle on El Capitan, 64 players firing at random (`apps/git-recon/bench/battle.ts`) | 120 Hz | ~0.7 ms (ffa), ~1.0 ms (teams) | 8-12% of one core |
| Git Recon | same, 8 players | 120 Hz | ~0.2 ms | 2-3% of one core |
| Two Fronts | ground battle, conquest, ~55 units | 30 Hz | ~0.3 ms | ~1% of a 33 ms step |
| Park Hide & Seek | 7 hard bots, tick + every player's view (line of sight) | 20 Hz | ~60 µs | 0.12% of a 50 ms tick |
| Skate Tech Park | one board, riding and popping | 60 Hz | ~24 µs | 0.14% of a frame |
| Alien Disc Golf | GFS 1° wind grid decode (GRIB2, complex packing), once per load | once | 3 ms warm, 30 ms cold | one-off |
| Hippo Tycoon | rules engine, already twinned in Rust ([README](../apps/hippo-tycoon/README.md#the-rust-twins-optional)) | 30 Hz | 0.74 µs TS vs 0.47 µs Rust | far under 0.01% |
| Delayed Reaction | synth on Web Audio's built-in nodes; sim is tiny | audio clock | not measured | no custom DSP to move |
| Splat Rooms / Splat Spray | splat sort and draw happen in the splat libraries (already off the main thread / on the GPU) | per frame | not ours | n/a |

## Why Rust/wasm doesn't pay here

- **Hippo Tycoon already ran the experiment.** Its Rust twin is 1.6x faster only when the whole round
  lives inside the module; copying state in and out each tick made it *slower* than TypeScript
  (1.28 µs vs 0.74 µs). A one-line TypeScript change (`Math.hypot` to `Math.sqrt(x*x + y*y)`) gave
  1.7x on its own. Porting cost a second engine, a bit-exact test harness and a no-libm trig series.
- **The boundary is the expensive part.** Every game here calls small functions (a height, a line of
  sight) from a big object graph. Wasm only wins if the whole sim moves, which for Git Recon is ~4,000
  lines (`game.ts`, `codemap.ts`, `director.ts`, the terrain package) to keep bit-identical with the
  page's copy, which predicts your soldier with the same code.
- **A worker doesn't help a fixed-step sim that the frame waits on.** The page needs this tick's state
  to draw; posting it to a worker adds a frame of latency and a copy, for steps that already take under
  a millisecond. Workers pay off for one-off heavy jobs (decode, decimate, bake), not per-tick logic.
- **Durable Objects bill wall-clock duration, not CPU.** A battle DO is awake for the whole match
  anyway, so shaving its tick saves headroom (more rooms per isolate, room for more players), not money.
- **Two languages per game** costs every future agent: the Rust toolchain on the builder, `build:native`
  in CI, and twin tests. That is fine for a showcase (Hippo Tycoon's point) and wasteful elsewhere.

## Where the time actually goes: Git Recon

`bun --cpu-prof apps/git-recon/bench/battle.ts`, self time:

| % | where |
|---|---|
| ~30% | terrain `height()`: the decorator chain in `packages/terrain/src/terrain.ts` (pads, paths, stamps) re-evaluated on every query |
| ~14% | `Math.hypot` |
| ~10% | `soldierAt` (each bullet against every soldier) |
| ~10% | `fly` (bullets) |
| ~7% | `ground`, ~7% `pushOutOfBlocks`, ~3% `blockAt` |

Swapping `Math.hypot` for a plain square root (a preload, not a code change) took 64 players from
~1,030 to ~810 µs per tick in teams and ~670 to ~550 in ffa, the same 20-25% Hippo Tycoon saw.
Baking the finished ground into one `Float32Array` heightfield at level load, and a uniform grid for
`soldierAt`, should take most of the rest. Those are plain TypeScript, keep the page and the world on
one engine, and are [#2680](https://github.com/QuinnsCode/RustyBuns/issues/2680).

## When to revisit

Reach for a Rust/wasm module (in a worker or an AudioWorklet) when one of these turns up:

- **Custom DSP per audio sample.** That is FM DAW's case and it already runs Rust/wasm in its worklet
  (`apps/fm-daw/src/engine/wasm.ts`). If Delayed Reaction ever moves off built-in nodes, copy that.
- **A one-off job over megabytes** that stalls the page: Splat Rooms decimating a 1M+ splat scan in
  `src/viewer/decimate.ts`, or a 0.25° wind grid (16x the 1° one) in Alien Disc Golf. Move it to a plain
  Web Worker first; reach for wasm only if the worker itself is too slow.
- **A sim that blows its budget after the TypeScript fixes:** Git Recon past ~200 players, or a Two
  Fronts battle in the thousands of units. Then port the whole sim, Hippo Tycoon style, and keep it in
  the module between ticks.
