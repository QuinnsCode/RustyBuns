# FM DAW

> **What it proves:** one Rust crate runs as wasm in the audio thread and over FFI on the host, bit for bit the same as the TypeScript engine, and one world class saves your groove on a laptop or on Cloudflare. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A small FM groovebox: five FM drums and three FM synths, a step sequencer and a piano roll, live recording from the computer keyboard or a MIDI keyboard, and quantize. The sound engine is written twice, once in Rust and once in TypeScript, and you can switch between them while the groove plays.

## Run it

Run every command from the folder named in its step.

1. **Install** (repo root, once, and again after pulling new dependencies):
   ```
   bun install
   ```
2. **Go to the app:**
   ```
   cd apps/fm-daw
   ```
3. **Optional, for the Rust sound engine** (once per machine; needs [rustup](https://rustup.rs)):
   ```
   rustup target add wasm32-unknown-unknown
   bun run build:native
   ```
   Skip this and the app uses the TypeScript engine only. It still works.
4. **Build and launch the desktop app:**
   ```
   bun run desktop:dev
   ```
   This is `bunx rustybuns build desktop --dev && bunx rustybuns run desktop`. Turn your speakers down first.

Ship a binary for this machine (about 62 MB on macOS arm64, with the Rust engine inside):

```
bun run desktop:build           # dist/fm-daw-<os>-<arch>
```

### Plain browser with hot reload

`bun run dev` needs `.rustybuns/vite.ts`, which only `rustybuns build desktop` writes (`rustybuns generate` does not). So run step 4 once first, or just `bunx rustybuns build desktop --dev`; after that, `bun run dev` works. If you see `Could not resolve "./.rustybuns/vite"`, this is why. Saving goes away in the browser (no world), and bounces download instead.

## Play

| Key | Does |
|---|---|
| <kbd>Space</kbd> | play / stop |
| <kbd>A</kbd> to <kbd>'</kbd> | a keyboard (Ableton's layout): white keys on the home row, black keys above |
| <kbd>Shift</kbd> + key | accented note |
| <kbd>Z</kbd> / <kbd>X</kbd> | octave down / up |
| <kbd>R</kbd> | record; with **Count-in** on, one bar of clicks first |
| <kbd>1</kbd> to <kbd>8</kbd> | pick a track |
| <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> | undo / redo |
| <kbd>Esc</kbd> | panic: stop everything, silence every voice |

- **Drums** show as a step grid: click toggles, shift-click accents. Notes you play in freely land between steps and show striped until you quantize them.
- **Synths** show as a piano roll: drag to draw a note (you hear it as you press), click a note to delete it.
- **Quantize** a track to 1/4 through 1/32 or triplets, at any strength. 50% keeps half the feel. **Quantize input** does it as you record.
- **MIDI keyboards** work as soon as they're plugged in (Web MIDI, no driver). On drum tracks middle C plays the drum's own note. MIDI "all notes off" triggers the panic.
- **Bounce** renders four loops to a WAV in `~/Music/FM DAW` (set `FM_DAW_DIR` to change it), and **Show** opens it in Finder.

## Speaker safety

FM goes from pleasant to screaming in one slider move, so there are limits on every path to the speaker:

- Audio starts only after you click through a "speakers down first" screen, with the master at −12 dB.
- Every parameter is clamped to a range in the engine itself (`RANGES` in `src/engine/params.ts`, mirrored in Rust), so no slider, preset, MIDI message or bad network op can push a value past what's been tested. Modulation depth and operator feedback are capped below where FM turns to noise.
- The master chain blocks DC, smooths the master gain, resets the engine and outputs silence if a sample is ever NaN, then runs a peak limiter (instant attack) with a hard clamp at **−1 dBFS**. The **Limit** lamp lights when it's working.
- Every track starts at gain 0, so a fresh engine is silent until a project loads.
- `test/engine.test.ts` checks all of this: every param at its maximum with every voice on, NaN and Infinity everywhere, and 200 random patches. All of them stay finite and under the ceiling.

## Testing

`bun test test` runs the safety and parity tests. Look for `max |rust - ts| = 0.00e+0` on both the `cdylib` and `wasm` lines; without `build:native` those two skip with a note.

Then check by ear, **speakers down first**:

1. **Sound.** Space plays the demo; the **Limit** lamp should stay mostly dark. Switch the engine to Rust while it plays: nothing should change except the notes sounding at that moment. Sweep the Kick's pitch drop, depth and feedback, and hit Randomize on a few tracks, listening for anything harsh or clicky. Esc silences everything.
2. **Recording.** Press <kbd>7</kbd> (Keys), turn on Count-in, press <kbd>R</kbd>, play along after four clicks; notes appear in the roll. Record a drum with Quantize input off: hits show striped until you quantize them (try 50%). <kbd>⌘Z</kbd> undoes.
3. **MIDI.** Plug in a keyboard: its name appears by the keys without a reload. Play a synth track and a drum track.
4. **Saving.** Change something, quit, run again: it's still there. Bounce, then Show: the WAV sounds like what you heard.
5. **The binary.** `bun run desktop:build`, run `dist/fm-daw-<os>-<arch>`, repeat the above. Engine race should list all four lanes.

`rm -rf ~/.fm-daw` starts over from the demo groove. Not covered yet: the Cloudflare jam rooms (not deployed), and Linux and Windows builds.

## How it fits together

| Path | What it is |
|---|---|
| `src/engine/engine.ts` | The TypeScript engine: 8 tracks × 8 voices of 4-operator FM (4 algorithms, op 4 feedback), a pitch envelope and noise for drums, then the master safety chain. No allocation in `render`. |
| `native/crates/fm_daw` | The Rust engine, a line-for-line mirror. One crate, two builds: a cdylib for `bun:ffi` on the host, and `wasm32` for the audio thread. |
| `src/engine/sequencer.ts` | Loops the pattern, swings it, counts in, clicks, records live notes with output latency taken off. Drives either engine, so both hear exactly the same events. |
| `src/engine/worklet.ts` | The AudioWorklet. Owns the engine and sequencer; swaps TS and Rust mid-groove by replaying its parameter mirror into the new engine. |
| `src/project.ts` | The project document and the ops that change it, with validation. Shared by the page, the world and the bounce. |
| `packages/desktop/world.ts` | The world. On the desktop the host runs it in-process with sqlite, so your project survives a restart. On Cloudflare the same class is a Durable Object per `?room=`, so a room shares one groove. |
| `src/actions/files.ts` | `"use server"` actions the host runs: save a bounce, reveal it, and the host side of the engine race. |

## Rust vs TypeScript

The golden tests render 8 seconds of the demo groove with each engine. Both the cdylib and the wasm build match TypeScript **bit for bit** (max difference 0 over 384,000 frames), so switching engines changes nothing you can hear.

**Engine race** renders 20 s of the current groove on each lane. On an M-series Mac: TypeScript in the window about 15× realtime, Rust as wasm about 18×, Rust over FFI on the host about 18 to 21×, TypeScript under Bun about 16 to 19×. Rust's lead is small here because both engines spend their time in the same `sin` and `pow` calls. The interesting part is that the same audio comes out of four runtimes.

## On Cloudflare

`src/worker.ts` serves the page and routes `/ws?room=<name>` to a `World` Durable Object, the same class the desktop runs. Open the same room in two browsers and edits show up in both; the status bar counts who's jamming. Visitors are anonymous: the Worker vouches a random id. One address can open only so many new rooms a minute (per Worker isolate), a room holds 32 sockets, and a socket sending more than its budget (120 messages a second, big ones cost more) is closed and reconnects to the snapshot. A room nobody opens for 30 days is deleted; the desktop's own groove never is. This is written and typechecked but **not deployed yet**. The `rustybuns plan` / `deploy` flow from the top-level README applies.

## Known limits

- **The sound has only been checked by numbers**, not by ear: levels, peaks and parity are tested, and a bounce of the demo peaks at −3.8 dBFS. How the kit sounds needs your ears.
- **Switching engines cuts the notes that are sounding**; the groove carries on from the next note.
- **Event timing is quantized to 16 samples** (a third of a millisecond at 48 kHz) to keep the audio thread simple.
- **Edits go to everyone, last write wins.** There's no conflict merging beyond that, and undo is per person.
- **No MIDI learn, MIDI clock or MIDI out yet**, and no pitch bend.
- **Voice stealing can click** when a track plays more than 8 notes at once.

## Next

1. MIDI learn for any slider, and pitch bend.
2. Song mode: chain patterns.
3. Per-track sends to a shared reverb and delay, and a sidechain from the kick.
4. Deploy the jam room to Cloudflare and try it with two people.
