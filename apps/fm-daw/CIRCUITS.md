# Circuit amp spike

**The question:** can FM DAW model guitar pedals and tube amps as real circuits (resistors, capacitors, diodes, op-amps, tubes), drawn as boards in tscircuit, and play a guitar through them?

**The answer: yes.** The solver here runs a full four-tube amp 2.3 to 3.1 times faster than real time in plain TypeScript, a pedal 5 to 6 times, and a board drawn in tscircuit plays sample for sample like the same circuit written by hand. **Q Amp** (`/amp.html`) plays it live, with a guitar or a built-in riff. The solver and the rig are also ported to Rust (in the engine's wasm), and play the same output. What's missing is an amp insert on an FM DAW track, a real power amp and speaker cabinet, and a 3D stage. Those steps are listed under [Next](#next).

Play it live, speakers down: in `apps/fm-daw`, `bunx rustybuns boundary` once (it writes the Vite plugin the dev server needs), then `bun run dev` and open `/amp.html`. Or render WAVs (every file normalized to −1 dBFS):

```
cd apps/fm-daw
bun scripts/amp.ts --play     # a dry guitar riff, then every pedal and amp below
```

## Q Amp

One amp on a stage, live in the browser. The head and the cabinet are clear acrylic, so you see the tubes: each preamp tube glows with how hard its stage is swinging, the power tubes and the speaker cones with the output.

- **Amps:** Q Brit 3, Q Lead 50, Q Triple, with Gain, Bass, Middle, Treble, Master and Noise. Each amp keeps its own knob settings. Gain, Master and Noise cost nothing to turn; a tone knob rebuilds the tone stack's circuit (one matrix inversion) between two audio blocks.
- **Noise:** the first tube's grid stopper and plate resistor hiss, as real resistors do (Johnson noise, `noisy` on a resistor in a netlist). 0 is silent, 1 is a perfect resistor, 10 is 1000× that (+60 dB, a worn carbon resistor and then some). The hiss goes in at the front, so every stage after it amplifies and soft-clips it with the guitar: fizz on the notes, a wash in the gaps. On Q Lead 50 with nothing playing, 3 is about −55 dBFS, 5 −40, 7 −28 and 10 −20.
- **Pedals on the floor:** Q Drive, Q Fuzz and Q Dist, each with a Drive knob and a footswitch. One is on at a time (the chain has one pedal slot). Q Fuzz is an op-amp at up to ×2000 into soft diodes, then hard ones, and its 1M input resistor hisses (with the amp's Noise), so the fuzz clips its own hiss.
- **Input:** the riff on a loop, or your guitar through any audio input (echo cancellation, noise suppression and auto gain are off). **Bypass** sends the dry input straight through, to compare.
- **Screens:** one wide or two half-width, each in one of four modes. **Spectrum**: bars from 40 Hz to 25 kHz, or the top of the sample rate (24 kHz at 48 kHz), with peak caps. **Analog**: the same range as a phosphor trace that leaves a trail. **Scope**: the wave itself, held still on a rising zero crossing, 4 ms a division. **Focus**: three zoomed bands, low mids (150 Hz to 1 kHz), mids (1 to 2.5 kHz) and highs (5 kHz up), each with its loudest frequency read out.
- **Load meter:** how much of the audio thread's time the amp uses. Click it for **Eco** (2× oversampling, half the work); it switches to Eco by itself after a second above 90%.
- Speaker safety: the page starts silent behind a "speakers down" card, the output starts at −12 dB, and a limiter holds everything under −1 dBFS.
- Agents ask instead of screenshotting: `qamp.state()` on `window` (`bun run probe fm-daw /amp.html`). Headless Chrome won't start audio without a real click, so a probe sees the page but not the sound.

## What's here

| File | What it does |
|---|---|
| `src/circuit/mna.ts` | The circuit solver. Give it parts and the nodes they connect to; it gives back the output voltage, one sample at a time. |
| `src/circuit/circuits.ts` | The circuits: a hard-clip distortion, a mid-hump overdrive, a 12AX7 gain stage, and the bass/mid/treble tone stack most guitar amps share. |
| `src/circuit/rig.ts` | Circuits in a row, run at 4× the sample rate so clipping doesn't alias into fizz, then a stand-in power stage and a cabinet EQ. `Rig` streams a block at a time with live knobs; `runRig` does a whole buffer. |
| `src/circuit/amps.ts` | The Q amps and pedals, their knobs, and `buildRig` (an amp, a pedal and the knobs into a rig). `RIGS` is each at its own settings. |
| `src/circuit/riff.ts` | The dry guitar riff (Karplus-Strong plucks, seeded). |
| `src/amp/` | Q Amp: `live.ts` (settings into a rig, rebuilding only what changed; the limiter), `worklet.ts` (the audio thread), `screens.ts`, `main.ts`, `amp.css`. |
| `native/crates/fm_daw/src/circuit.rs` | The solver and the rig in Rust, step for step, with an `fm_amp_*` C surface in the engine's wasm. `src/circuit/wasm.ts` (`WasmRig`) drives it with the same knobs as `Rig`; `encodeNetlist` in `mna.ts` hands it a netlist as numbers. |
| `src/circuit/tscircuit.ts` | Reads a tscircuit board's JSON and makes a netlist of it. |
| `circuits/hard-clip.tsx` | The hard-clip pedal drawn as a tscircuit board. `test/fixtures/hard-clip.circuit.json` is what tscircuit rendered from it. |
| `scripts/amp.ts` | Plucks a guitar riff (Karplus-Strong), runs it through every rig, writes WAVs, prints the speed. |
| `test/circuit.test.ts` | The tscircuit board plays like the hand-written circuit; the solver hits textbook numbers; no rig blows up on a hot input; the Rust port plays every rig like the TypeScript one while the knobs turn. |
| `test/amp.test.ts` | Working Q Amp's panel while the riff plays: only what moved is rebuilt, nothing passes −1 dBFS, no Newton misses. |

## How it works

Every part is a rule about current and voltage. A resistor's current is its voltage over its resistance. A capacitor remembers the voltage it had a moment ago. A diode passes almost nothing until about 0.6 V, then a flood. A tube passes plate current depending on the voltage on its grid. Put the rules for every connection point in one table (modified nodal analysis, the method SPICE uses) and solve it again every sample.

The bends (diodes, tubes) are solved by Newton's method: guess, see how wrong the guess is, correct, repeat until it stops moving. That takes 2 to 4 tries per sample here.

The speed trick: everything that doesn't bend is the same every sample, so its table is inverted once when the circuit loads. Only the bending parts are solved each sample: a 2×2 problem for a tube stage instead of the whole 8×8 circuit. This is the idea behind the K-method and DK-method that published amp simulations use (Borin, De Poli & Rocchesso 2000; Yeh 2009). Most of the time now goes to the tube's math (`exp`, `log`), not to the table.

The models are published and checked:

- **12AX7 tube:** Koren's plate-current equation (1996) and Cohen and Helie's grid current (2010). A stage with a 100k plate load and a bypassed 1.5k cathode rests at 217 V on a 300 V supply and gains about ×52, as the textbooks say (the test checks this).
- **Diodes:** the Shockley equation, with SPICE's step limiting so a guess can't fly up the exponential.
- **Op-amps:** gain 200,000 and 3 MHz bandwidth (like a TL072), with the output clamped near the rails. The finite bandwidth matters: an ideal op-amp with a hard rail made Newton bounce between two answers on thousands of samples.

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

`scripts/amp.ts` also renders `boosted-lead` (the overdrive at zero drive in front of the amp, which tightens it, as metal players do) and `hard-clip-tscircuit` (the pedal read from the tscircuit board).

## Speed

On the 64 GB builder Mac, one thread, 4× oversampled, `bun scripts/amp.ts` (seconds of audio per second of work):

| Rig | × real time |
|---|---|
| hard-clip, overdrive | 5.4, 5.8 |
| brit (3 stages) | 3.1 |
| lead, triple (4 stages) | 2.4, 2.3 |
| overdrive into lead | 1.7 |

One amp fits in an audio thread with room to spare; a pedalboard plus amp is tight. Q Amp's Eco runs everything at 2× instead of 4× (half the work; tubes clip softly, so they alias less).

**The Rust port, measured** (`bun run bench`, the builder Mac on battery, the riff through each rig; Rust as wasm, the way an AudioWorklet runs it):

| Rig | Rust (wasm) | TypeScript |
|---|---|---|
| hard-clip, overdrive | 5.5, 6.2 | 4.6, 5.2 |
| brit | 2.6 | 2.7 |
| lead, triple | 2.0, 2.0 | 2.1, 2.1 |

So no faster: the time goes to `exp` and `log` in the tube model, which Bun's JIT runs in native code and wasm runs in software. The port is still worth having (it runs where the engine runs, and over FFI in the desktop app), and the parity test is how the next speedup gets checked: the pedals come out bit for bit, the tube amps within one f32 step (the two sides' `exp` and `tanh` differ in the last bit).

## tscircuit

tscircuit renders a board to circuit JSON. Its `source_*` elements are the schematic, and every port already names its net, so turning a board into a netlist is a lookup. `boardToNetlist` reads resistors, capacitors and diodes, and chips by their pin labels: `OUT`/`INP`/`INN` is an op-amp, `PLATE`/`GRID`/`CATHODE` a 12AX7. Name a net in `supplies` to put a DC supply on it (`{ B_PLUS: 300 }`).

tscircuit itself stays out of this app: it is parked in this repo because it pins zod 3 (see `apps/tscircuit-desktop`). The app reads only its JSON. To change the board, render `circuits/hard-clip.tsx` in a scratch folder (the command is at its top) and replace the fixture.

## Circuits from pedal kit sites

Kit sellers' build documents (layouts, photos, text) are their work, so none of it goes in this repo. A circuit's topology and part values are what we model; write those from the textbook topology with our own values, as `circuits.ts` does, and name a circuit by what it does, not after a product.

## Next

In order, each one usable on its own:

1. **An Amp insert on an FM DAW track** ([#4555](https://github.com/QuinnsCode/RustyBuns/issues/4555)): Q Amp's live chain (`src/amp/live.ts`) after a track's voices, knobs as track params saved with the project.
2. **Q Amp on a 3D stage** ([#4570](https://github.com/QuinnsCode/RustyBuns/issues/4570)): the clear amp, cabinet and pedalboard in three.js, 2.5D or 3D, with the screens behind as stage LED walls.
3. **A faster Rust solver** ([#4599](https://github.com/QuinnsCode/RustyBuns/issues/4599)): the port is in and matches; it needs a cheaper tube model (a table or a polynomial for the `exp`/`log`) before it beats the JIT.
4. **A real power amp:** push-pull output tubes, the output transformer, and supply sag (the amp compressing when you dig in). Today it is a `tanh`.
5. **A real cabinet:** convolve a speaker impulse response instead of the EQ curve.
6. **More parts:** transistors (Ebers-Moll) for transistor fuzzes (Q Fuzz is an op-amp fuzz today) and boosts, JFETs, potentiometers as live knobs.
7. **Voicing by ear** against reference recordings the owner picks.
8. **A plugin build** (VST3 and CLAP through nih-plug) if it should also run in other DAWs.
