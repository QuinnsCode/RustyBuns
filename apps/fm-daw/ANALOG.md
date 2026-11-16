# How far the analog idea goes

Q Amp ([CIRCUITS.md](CIRCUITS.md)) plays a guitar through real circuits: resistors, capacitors, diodes, op-amps and 12AX7s, solved every sample. That one idea goes much further than distortion. This page maps how far, in the order worth building. Nothing here is built yet. Each lane has its own issue.

**The big picture in one line:** every sound in Q Amp is a circuit, every circuit is a tscircuit board, so every sound is something you can **hear, change part by part, and then hold in your hand** as a kit or a built pedal.

What we are not doing: copying products. We name a circuit by what it does ("two-transistor fuzz", "four-stage phaser"), write it from the textbook topology with our own values, and keep kit sellers' layouts and documents out of the repo (see [CIRCUITS.md](CIRCUITS.md#circuits-from-pedal-kit-sites)).

## 1. More parts in the solver

The solver knows R, C, V, diode, op-amp and 12AX7. Almost every classic pedal and amp needs only a few more:

| Part | Model | What it opens up |
|---|---|---|
| **BJT** (silicon and germanium) | Ebers-Moll, with leakage for germanium | Transistor fuzzes, boosts, treble boosters, the wah's gain stages, ladder filters |
| **JFET** | Square-law with a triode region | Phaser stages (a JFET as a voltage-controlled resistor), clean boosts, "amp in a box" drives |
| **Inductor** | Companion model like the capacitor, with its wire resistance | The wah (a 500 mH inductor sets its peak), passive tone filters, the output transformer later |
| **Pot** | Two resistors with a wiper and a taper (linear, log, reverse log) | Every knob becomes a real part on the board, and an expression pedal is a pot |
| **LDR + lamp or LED** | Resistance that follows light, with slow, lopsided timing | Optical tremolo, the "throbbing" four-stage vibe, optical compressors |
| **OTA** | Current-controlled gain stage | Envelope filters, OTA compressors, OTA phasers |
| **Pentodes** (EL34, 6L6, EL84 class) | Koren's pentode equation | The real power amp in section 5 |
| **Germanium diode, LED, MOSFET clippers** | The diode model with other constants; a MOSFET as a clipper | The "swap the clipper" mod every drive pedal invites |

Each part needs: the model in `mna.ts`, the same in Rust (`circuit.rs`) held by the parity test, a textbook number in the test (a BJT stage's gain, a JFET's pinch-off), and a tscircuit chip or footprint name that `boardToNetlist` reads.

## 2. The pedalboard

Today there is one pedal slot. A real board is a chain:

- **Slots in any order**, drag to reorder, each with its own footswitch. Drive before or after the phaser sounds different, and that is the point.
- **An effects loop** on the amp: time effects (delay, reverb) sound best after the preamp and before the power amp, as on a real amp.
- **Stereo** after the first stereo effect (chorus, delay, reverb), mono before it.
- **A cost on every slot.** The audio thread is the budget (see [Speed](CIRCUITS.md#speed)): a pedal is 5 to 6× real time, an amp 2.3 to 3.3×. A full board will not fit at 4× oversampling in one thread, so:
  - Oversample only what clips. A phaser or a tone stack runs at 1×; only the diodes and tubes need 4×.
  - Split the chain over worker threads with a `SharedArrayBuffer` ring, one audio block (2.7 ms at 48 kHz) of extra latency per hop.
  - Show each slot's share of the load on the board, so players see what costs what, as on hardware DSP units.

## 3. Effects that are circuits

These fit the solver as it is, once section 1's parts are in:

| Effect | The circuit | Notes |
|---|---|---|
| **Phaser** | 4 or 6 all-pass stages (op-amp + capacitor + JFET as the resistor), an LFO moving the JFETs' gates | The notches move; feedback ("Regen") sharpens them |
| **Vibe** | 4 phase-shift stages with LDRs, all lit by one lamp | The lamp heats and cools slower than it is driven, so the sweep is lopsided: that is the sound |
| **Tremolo** | Optical (LED + LDR on the signal) or bias (the LFO on a tube's grid) | Bias tremolo is the amp's own tube, so it lives inside Q Amp's circuits |
| **Wah** | Inductor + capacitor peak inside a transistor feedback loop, a pot on the treadle | An expression pedal or a MIDI CC moves the pot; an envelope moves it for an auto-wah |
| **Compressor** | OTA or optical (LED + LDR in a feedback loop) | The LDR's slow release is why optical ones sound smooth |
| **Octave up** | A full-wave rectifier (diodes, or a transformer and diodes) after a fuzz | Folding the wave doubles its pitch |
| **Boosts and fuzzes** | One- to three-transistor stages, germanium or silicon | Germanium's leakage changes with temperature: a "warm room" knob is honest here |

## 4. Effects that are machines

Some classic effects are not only circuits. A tape echo is a motor, a tape and three heads; a spring reverb is a steel spring. The electronics around them go in the solver as usual; the machine is its own block in the chain, written from published models:

- **Tape echo.** A record head writes to tape, playback heads read it later. What makes it sound like tape:
  - Magnetic hysteresis on record (the Jiles-Atherton model, solved per sample at 2 to 4× oversampling, as in Chowdhury's real-time tape model, 2019): soft compression and lost highs when you push it.
  - Head loss: the playback gap and the tape's distance from the head take away highs, more at slow tape speed.
  - Wow and flutter: the read position wanders, slow and fast.
  - A speed knob that changes the motor with inertia, so the echoes glide in pitch when you turn it.
  - Several playback heads at fixed spacing, and the feedback path through the record amp's own circuit, so a runaway echo saturates instead of exploding.
- **Bucket-brigade delay, chorus and flanger.** A BBD chip passes the signal down 1024 to 4096 capacitors, one step per clock tick. The delay is set by the clock, so a modulated clock gives chorus and flanger. Model the sampling, the clock noise, the filters around the chip and the compander that hides its hiss (Holters & Parker, 2018). Real BBD chips are hard to buy; check that before one goes on a kit.
- **Spring reverb.** A tube driver pushes a transformer into the spring tank, and a recovery tube reads it. The springs carry high notes faster than low ones, which makes the "boing" chirp. Model it with chains of all-pass filters inside a feedback delay (Välimäki, Parker & Abel, 2010). The driver and recovery stages are 12AX7 and 12AT7 circuits we already solve.
- **Plate reverb** later (a steel plate's modes, more CPU), and only if spring is not enough.

## 5. More amps, and the rest of the amp

Q Amp's three amps are preamps into a `tanh`. A real amp's feel lives in the back half:

- **Power amp:** push-pull pentodes, a phase inverter, the negative feedback loop with Presence and Resonance knobs.
- **Output transformer:** the inductor from section 1, with a core that saturates.
- **Sag:** a tube rectifier and the supply's resistance, so the amp squashes when you dig in and recovers.
- **Speaker:** the voice coil's impedance talks back to the output transformer (that is half of why a real amp feels alive), then a cabinet impulse response and a mic position.
- **More voicings**, each named by what it is: a small single-ended class A, a clean amp with spring reverb and bias tremolo built in, a bright one with a top boost, a channel-switching high gain. All from the same parts.

## 6. Profiling: a real amp in, a real circuit out

Profiling amps record a real amp and play back a copy of it. Ours can do something they can't: **the copy is a circuit**, so you can see the schematic, change a part, and build it.

1. Play a test signal (sine sweeps at several levels, noise bursts, the riff) through the player's amp, record it through a load box or a mic.
2. Pick the closest topology from our library (the amps in `amps.ts`, a pedal in front).
3. Fit the part values to the recording: resistors, capacitors, bias, kept to values you can buy (the E12 and E24 series). Score with a multi-resolution spectrum error plus how the harmonics grow with level. Fit on the builder Mac (Bob) with an optimizer like CMA-ES, at 2× oversampling to save time.
4. Out comes a netlist, a tscircuit board and a Q Amp voicing, all the same thing.

Honest limit: a topology we don't have only gets the closest one. That gap tells us which circuit to add next.

## 7. The board is the source

Today `circuits.ts` writes netlists by hand, and one board (`circuits/hard-clip.tsx`) proves tscircuit can stand in. Flip it:

- **Every circuit is a `.tsx` board.** The netlist is derived from it, never written twice. Tests check each board plays like its voicing.
- **A board view in Q Amp:** the schematic and the PCB of the pedal you are playing, its tube or diodes glowing with the signal.
- **Swap parts and hear it.** Real kit builders put sockets on the clipping diodes and some capacitors so they can try parts. Our board view does the same: click the clipper socket, pick silicon, germanium, LED, MOSFET or none, and hear it while you play. Change a capacitor to tighten the lows. Each change is saved as your version of the board.

## 8. From the screen to your hands

Because the board is the source, the pedal you tuned by ear is already a PCB design. tscircuit routes boards and exports what a factory needs (Gerbers, a parts list, a pick-and-place file). That gives three ways to own it:

- **Order your own:** download the Gerbers and a parts list (with a ready shopping cart at a parts shop), order boards from any fab, solder it yourself.
- **A kit:** the board, the parts, the enclosure drilled for your knob layout, and the swap parts you picked in the app in a labelled bag, with the sockets on the board.
- **Built:** the same board, assembled and tested, in the box.

The loop closes when a built board comes back: record it, play the same riff through the sim, and compare them sample by sample. Part tolerances (5% resistors, transistor gain spread) show up as a band; the sim can run the same tolerances (Monte Carlo) and say how far your build may differ before you order.

What the hardware path needs, for the spike (#4832):

- 9 V pedals first: DC jack with reverse-polarity protection, true-bypass footswitch, LED, jacks, a standard enclosure size and its drill template from the knob layout. Through-hole parts for kits, surface mount for built ones.
- Not tube amps on a kit: 300 V is a safety line. A low-voltage tube preamp (a 12AX7 at 12 to 24 V) sounds different, and the sim can model exactly that, so it is a later option.
- A second hardware path, the other way round: one generic pedal with a DSP chip and a codec running the Rust solver, loading any circuit from the app. The same Rust code that runs in the browser's wasm, if the chip is fast enough (measure it).
- Owner decisions before anything is sold: selling built electronics needs compliance checks (FCC, CE), kits less so; the hardware license for our layouts; what a fab order costs per board.

### What the spike found (#4832)

**Yes, one pedal goes from the board you play to files a fab takes, and nothing is drawn twice.** Q Drive (`circuits/q-drive.tsx`) is the `drive` voicing plus everything a box needs. `bun scripts/pcb.ts` renders it, packs and autoroutes it, runs tscircuit's DRC (0 errors), and writes `circuits/q-drive/`: Gerbers and the drill file, `bom.csv`, `pnp.csv`, `pcb.svg` and `drill.svg`.

- **The board:** 58 × 68 mm, 2 layers, 27 parts, all through-hole. TL071 op-amp on 9 V with a 4.5 V bias, Drive (500k) and Level (100k) as 16 mm board-mount pots, a 1N5817 in series against a reversed adapter, an LED, and wire pads for the jacks, the DC jack and a 3PDT true-bypass footswitch. Only the knobs, LED and pads are placed by hand; tscircuit packs the rest.
- **Sockets:** D1, D2 (the clipping diodes) and C4 (the tone cap) have 1.1 mm holes for machined-pin socket strips, and U1 is a DIP-8, so a kit builder can try the same swaps the app offers (#4831).
- **It still plays like the voicing:** `test/circuit.test.ts` reads the board's own netlist back (9 V and bias as AC ground, the box parts left out, the Drive knob at 0, 0.5 and 1) and compares it with `overdrive()`. It is within 1.6%, and that gap is the Level pot and output cap the voicing doesn't have.
- **Drill template:** the pot and LED holes come from where their legs sit on the PCB, so the box and the board can't disagree. The footswitch, jacks and DC jack go where kit builders usually put them on a 125B box. Two guesses to check by hand: the 7.5 mm from the pot's legs to its shaft, and the 3PDT lug wiring (#4937).
- **tscircuit stays parked:** it pins zod 3, so the script installs it in a scratch folder. The Gerber exporter needs a newer helper than tscircuit pins, so it gets its own folder. Rendering takes about 4 seconds, and the files come out the same each time apart from their timestamps.

**Prices (before ordering; ordering is the owner's, #4937):**

| | 5 boards | Per pedal |
|---|---|---|
| Bare boards (JLCPCB, 2-layer, up to 100 × 100 mm) | about $2 + shipping ($8 to $20) | under $5 with shipping |
| Through-hole hand assembly (JLCPCB: about $3.50 per order + $0.016 per joint, 69 joints) | about $9 + parts | about $2 + parts |
| Parts at a hobby shop (pots, 3PDT, jacks, DC jack, TL071, passives) | | about $12 to $18 |
| 125B box, undrilled | | about $5 |

PCBWay lists 10 bare boards at $5 and doesn't publish a through-hole rate per joint. Its quote tool gives one. These are list prices from the fabs' pages in 2026-11, not a quote. Pots and footswitches are rarely in a fab's own stock, so an assembled order means sending those parts in, or soldering them yourself.

**The three ways to own it, weighed:**

- **Order your own:** works now. The zip is what a fab takes. What's missing is a button in the app and a parts cart (#4939).
- **Kit:** board, parts, drilled box and a bag of the swap parts. Most of the work is buying, packing and posting things. About $20 to $25 of board, parts and box per kit, before packing and postage.
- **Built:** the same board, assembled and tested. This is the one that needs compliance checks (a 9 V analog pedal is low risk, but it is still electronics we sell) and a test rig at our end.

**The other way round, a DSP pedal:** the TypeScript solver runs Q Drive in about 1.2 µs per sample on one M1 Pro core (17× real time at 48 kHz, 5× at the rigs' 4× oversampling). A 480 MHz Cortex-M7 audio board has about 10,000 cycles per sample at 48 kHz and 2,500 at 192 kHz. So a single pedal in Rust may fit at 1× or 2× oversampling, a tube amp likely doesn't, and a Cortex-A board has room. That is an estimate from the TS figure, not a measurement on hardware (#4938).

**Owner decisions, listed, not answered:**

1. Sell built pedals at all? It needs FCC (US) and CE (EU) checks, and a returns and repair story. Kits need less.
2. The hardware license for our layouts (open hardware like CERN-OHL, or the app's own license).
3. Kit, built, or only "order your own".
4. Tube amps stay off kits (300 V). A low-voltage 12AX7 preamp (12 to 24 V) is a later maybe.

Closing the loop (record a built board, compare it with the sim, a Monte Carlo band for part tolerances) waits for boards in hand. The tolerance band is part of #4939.

## 9. Synth and studio, not only guitar

FM DAW is a synth DAW, and the same solver gives it analog parts too:

- **Analog filters on a track:** the transistor ladder low-pass, OTA state-variable filters, a diode ladder. Section 1's BJT and OTA parts are all they need.
- **Tape on the master bus:** section 4's tape model as a mixdown machine (saturation, head bump, gentle wow), after Shape, the master EQ.
- **Spring reverb as a send.**

## Issues

Each lane is its own issue, in this order (each usable on its own):

1. More parts in the solver: BJT, JFET, inductor, pot, LDR, OTA ([#4826](https://github.com/QuinnsCode/RustyBuns/issues/4826))
2. The pedalboard: slots in any order, effects loop, stereo, cost per slot ([#4827](https://github.com/QuinnsCode/RustyBuns/issues/4827))
3. Circuit effects: phaser, vibe, tremolo, wah, compressor ([#4828](https://github.com/QuinnsCode/RustyBuns/issues/4828))
4. Machine effects: tape echo, bucket-brigade delay and chorus, spring reverb ([#4829](https://github.com/QuinnsCode/RustyBuns/issues/4829))
5. The rest of the amp: power amp, output transformer, sag, speaker (CIRCUITS.md [Next](CIRCUITS.md#next) 3 and 4)
6. Profiling: fit a circuit to a real amp's recording ([#4830](https://github.com/QuinnsCode/RustyBuns/issues/4830))
7. The board is the source, with a board view and part swaps ([#4831](https://github.com/QuinnsCode/RustyBuns/issues/4831))
8. Spike: from a tscircuit board to a PCB you can order, as a kit or built ([#4832](https://github.com/QuinnsCode/RustyBuns/issues/4832))
