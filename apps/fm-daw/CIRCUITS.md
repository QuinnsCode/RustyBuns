# Circuit amp spike

**The question:** can FM DAW model guitar pedals and tube amps as real circuits (resistors, capacitors, diodes, op-amps, tubes), drawn as boards in tscircuit, and play a guitar through them?

**The answer: yes.** The solver here runs a full four-tube amp 2.3 to 3.1 times faster than real time in plain TypeScript, a pedal 5 to 6 times, and a board drawn in tscircuit plays sample for sample like the same circuit written by hand. **Q Amp** (`/amp.html`) plays it live, with a guitar or a built-in riff. The solver and the rig are also ported to Rust (in the engine's wasm), and play the same output. Behind the preamp is a push-pull power stage that sags when you dig in, and a speaker cabinet's impulse response heard through a mic you can move on the cone. What's missing is an amp insert on an FM DAW track and a 3D stage. Those steps are listed under [Next](#next).

Play it live, speakers down: in `apps/fm-daw`, `bunx rustybuns boundary` once (it writes the Vite plugin the dev server needs), then `bun run dev` and open `/amp.html`. Or render WAVs (every file normalized to −1 dBFS):

```
cd apps/fm-daw
bun scripts/amp.ts --play     # a dry guitar riff, then every pedal and amp below
```

## Q Amp

One amp on a stage, live in the browser. The head and the cabinet are clear acrylic, so you see the tubes: each preamp tube glows with how hard its stage is swinging, the power tubes and the speaker cones with the output.

- **Amps:** Q Brit 3, Q Lead 50, Q Triple and Q Clean T, with Gain, Bass, Middle, Treble, Master and Noise (and on Q Clean T, the bias tremolo's Rate and Depth). Each amp keeps its own knob settings. Gain, Master and Noise cost nothing to turn; a tone knob rebuilds the tone stack's circuit (one matrix inversion) between two audio blocks.
- **Noise:** the first tube's grid stopper and plate resistor hiss, as real resistors do (Johnson noise, `noisy` on a resistor in a netlist). 0 is silent, 1 is a perfect resistor, 10 is 1000× that (+60 dB, a worn carbon resistor and then some). The hiss goes in at the front, so every stage after it amplifies and soft-clips it with the guitar: fizz on the notes, a wash in the gaps. On Q Lead 50 with nothing playing, 3 is about −55 dBFS, 5 −40, 7 −28 and 10 −20.
- **The mic on the cab:** two small knobs on the cabinet. **Mic** slides it from the centre cap (0, bright and forward) to the cone's edge (10, dark and round); **Angle** turns it off axis (0 straight on, 10 side on), which takes the top off further. Moving it only makes a new impulse response: nothing is rebuilt.
- **Pedals on the floor:** Q Drive, Q Fuzz and Q Dist, each with a Drive knob and a footswitch. One is on at a time (the chain has one pedal slot). Q Fuzz is an op-amp at up to ×2000 into soft diodes, then hard ones, and its 1M input resistor hisses (with the amp's Noise), so the fuzz clips its own hiss. Each has a board you can order (`circuits/q-drive/`, `q-fuzz/`, `q-dist/`: Gerbers, BOM, pick-and-place, drill template), made by `bun scripts/pcb.ts` (ANALOG.md section 8).
- **Board view** (the circuit-board button in the top bar): the schematic and the PCB of the pedal that's on (or the amp's first tube stage), drawn by tscircuit, its diodes, op-amp or tube glowing with the signal. The clipping diodes and the capacitors are sockets: click one and pick silicon, germanium, LED, MOSFET or none, or a capacitor a size or two up or down (real E6 values), and hear it while you play. Swaps are saved per pedal as your version of its board; the reset button puts the stock parts back. `qamp.swap("D1", "germanium")` does it from a probe.
- **Effects loop:** Q Bucket (a bucket-brigade chip: chorus, flanger or a dark delay), Q Tape (a tape echo: hysteresis, head loss, wow and flutter, a motor that glides when you turn Time, Repeats that run away into saturation) and Q Spring (a 12AT7 into two dispersive springs, a 12AX7 back out). They sit between the preamp and the power stage, any of them on at once, and switching or turning them never rebuilds the amp, so a tape keeps its echoes. See [ANALOG.md](ANALOG.md#4-effects-that-are-machines) for what each one models and what is a stand-in.
- **Input:** the riff on a loop, or your guitar through any audio input (echo cancellation, noise suppression and auto gain are off). **Bypass** sends the dry input straight through, to compare.
- **Screens:** one wide or two half-width, each in one of four modes. **Spectrum**: bars from 40 Hz to 25 kHz, or the top of the sample rate (24 kHz at 48 kHz), with peak caps. **Analog**: the same range as a phosphor trace that leaves a trail. **Scope**: the wave itself, held still on a rising zero crossing, 4 ms a division. **Focus**: three zoomed bands, low mids (150 Hz to 1 kHz), mids (1 to 2.5 kHz) and highs (5 kHz up), each with its loudest frequency read out.
- **Load meter:** how much of the audio thread's time the amp uses. Click it for **Eco** (2× oversampling, half the work); it switches to Eco by itself after a second above 90%.
- Speaker safety: the page starts silent behind a "speakers down" card, the output starts at −12 dB, and a limiter holds everything under −1 dBFS.
- Agents ask instead of screenshotting: `qamp.state()` on `window` (`bun run probe fm-daw /amp.html`). Headless Chrome won't start audio without a real click, so a probe sees the page but not the sound.

## What's here

| File | What it does |
|---|---|
| `packages/gear/src/circuit/mna.ts` | The circuit solver. Give it parts and the nodes they connect to; it gives back the output voltage, one sample at a time. |
| `circuits/*.tsx` | Every circuit as a tscircuit board: `dist`, `drive`, `fuzz`, `triode` (a 12AX7 stage) and `tone` (the bass/mid/treble stack). `bun scripts/boards.ts` renders each (tscircuit is installed into `~/.cache/rustybuns`, outside the workspace) to `<board>.circuit.json`, the netlist the app reads, and `<board>.schematic.svg` / `.pcb.svg` for the board view. Edit a board, rerun the script, commit all three. |
| `src/circuit/circuits.ts` | Which part each knob turns (Drive is `RV1`; a tone knob splits its pot's two halves) and the part swaps: `CLIPPERS`, `CAP_STEPS`, `sockets`, `swapOptions`. No netlist is written here. |
| `packages/gear/src/circuit/rig.ts` | Circuits in a row, run at 4× the sample rate so clipping doesn't alias into fizz, then the power stage and the cabinet. `Rig` streams a block at a time with live knobs; `runRig` does a whole buffer. |
| `packages/gear/src/circuit/power.ts` | The power stage: push-pull output tubes, the supply and its sag, the output transformer, and the speaker on its jack. See [The back end](#the-back-end). |
| `packages/gear/src/circuit/cab.ts` | The cabinet: `cabIR` makes an impulse response for where the mic sits, `Convolver` plays it (or a measured one). |
| `packages/gear/src/circuit/filters.ts` | The biquad, and the 8th-order low-pass the oversampler uses. |
| `src/circuit/amps.ts` | The Q amps and pedals, their knobs, and `buildRig` (an amp, a pedal, the knobs, the mic and the speaker jack into a rig). `RIGS` is each at its own settings. |
| `packages/gear/src/circuit/machines.ts` | The effects loop's machines: a spring tank (stretched all-pass chains in a feedback delay), a tape echo (Jiles-Atherton hysteresis, head loss, wow, flutter, motor inertia) and a bucket-brigade chip with its compander, with the tube and op-amp circuits inside them. They share `filters.ts` with the rig. |
| `src/circuit/riff.ts` | The dry guitar riff (Karplus-Strong plucks, seeded). |
| `src/amp/` | Q Amp: `live.ts` (settings into a rig, rebuilding only what changed; the limiter), `worklet.ts` (the audio thread), `screens.ts`, `board.ts` (the board view and its sockets), `main.ts`, `amp.css`. |
| `native/crates/fm_daw/src/circuit.rs` | The solver, the rig, the power stage and the convolution in Rust, step for step (the cab's impulse response is made in TypeScript and handed over), with an `fm_amp_*` C surface in the engine's wasm. `src/circuit/wasm.ts` (`WasmRig`) drives it with the same knobs as `Rig`; `encodeNetlist` in `mna.ts` hands it a netlist as numbers. |
| `src/circuit/tscircuit.ts` | Reads a tscircuit board's JSON and makes a netlist of it: pots set by their knobs, part values and diodes replaced by name. |
| `src/circuit/bench.ts` | The bench: a board becomes gear (a `@rustybuns/gear` box its size, a jack in and out, a knob per pot) once it plays, or the reasons it won't. Q Amp's floor takes one by drop (`src/amp/bench-slot.ts`). `circuits/bench-drive.tsx` is the Q Dist board with DRIVE and LEVEL pots, the bench's first board. |
| `scripts/amp.ts` | Plucks a guitar riff (Karplus-Strong), runs it through every rig, writes WAVs, prints the speed. |
| `test/circuit.test.ts` | Every board plays like its voicing; each clipper swap lands at its own forward drop and a smaller cap tightens the lows; the solver hits textbook numbers; no rig blows up on a hot input; the supply sags on a loud chord and not a quiet one; an amp with nothing on its jack is silent, then blows when played; the mic darkens off the centre; the Rust port plays every rig like the TypeScript one while the knobs, the mic and the load change. |
| `test/bench.test.ts` | The drawn drive pedal becomes gear and plays in front of the amp, its pots turning; boards people get wrong say why. |
| `test/amp.test.ts` | Working Q Amp's panel while the riff plays: only what moved is rebuilt, nothing passes −1 dBFS, no Newton misses; the loop's machines switched and turned without a rebuild, their tails ringing on. |
| `test/machines.test.ts` | The spring's chirp (lows arrive later), the tape's motor glide and saturating runaway, the bucket brigade's delay and compander level. |

## How it works

Every part is a rule about current and voltage. A resistor's current is its voltage over its resistance. A capacitor remembers the voltage it had a moment ago. A diode passes almost nothing until about 0.6 V, then a flood. A tube passes plate current depending on the voltage on its grid. Put the rules for every connection point in one table (modified nodal analysis, the method SPICE uses) and solve it again every sample.

The bends (diodes, tubes) are solved by Newton's method: guess, see how wrong the guess is, correct, repeat until it stops moving. That takes 2 to 4 tries per sample here.

The speed trick: everything that doesn't bend is the same every sample, so its table is inverted once when the circuit loads. Only the bending parts are solved each sample: a 2×2 problem for a tube stage instead of the whole 8×8 circuit. This is the idea behind the K-method and DK-method that published amp simulations use (Borin, De Poli & Rocchesso 2000; Yeh 2009). Most of the time goes to the tube's math, one chain of dependent steps per Newton try, not to the table (see [Speed](#speed)).

The models are published and checked:

- **12AX7 tube:** Koren's plate-current equation (1996) and Cohen and Helie's grid current (2010). A stage with a 100k plate load and a bypassed 1.5k cathode rests at 217 V on a 300 V supply and gains about ×52, as the textbooks say (the test checks this).
- **Diodes:** the Shockley equation, with SPICE's step limiting so a guess can't fly up the exponential.
- **Op-amps:** gain 200,000 and 3 MHz bandwidth (like a TL072), with the output clamped near the rails. The finite bandwidth matters: an ideal op-amp with a hard rail made Newton bounce between two answers on thousands of samples.

## The back end

The preamp's swing drives the power stage (`packages/gear/src/circuit/power.ts`), at the oversampled rate. It is behavioural, not a netlist, so it costs a few `exp`s a sample instead of another Newton solve:

- **Push-pull, class AB:** a phase inverter sends the swing to two output tubes, one the other way up. Each idles at about 35 mA (a pentode's plate current is a 3/2 power of its grid voltage above cutoff) and carries its half of the wave; the transformer hears the difference. Where one tube hands over to the other the curves bend (crossover), and driven past 0 V the grids conduct and round the top over. Q Brit 3 and Q Clean T have one pair; Q Lead 50 and Q Triple two.
- **The plate's knee:** a plate can't swing closer than about 50 V to its cathode, so the clean ceiling is the supply less that.
- **Sag:** the supply has a resistance (`sag` on each amp: 250 Ω for Q Brit 3's tube rectifier, 90 and 60 for the others' diodes). A loud chord draws current, the supply falls (Q Brit 3 from 450 V to about 370 V), the ceiling falls with it, and the amp compresses: about 10% quieter than a stiff supply when you dig in, the same when you pick softly. It drops in 15 ms and recovers over 120 ms.
- **The output transformer** blocks DC (its primary's inductance, 35 Hz) and rolls the top off (its leakage, 9 kHz), and steps the plates' swing down to the speaker on its 8 Ω tap.
- **The speaker jack:** a mismatched cab changes what the plates see (16 Ω on the 8 Ω tap clips sooner and louder). **Nothing on the jack is a real failure:** the plates' signal current has nowhere to go, the transformer's kick arcs over the moment you play (0.1 A of swing; idle hiss is a few milliamps and doesn't do it), and the amp is `fault: "open-load"` and silent until it is rebuilt. Plugging a speaker in afterwards doesn't mend it. Load In can ask `rig.fault`.
- **Bias tremolo:** an LFO on the bias supply (`PowerSpec.trem`, `Rig.setTrem`) pulls both grids from −36 V to as cold as −44 V and back. Colder tubes pass less, so a steady note swings in level (about 5 dB at Depth 8 on a clean note), and they sit further from the ceiling, so dug in, the dips clip less than the peaks; cranked all the way, the ceiling flattens the swing, as on a real amp. Q Clean T has it, with Rate (1.5 to 9.5 Hz) and Depth knobs. The Rust power stage doesn't yet, so `WasmRig` refuses a rig with Depth above 0.

Then the cabinet (`packages/gear/src/circuit/cab.ts`): the speaker's output is convolved with an impulse response 12 ms long (576 taps at 48 kHz), at the base rate. `cabIR` makes one for where the mic sits: the closed box's thump at 110 Hz, the cone's dip at 1.6 kHz, its breakup peak (3.6 kHz and +5 dB on the centre cap, sliding to 2 kHz and +1 dB at the edge), the back panel's reflection through the cone 0.7 ms late, and a top that falls from 7 kHz at the centre to 3.2 kHz at the edge, and further off axis. At 5 kHz against 800 Hz, the centre cap is 12 times the edge. `Rig.setCab` takes a measured IR instead (a WAV someone recorded of a real cab).

## The voicings

All of them are built from the same parts (`src/circuit/amps.ts`; the amps are named as on Q Amp). Their values are starting points to tune by ear, not copies of any product.

| Rig | What it is |
|---|---|
| `hard-clip` | Op-amp gain of ×101, then two silicon diodes to ground that cut the tops flat. Classic distortion pedal. |
| `fuzz` (Q Fuzz, on the page) | Up to ×2000, soft diodes in the feedback, then hard diodes to ground; a noisy input resistor. |
| `overdrive` | The diodes in the op-amp's feedback loop round the wave off instead, and only frequencies above ~720 Hz get the gain: the mids push, the lows stay clean. |
| `brit` (Q Brit 3) | Three tube stages, the middle one biased cold, then the tone stack. British crunch to lead. |
| `lead` (Q Lead 50) | Four stages with small coupling caps (tight lows) and two cold clippers. Saturated high gain. |
| `triple` (Q Triple) | Big bypass caps early (fat), a scooped tone stack. Modern and loose. |

`scripts/amp.ts` also renders `boosted-lead` (the overdrive at zero drive in front of the amp, which tightens it, as metal players do) and `hard-clip-germanium` (the same pedal with germanium diodes in its clipper socket).

## Speed

On the 64 GB builder Mac, one thread, 4× oversampled, `bun scripts/amp.ts` (seconds of audio per second of work):

| Rig | × real time |
|---|---|
| hard-clip, overdrive | 5.4, 5.8 |
| brit (3 stages) | 3.1 |
| lead, triple (4 stages) | 2.4, 2.3 |
| overdrive into lead | 1.7 |

These were measured with the old `tanh` and cab EQ. The push-pull stage and the cab convolution each cost about 3% of a thread: on the office Mac (busy, so slower than the builder's numbers), Q Lead 50 went from 2.07 to 1.88× real time, Q Triple 2.1 to 1.85, Q Brit 3 2.7 to 2.35. One amp still fits an audio thread with room to spare.

One amp fits in an audio thread with room to spare; a pedalboard plus amp is tight. Q Amp's Eco runs everything at 2× instead of 4× (half the work; tubes clip softly, so they alias less).

**The Rust port, measured** (`bun run bench`, the builder Mac on battery, the riff through each rig; Rust as wasm, the way an AudioWorklet runs it):

| Rig | Rust (wasm) | TypeScript (Bun) | Rust under V8 (first rig) | TypeScript under V8 |
|---|---|---|---|---|
| hard-clip, overdrive | 6.3, 6.8 | 5.2, 5.6 | 5.9 | 3.9 |
| brit | 4.3 | 3.0 | 4.1 | 2.1 |
| lead, triple | 3.3, 3.2 | 2.3, 2.2 | 3.1 | 1.6 |

Rust beats the JIT by 1.4 to 1.5× on the tube amps, and by 1.5 to 2× under V8 (Node; Chrome's AudioWorklet runs the same engine). Before [#4599](https://github.com/QuinnsCode/RustyBuns/issues/4599) the two were level under Bun: 2.0 against 2.1 on the lead. What changed it, and what didn't:

- **What was slow:** a Newton step on a tube is one chain of dependent math (a square root, then `exp`, `log1p`, `log`, `exp` for the plate current, then the 2×2 solve's divisions), and the CPU waits on each link. The sums across the circuit's nodes run alongside that chain and cost nothing extra: cutting them to the six numbers a step reads, a specialised 2×2 solve and wasm SIMD all measured 0%. A faster `exp` made of a long polynomial was slower than wasm's own libm, which is a short table-driven one.
- **What worked:** shorter links. In `circuit.rs` the softplus and its slope come from a table of cubic pieces on [−8, 8] (one `exp` and a series outside it), and `E1^1.4` and the grid's `^0.354` split the number into mantissa and exponent: a cubic for the mantissa, a list for the power of two. No `log` at all. They agree with libm within 1e-7 (softplus near −8) and 1e-9 (the powers), held by a Rust unit test.
- **The parity test** (`test/circuit.test.ts`) still holds Rust to TypeScript: the pedals come out bit for bit (their diodes still use `exp`), the tube amps within 4e-6 V on a 70 to 90 V swing. `mna.ts` keeps `Math.exp` and `Math.log`: Bun runs those in native libm, and an `exp` written out in JavaScript ran at half their speed.

## tscircuit

tscircuit renders a board to circuit JSON. Its `source_*` elements are the schematic, and every port already names its net, so turning a board into a netlist is a lookup. `boardToNetlist` reads resistors, capacitors, diodes, inductors, potentiometers and transistors (`germanium: ["Q1"]` for the old ones), and chips by their pin labels: `OUT`/`INP`/`INN` is an op-amp (with `IABC`, an OTA), `PLATE`/`GRID`/`CATHODE` a 12AX7, `DRAIN`/`GATE`/`SOURCE` a JFET (`pChannel: ["U1"]`), `LEDA`/`LEDK`/`LDR1`/`LDR2` a vactrol. Name a net in `supplies` to put a DC supply on it (`{ B_PLUS: 300 }`). A potentiometer's `knobs` turn (0 to 1 by its name) moves its wiper from pin1 toward pin3; the two-pin kind is a variable resistor.

**The bench.** Drop a board's circuit JSON on Q Amp's floor and it becomes the fourth pedal, with a knob per pot. First the bench plays a hot note through it with every knob down, centred and up; a board that won't solve (Newton gives up, it blows up, nothing reaches `OUT`, a part with no model) shows the reasons in the slot and never plays. Wire the jacks to `net.IN` and `net.OUT`. The box it becomes is `@rustybuns/gear`'s `Gear`, so the 3D studio can stand it on the floor once the room is built.

tscircuit itself stays out of this app: it is parked in this repo because it pins zod 3 (see `apps/tscircuit-desktop`). The app reads only its JSON. To change a board, edit `circuits/<board>.tsx` and run `bun scripts/boards.ts <board>`: it installs tscircuit once into `~/.cache/rustybuns` and writes the board's JSON and SVGs back into `circuits/`.

## Circuits from pedal kit sites

Kit sellers' build documents (layouts, photos, text) are their work, so none of it goes in this repo. A circuit's topology and part values are what we model; write those from the textbook topology with our own values, as `circuits.ts` does, and name a circuit by what it does, not after a product.

## Next

The longer map (more parts, a pedalboard, phasers to tape echo, profiling a real amp, and boards you can order as a kit) is in [ANALOG.md](ANALOG.md). The next steps here, in order, each one usable on its own:

1. **An Amp insert on an FM DAW track** ([#4555](https://github.com/QuinnsCode/RustyBuns/issues/4555)): Q Amp's live chain (`src/amp/live.ts`) after a track's voices, knobs as track params saved with the project.
2. **Q Amp on a 3D stage** ([#4570](https://github.com/QuinnsCode/RustyBuns/issues/4570)): the clear amp, cabinet and pedalboard in three.js, 2.5D or 3D, with the screens behind as stage LED walls.
3. **A real power amp:** done in [#4837](https://github.com/QuinnsCode/RustyBuns/issues/4837) ([The back end](#the-back-end)). Still to come: the negative feedback loop with Presence and Resonance, a transformer core that saturates, and the voice coil's impedance talking back to the plates.
4. **A real cabinet:** done in #4837, a made impulse response with a mic you move. Still to come: measured cab IRs (`Rig.setCab` takes one).
5. **More parts:** transistors (Ebers-Moll) for transistor fuzzes (Q Fuzz is an op-amp fuzz today) and boosts, JFETs, potentiometers as live knobs.
6. **Voicing by ear** against reference recordings the owner picks.
7. **A plugin build** (VST3 and CLAP through nih-plug) if it should also run in other DAWs.

Beyond the amp: the circuits as gear you carry, place and cable in a 3D studio (Qollab Studio's gear room) and in a roadie game (Load In), in [game idea 3](../../notes/game-ideas/3-studio-and-roadie.md).
