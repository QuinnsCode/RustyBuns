# Motion MIDI

A synth written twice, once in Rust and once in TypeScript, inside one downloadable app.

The main view is a player: hit **Render and play** and the best available engine computes the song from its notes, then plays it. Behind **Compare engines** the same song is rendered by each engine in turn, so you can see what the Rust build buys. The audio is identical whichever engine renders it; `test/golden.test.ts` checks that sample by sample.

## Run it

```
bun install                     # at the repo root
cd apps/motion-midi
bun run build:native            # needs cargo; skip it and the app uses TypeScript everywhere
bunx rustybuns build desktop --dev && bunx rustybuns run desktop
```

Ship a binary for this machine:

```
bunx rustybuns build desktop    # dist/motion-midi-<os>-<arch>, Rust library inside
```

Other platforms build on their own OS; `.github/workflows/motion-midi.yml` does all three.

## Benchmark

```
bun run bench 1 4 8             # oscillators per voice
```

On a linux-x64 container, Rust ran the demo 1.6× to 5× faster than warmed-up TypeScript. Both engines share the same algorithms and the same inefficiencies, so the gap is the language, not the code.

## How it fits together

| Path | What it is |
|---|---|
| `songs/demo.json` | The song. `bun run song` regenerates it. |
| `src/engine/song.ts` | Compiles the song into a flat `Float32Array` both engines read. |
| `src/engine/engine.ts` | The TypeScript engine. |
| `native/crates/motion_midi` | The Rust engine, a line-for-line mirror. No dependencies. |
| `src/engine/native.ts` | Loads the Rust engine through `bun:ffi`; `null` means use TypeScript. |
| `src/actions/bounce.ts` | `"use server"` actions the desktop host runs for the UI. |
| `src/ui/` | The page. |

The engine renders in 512-frame blocks with no allocation, so live playback (next) can call the same `render` from an audio thread.

## On Cloudflare

The Worker serves the page and only the browser lane runs; the host lanes say they need the desktop app.

## Not a DAW yet

There is no keyboard, no recording and no note editing. Changing the music means editing `songs/demo.json` (or `scripts/make-demo-song.ts`, then `bun run song`). Notes are `[startBeat, lengthBeats, midiNote, velocity]`.

## Next

1. Live playback: a `cpal` audio thread owns the engine, an on-screen keyboard and MIDI input send events.
2. More effects, then a Motion Canvas music-video export.
3. therAImin: webcam hand tracking drives pitch and volume on the live engine.

## What building this fixed in Rusty Buns

- `add desktop --entry ./src/x.tsx#Name` wrote a wrong import path and a default import. Now relative to `packages/desktop` and a named import.
- `build desktop` never embedded `native/dist`, and `loadNative` couldn't copy a library out of a compiled binary. Both fixed; each binary carries only its own platform's library.
- Still open: `init` requires a `wrangler.jsonc` even for a plain SPA, and picks `npx` inside a Bun workspace. The host's cross-origin isolation blocks remote fonts, so bundle them.
