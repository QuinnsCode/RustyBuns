# Circuit amp spike

**The question:** can FM DAW model guitar pedals and tube amps as real circuits (resistors, capacitors, diodes, op-amps, tubes), drawn as boards in tscircuit, and play a guitar through them?

**The answer: yes.** The solver here runs a full four-tube amp 2.3 to 3.1 times faster than real time in plain TypeScript, a pedal 5 to 6 times, and a board drawn in tscircuit plays sample for sample like the same circuit written by hand. What's missing is the live path (guitar in, sound out, while you play), a real power amp and speaker cabinet, and the Rust port. Those steps are listed under [Next](#next).

Hear it, speakers down (every file is normalized to −1 dBFS):

```
cd apps/fm-daw
bun scripts/amp.ts --play     # a dry guitar riff, then every pedal and amp below
```

## What's here

| File | What it does |
|---|---|
| `src/circuit/mna.ts` | The circuit solver. Give it parts and the nodes they connect to; it gives back the output voltage, one sample at a time. |
| `src/circuit/circuits.ts` | The circuits: a hard-clip distortion, a mid-hump overdrive, a 12AX7 gain stage, and the bass/mid/treble tone stack most guitar amps share. |
| `src/circuit/rig.ts` | Circuits in a row, run at 4× the sample rate so clipping doesn't alias into fizz, then a stand-in power stage and a cabinet EQ. Five voicings in `RIGS`. |
| `src/circuit/tscircuit.ts` | Reads a tscircuit board's JSON and makes a netlist of it. |
| `circuits/hard-clip.tsx` | The hard-clip pedal drawn as a tscircuit board. `test/fixtures/hard-clip.circuit.json` is what tscircuit rendered from it. |
| `scripts/amp.ts` | Plucks a guitar riff (Karplus-Strong), runs it through every rig, writes WAVs, prints the speed. |
| `test/circuit.test.ts` | The tscircuit board plays like the hand-written circuit; the solver hits textbook numbers; no rig blows up on a hot input. |

## How it works

Every part is a rule about current and voltage. A resistor's current is its voltage over its resistance. A capacitor remembers the voltage it had a moment ago. A diode passes almost nothing until about 0.6 V, then a flood. A tube passes plate current depending on the voltage on its grid. Put the rules for every connection point in one table (modified nodal analysis, the method SPICE uses) and solve it again every sample.

The bends (diodes, tubes) are solved by Newton's method: guess, see how wrong the guess is, correct, repeat until it stops moving. That takes 2 to 4 tries per sample here.

The speed trick: everything that doesn't bend is the same every sample, so its table is inverted once when the circuit loads. Only the bending parts are solved each sample: a 2×2 problem for a tube stage instead of the whole 8×8 circuit. This is the idea behind the K-method and DK-method that published amp simulations use (Borin, De Poli & Rocchesso 2000; Yeh 2009). Most of the time now goes to the tube's math (`exp`, `log`), not to the table.

The models are published and checked:

- **12AX7 tube:** Koren's plate-current equation (1996) and Cohen and Helie's grid current (2010). A stage with a 100k plate load and a bypassed 1.5k cathode rests at 217 V on a 300 V supply and gains about ×52, as the textbooks say (the test checks this).
- **Diodes:** the Shockley equation, with SPICE's step limiting so a guess can't fly up the exponential.
- **Op-amps:** gain 200,000 and 3 MHz bandwidth (like a TL072), with the output clamped near the rails. The finite bandwidth matters: an ideal op-amp with a hard rail made Newton bounce between two answers on thousands of samples.

## The voicings

All five are built from the same parts. Their values are starting points to tune by ear, not copies of any product.

| Rig | What it is |
|---|---|
| `hard-clip` | Op-amp gain of ×101, then two silicon diodes to ground that cut the tops flat. Classic distortion pedal. |
| `overdrive` | The diodes in the op-amp's feedback loop round the wave off instead, and only frequencies above ~720 Hz get the gain: the mids push, the lows stay clean. |
| `brit` | Three tube stages, the middle one biased cold, then the tone stack. British crunch to lead. |
| `us-high-gain` | Four stages with small coupling caps (tight lows) and two cold clippers. Saturated high gain. |
| `scooped` | Big bypass caps early (fat), a scooped tone stack. Modern and loose. |

`scripts/amp.ts` also renders `boosted-us-high-gain` (the overdrive at zero drive in front of the amp, which tightens it, as metal players do) and `hard-clip-tscircuit` (the pedal read from the tscircuit board).

## Speed

On the 64 GB builder Mac, one thread, 4× oversampled, `bun scripts/amp.ts` (seconds of audio per second of work):

| Rig | × real time |
|---|---|
| hard-clip, overdrive | 5.4, 5.8 |
| brit (3 stages) | 3.1 |
| us-high-gain, scooped (4 stages) | 2.4, 2.3 |
| overdrive into us-high-gain | 1.7 |

One amp fits in an audio thread with room to spare; a pedalboard plus amp is tight. Two ways to get more, both untried: run the tubes at 2× instead of 4× (tubes clip softly, so they alias less), and the Rust port below (Rust is usually several times faster than JavaScript at this kind of math; not measured here).

## tscircuit

tscircuit renders a board to circuit JSON. Its `source_*` elements are the schematic, and every port already names its net, so turning a board into a netlist is a lookup. `boardToNetlist` reads resistors, capacitors and diodes, and chips by their pin labels: `OUT`/`INP`/`INN` is an op-amp, `PLATE`/`GRID`/`CATHODE` a 12AX7. Name a net in `supplies` to put a DC supply on it (`{ B_PLUS: 300 }`).

tscircuit itself stays out of this app: it is parked in this repo because it pins zod 3 (see `apps/tscircuit-desktop`). The app reads only its JSON. To change the board, render `circuits/hard-clip.tsx` in a scratch folder (the command is at its top) and replace the fixture.

## Circuits from pedal kit sites

Kit sellers' build documents (layouts, photos, text) are their work, so none of it goes in this repo. A circuit's topology and part values are what we model; write those from the textbook topology with our own values, as `circuits.ts` does, and name a circuit by what it does, not after a product.

## Next

In order, each one usable on its own:

1. **Live in FM DAW.** An Amp insert on a track: the rig in the AudioWorklet, guitar in through `getUserMedia` (echo cancellation and auto gain off), knobs as track params. Changing a knob changes resistor values, so the linear table is inverted again (microseconds for an 8×8).
2. **Rust port** into `native/crates/fm_daw`, beside the EQ, with the same bit-for-bit parity test against the TypeScript solver.
3. **A real power amp:** push-pull output tubes, the output transformer, and supply sag (the amp compressing when you dig in). Today it is a `tanh`.
4. **A real cabinet:** convolve a speaker impulse response instead of the EQ curve.
5. **More parts:** transistors (Ebers-Moll) for fuzzes and boosts, JFETs, potentiometers as live knobs.
6. **Voicing by ear** against reference recordings the owner picks.
7. **A plugin build** (VST3 and CLAP through nih-plug) if it should also run in other DAWs.
