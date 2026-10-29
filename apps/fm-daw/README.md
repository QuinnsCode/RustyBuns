# FM DAW

> **What it proves:** one Rust crate runs as wasm in the audio thread and over FFI on the host, bit for bit the same as the TypeScript engine, and one world class saves your groove on a laptop or on Cloudflare. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

A small FM groovebox: twelve tracks (five drums and seven synths, each FM or analog), a drum machine (grooves and kits), a reverb and delay called Space with a send on every track, automation lanes, a step sequencer and a piano roll, live recording from the computer keyboard or a MIDI keyboard, and quantize. The sound engine is written twice, once in Rust and once in TypeScript, and you can switch between them while the groove plays.

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

`bun run build` makes the whole web app in `dist/client`: it builds the Rust engine to wasm (skipped with a note if cargo or the wasm32 target is missing; the TypeScript engine runs instead), writes the `.rustybuns/vite.ts` boundary plugin (`bunx rustybuns boundary`), then runs Vite. Run it once before `bun run dev`; if you see `Could not resolve "./.rustybuns/vite"`, that's why. Without a world (plain `vite dev`) nothing saves, and bounces download instead.

To try the Cloudflare version on your machine, rooms and all: `bun run build`, then `bunx wrangler dev`, and open `http://localhost:8787/?room=anything` in two browsers.

## Play

| Key | Does |
|---|---|
| <kbd>Space</kbd> | play / stop |
| <kbd>A</kbd> to <kbd>'</kbd> | a keyboard (Ableton's layout): white keys on the home row, black keys above |
| <kbd>Shift</kbd> + key | accented note |
| <kbd>Z</kbd> / <kbd>X</kbd> | octave down / up |
| <kbd>R</kbd> | record; with **Count-in** on, one bar of clicks first |
| <kbd>1</kbd> to <kbd>0</kbd> | pick a track (the first ten) |
| <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> | undo / redo |
| <kbd>V</kbd> <kbd>B</kbd> <kbd>N</kbd> <kbd>M</kbd> (hold) | stutter: repeat the 1/4, 1/8, 1/16 or 1/32 the playhead is in, until you let go |
| <kbd>Esc</kbd> | panic: stop everything, silence every voice |

- **Song** loads a whole project. **Long Trail** is ten minutes (432 bars) of dark, symphonic, dubby liquid drum and bass at 172 in A minor, a ride through the parks at night, in nine sections: Dawn, Trailhead, Canyon, Starfield, Summit, Dub Valley, Switchbacks, Ridgeline, Last Light. The drums never leave for long (an octave down through most of it, back up for the drops); the violin is there nearly throughout, plucked in the quiet parts and the builds and bowed for its two themes; the trumpet throws Spanish turns into the dub delay; long horn chords bloom underneath; and the big moves are hi-cut and low-cut sweeps across whole sections, written as automation, with one-beat cuts before each drop. **Night Shift** is the same material as a 32-bar loop. Every sound is a patch in `src/themes.ts` and `src/drums.ts`, so the songs are under this repo's license and use no samples.
- **Analog voice:** any track's patch can switch from **FM** to **Analog**: two band-limited saws detuned apart (up to ±50 cents), a sine sub an octave down, and noise, all through a resonant low-pass with its own envelope; one free-running LFO per track (a 50-second sweep up to 20 Hz) on cutoff and pitch, with vibrato fading in over the first 0.3 s of each note; glide and drive. Its amp envelope and level are operator 1's. This is the voice for detuned-saw basses, womps, brass and bowed strings (the noise is the bow) that FM can't make. Rust has it too, bit for bit.
- **Filters for the analog voice:** **SVF** (the 12 dB low-pass above), **Ladder** (four zero-delay one-poles with the feedback solved each sample and a tanh on the input, after Zavalishin's TPT ladder: the fat 24 dB old-school bass filter that growls when pushed), and **Vowel** (two formant band-passes; cutoff slides them through oo, oh, ah, eh, ee, so an LFO on cutoff makes the bass talk).
- **Supersaw:** the **Supersaw** knob swaps the two saws for seven, after Adam Szabo's analysis of the 90s original: his measured spread for each saw, his fitted detune curve on **Detune** (gentle for the first half, wide at the top) and his mix curve on the knob itself (the centre saw against the six around it). The big trance lead and pad (**Supersaw lead**, **Supersaw pad**). It costs seven cheap PolyBLEP saws a voice and no `sin`.
- **Wavefolder:** **Fold** sends the oscillators through a sine fold before the filter, the West Coast shaper: past full scale the wave turns back on itself, up to four times, so the sound gets brighter and stranger as the knob comes up (**Folded bass**).
- **Pulses and PWM:** **Shape** fades both oscillators from saws to pulses (a saw minus a shifted saw, so the PolyBLEP smoothing carries over), and **PWM** lets the LFO narrow the pulse down to 5%.
- **LFO:** sine, triangle, saw down or square; free in Hz or **locked to the tempo** (1 bar down to 1/32, with triplets). A locked LFO follows the transport, so a 1/4 wobble peaks on the beat wherever you pressed play; **Restart on note** starts the wobble with each note instead. On an FM patch the same LFO moves modulation depth, for FM growls.
- **Squash** (next to Space): an over-the-top multiband compressor on the master. Linkwitz-Riley crossovers at 120 Hz and 2.5 kHz split the mix into three bands that sum back flat; each band's loud parts come down (4:1) and its quiet ones come up (3:1, up to 16 dB), so tails, breaths and reverb crowd forward and everything gets dense. The highs and lows get a small lift on top. It's written from the textbook design, runs after either engine and before Space (so Rust/TS parity is untouched) and ends in its own limiter at −1 dBFS. 0 is off and costs nothing.
- **Chorus** on every track: the 80s polysynth bucket-brigade kind, built from the circuit's published figures. One delay line swept by a triangle (I slow, II faster, I+II a fast shallow shimmer), darkened, added on the left and subtracted on the right.
- **Sounds:** **Load a sound** on any track: wobble bass, talking growl, Reese, FM growl, ladder bass, acid line, folded bass, sub, screech, supersaw lead, ladder lead, chorus pad, supersaw pad, PWM strings, poly brass, chorus keys, minimal stab, blip, dub chord (`src/sounds.ts`). The track keeps its pan.
- **Perform** (under the grid, on the selected track): hold a **stutter**; switch the **wobble rate** on the beat; drag the **pad** (cutoff across, wobble depth up); **bend** up to an octave either way, springing back on release. A MIDI keyboard's pitch wheel bends ±2. **MIDI learn**: turn it on, touch any slider, move a knob or fader on your controller, and that CC drives it on whichever track is selected (log sliders keep their travel). Out of the box the mod wheel is wobble depth and CC 74 is cutoff; the map is kept in this browser, since it belongs to your controller rather than the song. Stutter and bend are performance: they aren't saved or undone. Both engines hear them alike, since the stutter lives in the sequencer.
- **Wobble Lab** (Song menu): half-time at 140 in F minor, four bars to play over. The wobble's rate is automated so it talks, and a vowel growl answers in bar 4.
- **Vel tone** (every patch): how much harder hits change the sound, not just its level. Analog: the cutoff moves up to 3 octaves either way. FM: modulation depth and feedback scale from nothing to double.
- **Hi-cut and low-cut** on every track: a low-pass closing from 20 kHz and a high-pass rising from 20 Hz, after the track's voices. At 0 they're off. Set them to carve room for one part, or automate them for long sweeps over a section.
- **Automation:** a track can carry lanes (`auto` in the project) that move any parameter along straight lines between points; two points on one beat make a jump, which is how cuts and articulation changes (the violin going from plucked to bowed) are written. The sequencer applies them, so both engines hear the same thing. Songs write them today; there's no lane editor yet.
- **Long songs:** a project can run up to 512 bars. The step grid and piano roll show 8 bars at a time with ‹ › to page, and Bounce renders a song (anything past 32 bars) once instead of four times.
- **Drum machine** (above the step grid): **Groove** writes a pattern onto the five drum tracks and moves BPM and swing to it (liquid roller, late night, half-time, chopped break, steppers, four on the floor). Loops run 1 to 32 bars. Loops of 2 bars or more get the groove's fill in the last bar. **Kit** swaps the drum patches and keeps the pattern. Each is one undo.
- **Space** is a reverb and a dotted-eighth ping-pong delay fed by each track's **Send** (lightly high-passed at 150 Hz), so the kick and bass can stay dry and mono while stabs and leads drown. The tails go wide and drift slowly across the stereo field. Higher Space also means more delay feedback; a saturator in the loop keeps the repeats from running away, and a slow wobble on the delay time bends them a little. The engine renders the send bus next to the mix (Rust and TS match on it too); Space runs after either engine, in the audio thread and in the bounce, and has its own limiter at −1 dBFS.
- **Hear a song without the app:** `bun scripts/listen.ts 3` renders Long Trail to a WAV and plays it (`afplay` on a Mac); `2` is Night Shift. It streams to disk, so ten minutes takes about a minute and little memory. Add a loop count (`bun scripts/listen.ts 2 4`) or `--quiet` to only write the file.
- **Drums** show as a step grid: click toggles, shift-click accents. Notes you play in freely land between steps and show striped until you quantize them.
- **Synths** show as a piano roll: drag to draw a note (you hear it as you press), click a note to delete it.
- **Quantize** a track to 1/4 through 1/32 or triplets, at any strength. 50% keeps half the feel. **Quantize input** does it as you record.
- **MIDI keyboards** work as soon as they're plugged in (Web MIDI, no driver). On drum tracks middle C plays the drum's own note. MIDI "all notes off" triggers the panic.
- **Bounce** renders four loops to a WAV in `~/Music/FM DAW` (set `FM_DAW_DIR` to change it), and **Show** opens it in Finder.

## Where the new voices come from

We looked for open-source Rust synth code to borrow, and checked each license. The engine is written twice (TS and Rust, bit for bit), so we port algorithms rather than add crates. The ladder, vowel filter, pulses, chorus, supersaw, wavefolder and Squash here are written from the published designs: Zavalishin's *The Art of VA Filter Design* for the ladder and SVFs, the Peterson–Barney vowel formants, published measurements of the bucket-brigade chorus, Adam Szabo's *How to Emulate the Super Saw* (2010) for the supersaw's offsets and curves, the textbook sine folder, and Linkwitz-Riley crossovers with up/down compression for Squash. No code was copied, so there are no notices to carry. Good places to look next:

| Project | License | Worth porting |
|---|---|---|
| [fundsp](https://github.com/SamiPerttu/fundsp) | Apache-2.0 (ours) | phaser, flanger, comb, wavefolding shapers |
| [valib](https://github.com/SolarLiner/valib) | MIT | transistor and OTA ladder variants, saturators, oversampling |
| [Mutable Instruments eurorack](https://github.com/pichenettes/eurorack) | MIT | PWM and variable-shape oscillators, wavefolder, formant speech, swarm (supersaw-like) |
| [nih-plug](https://github.com/robbert-vdh/nih-plug) | ISC (some example plugins GPL) | plugin plumbing, if FM DAW ever ships as a plugin |
| Surge XT, Vital, Odin 2, HexoDSP/synfx-dsp, OctaSine, Dexed | GPL/AGPL | read the papers they cite instead; don't port the code |

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

`rm -rf ~/.fm-daw` starts over from the demo groove. Not covered yet: Linux and Windows builds.

## How it fits together

| Path | What it is |
|---|---|
| `src/engine/engine.ts` | The TypeScript engine: 12 tracks × 8 voices of 4-operator FM (4 algorithms, op 4 feedback) or the analog voice (PolyBLEP saws, a trapezoidal state-variable low-pass, LFO, glide, drive), a pitch envelope and noise for drums, then the master safety chain. No allocation in `render`. |
| `native/crates/fm_daw` | The Rust engine, a line-for-line mirror. One crate, two builds: a cdylib for `bun:ffi` on the host, and `wasm32` for the audio thread. |
| `src/engine/sequencer.ts` | Loops the pattern, swings it, counts in, clicks, records live notes with output latency taken off. Drives either engine, so both hear exactly the same events. |
| `src/engine/worklet.ts` | The AudioWorklet. Owns the engine and sequencer; swaps TS and Rust mid-groove by replaying its parameter mirror into the new engine. |
| `src/engine/space.ts` | Space: reverb (8 combs and 4 allpasses a side), ping-pong delay with feedback and wobble, a slow stereo swirl, then a limiter. TypeScript only and after the engine, so Rust/TS parity is untouched. |
| `src/drums.ts`, `src/themes.ts`, `src/songs.ts`, `src/longtrail.ts` | The drum machine's grooves and kits, the shared sounds and phrases, and the songs. |
| `src/project.ts` | The project document and the ops that change it, with validation. Shared by the page, the world and the bounce. |
| `packages/desktop/world.ts` | The world. On the desktop the host runs it in-process with sqlite, so your project survives a restart. On Cloudflare the same class is a Durable Object per `?room=`, so a room shares one groove. |
| `src/actions/files.ts` | `"use server"` actions the host runs: save a bounce, reveal it, and the host side of the engine race. |

## Rust vs TypeScript

The golden tests render 8 seconds of the demo groove with each engine, and 8 seconds of Night Shift (the analog voice) over FFI. Both the cdylib and the wasm build match TypeScript **bit for bit** (max difference 0 over 384,000 frames), so switching engines changes nothing you can hear.

**Engine race** renders 20 s of the current groove on each lane. On an M-series Mac: TypeScript in the window about 15× realtime, Rust as wasm about 18×, Rust over FFI on the host about 18 to 21×, TypeScript under Bun about 16 to 19×. Rust's lead is small here because both engines spend their time in the same `sin` and `pow` calls. The interesting part is that the same audio comes out of four runtimes.

## On Cloudflare

`src/worker.ts` serves the page and routes `/ws?room=<name>` to a `World` Durable Object, the same class the desktop runs. Open the same room in two browsers and edits show up in both; the status bar counts who's jamming. Visitors are anonymous: the Worker vouches a random id. One address can open only so many new rooms a minute (per Worker isolate), a room holds 32 sockets, and a socket sending more than its budget (120 messages a second, big ones cost more) is closed and reconnects to the snapshot. A room nobody opens for 30 days is deleted; the desktop's own groove never is. The page is a plain SPA: the Rust engine runs as wasm in the browser's AudioWorklet, exactly as in the desktop window; only the host's extras (saving bounces to `~/Music`, Show, the Engine race's host lanes) stay desktop-only, and Bounce downloads the WAV instead.

Deploying is yours to run, from this folder: `bunx rustybuns plan` (creates nothing; it lists `[Build]`, `[Worker]` and `[Worker/WORLD]`), then `bunx rustybuns deploy`. Both need a Cloudflare login (`bunx rustybuns login cloudflare`). The deploy's build step is `bun run build`, so the wasm ships when cargo and `wasm32-unknown-unknown` are installed. Send a friend `https://<the deployed url>/?room=<a name>`: everyone with that link edits one groove. Without `?room=` you land in the shared `lobby`.

## Known limits

- **The sound has only been checked by numbers**, not by ear: levels, peaks and parity are tested, and a bounce of the demo peaks at −3.8 dBFS. How the kit sounds needs your ears.
- **Switching engines cuts the notes that are sounding**; the groove carries on from the next note.
- **Event timing is quantized to 16 samples** (a third of a millisecond at 48 kHz) to keep the audio thread simple.
- **Edits go to everyone, last write wins.** There's no conflict merging beyond that, and undo is per person.
- **No MIDI clock or MIDI out yet.** MIDI learn maps sliders only, not the button rows (filter type, LFO shape, chorus).
- **Voice stealing can click** when a track plays more than 8 notes at once.

## Next

1. Phaser and flanger, a diode ladder for the acid line, and recording stutter and bend as automation ([#2642](https://github.com/QuinnsCode/RustyBuns/issues/2642)).
2. Song mode: chain patterns.
3. Per-track sends to Space (it's one master send today, high-passed), and a sidechain from the kick.
4. Try a deployed jam room with two people.
