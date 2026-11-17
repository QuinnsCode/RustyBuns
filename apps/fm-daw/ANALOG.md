# How far the analog idea goes

Q Amp ([CIRCUITS.md](CIRCUITS.md)) plays a guitar through real circuits: resistors, capacitors, diodes, op-amps and 12AX7s, solved every sample. That one idea goes much further than distortion. This page maps how far, in the order worth building. Section 1's first six parts and section 4's machines are built; the rest is not yet. Each lane has its own issue.

**The big picture in one line:** every sound in Q Amp is a circuit, every circuit is a tscircuit board, so every sound is something you can **hear, change part by part, and then hold in your hand** as a kit or a built pedal.

What we are not doing: copying products. We name a circuit by what it does ("two-transistor fuzz", "four-stage phaser"), write it from the textbook topology with our own values, and keep kit sellers' layouts and documents out of the repo (see [CIRCUITS.md](CIRCUITS.md#circuits-from-pedal-kit-sites)).

## 1. More parts in the solver

The solver knew R, C, V, diode, op-amp and 12AX7. Almost every classic pedal and amp needs only a few more. The first six rows are in (#4826): `BJT`, `JFET`, `L`, `Pot` (`Circuit.setPot` and `Rig.setPot` turn it live, gliding over 10 ms), `LDR` and `OTA` in `mna.ts` and `circuit.rs`, with their textbook numbers in `test/circuit.test.ts`. In TypeScript only (not `circuit.rs` yet) there is also a rail-less op-amp and a `VarR`: a resistor a control moves (a rig `Mod`: an LFO or the signal's envelope), standing in for a JFET's channel, an LDR under a lamp or LED, or a pot under a foot. The effects in `src/circuit/effects.ts` use them:

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
  - Split the chain over worker threads with a `SharedArrayBuffer` ring, one audio block (2.7 ms at 48 kHz) of extra latency per hop. Built (#4948, `src/amp/ring.ts`, `threads.ts`): a third of a second over budget, the chain is cut at the slot boundaries that share each link's work (`Rig.work`) out best, up to three threads; the cut parts hand their 4× oversampled volts on, so the sound is the one-thread rig's to the bit, a block later per hop. The bar shows the hop.
  - Show each slot's share of the load on the board, so players see what costs what, as on hardware DSP units.

## 3. Effects that are circuits

These fit the solver as it is, once section 1's parts are in:

| Effect | The circuit | Notes |
|---|---|---|
| **Phaser** | 4 or 6 all-pass stages (op-amp + capacitor + JFET as the resistor), an LFO moving the JFETs' gates | The notches move; feedback ("Regen") sharpens them |
| **Vibe** | 4 phase-shift stages with LDRs, all lit by one lamp | The lamp heats and cools slower than it is driven, so the sweep is lopsided: that is the sound |
| **Tremolo** | Optical (LED + LDR on the signal) or bias (the LFO on a tube's grid) | Bias tremolo is the amp's own tubes: Q Clean T's LFO on its power tubes' bias (`power.ts`) |
| **Wah** | Inductor + capacitor peak inside a transistor feedback loop, a pot on the treadle | An expression pedal or a MIDI CC moves the pot; an envelope moves it for an auto-wah |
| **Compressor** | OTA or optical (LED + LDR in a feedback loop) | The LDR's slow release is why optical ones sound smooth |
| **Octave up** | A full-wave rectifier (diodes, or a transformer and diodes) after a fuzz | Folding the wave doubles its pitch |
| **Boosts and fuzzes** | One- to three-transistor stages, germanium or silicon | Germanium's leakage changes with temperature: a "warm room" knob is honest here |

On Q Amp's floor now (`src/circuit/amps.ts`, a `PEDALS` row each, tested in `test/effects.test.ts`): Q Phase, Q Vibe,
Q Trem (optical), Q Wah, Q Envelope (the wah on an envelope), Q Squeeze (optical), Q Octave and Q Germ (two germanium
transistors, its one knob the room's temperature). What moves a `VarR` is a rig `Mod` (`rig.ts`): an LFO or the link's own
output, through `[rise, fall]` lags that are the lamp heating and cooling and the LDR darkening and recovering. Each is a board, `circuits/<pedal id>.tsx`, with its moving part drawn as the JFET, photocell, vactrol or pot it is (#4952), so the board view shows it. Each pedal has
one knob until the pedalboard (section 2) gives them more. Bias tremolo is in the amp, not on the floor: an LFO on the power stage's bias supply, Q Clean T's Rate and Depth.

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

**Built** (`packages/gear/src/circuit/machines.ts`, on Q Amp as Q Bucket, Q Tape and Q Spring on the pedalboard): all three, any of them on at once, after the amp's tile in its effects loop (after the tone stack, before the power stage) or in front of it, in whatever order you drag them. Q Bucket is stereo: a second chip on the right, its LFO half a turn behind, and every slot after it runs once per side (#4827). What is a stand-in for now:

- The spring's transformer is a high-pass and a soft ceiling: the solver has no inductor yet (#4826). The 12AT7 driver and the 12AX7 recovery are real tube circuits (the solver gained the 12AT7, TypeScript only; the Rust port still has only the 12AX7).
- Tape's hysteresis uses Chowdhury's constants with his plugin's reversible share (c = 0.7), which keeps quiet notes linear the way AC bias does; there is no simulated bias tone. Head loss is the spacing and gap equations folded into a low-pass that follows the tape speed.
- The bucket brigade's filters stay at one corner per mode rather than following the clock as in Holters and Parker, and its clock noise is jitter, not clock bleed.

## 5. More amps, and the rest of the amp

Q Amp now has a back half ([CIRCUITS.md](CIRCUITS.md#the-back-end)): push-pull output tubes with sag, an output transformer that cares what is on its jack, and a cabinet impulse response with a mic you move. What is left of a real amp's feel:

- **Power amp:** the negative feedback loop with Presence and Resonance knobs.
- **Output transformer:** the inductor from section 1, with a core that saturates.
- **Speaker:** the voice coil's impedance talks back to the output transformer (that is half of why a real amp feels alive), and measured cab IRs alongside the made ones.
- **More voicings**, each named by what it is: a small single-ended class A, a clean amp with spring reverb built in (Q Clean T has the bias tremolo), a bright one with a top boost, a channel-switching high gain. All from the same parts.

## 6. Profiling: a real amp in, a real circuit out

Profiling amps record a real amp and play back a copy of it. Ours can do something they can't: **the copy is a circuit**, so you can see the schematic, change a part, and build it.

1. Play a test signal (sine sweeps at several levels, noise bursts, the riff) through the player's amp, record it through a load box or a mic.
2. Pick the closest topology from our library (the amps in `amps.ts`, a pedal in front).
3. Fit the part values to the recording: resistors, capacitors, bias, kept to values you can buy (the E12 and E24 series). Score with a multi-resolution spectrum error plus how the harmonics grow with level. Fit on the builder Mac (Bob) with an optimizer like CMA-ES, at 2× oversampling to save time.
4. Out comes a netlist, a tscircuit board and a Q Amp voicing, all the same thing.

Honest limit: a topology we don't have only gets the closest one. That gap tells us which circuit to add next.

**Built so far (offline):** `src/circuit/fit.ts` and `bun scripts/profile-amp.ts <amp>`. The script scrambles one of our own amps (each part up to ×/÷ 2), then fits the parts back from a render alone. The test signal is sines at three or four levels, a log sweep and a noise burst. The score is a log spectrum at three frame sizes plus each tone's first five harmonics, level and phase. The search is separable CMA-ES at 2× oversampling, then an E24 snap and a pass that tries one step either way. From a scrambled Q Brit 3, the cathode resistors, bypass caps, power drive and last coupling cap come back exactly. A coupling cap whose corner sits under 10 Hz is marked "can't hear". At one knob setting the tone stack's four parts trade off against each other, so a profile now records three takes (#4943): the amp's own tone settings, then bass up and treble down, then treble up and bass down (`TONE_SETTINGS`). The player turns the knobs between takes. The fit scores the mean over the takes, then runs a second, smaller search over the tone stack and V1's coupling cap alone, with the gain staging held. `--tone-only` checks that second search by itself.

**Capture:** `bun scripts/capture-amp.ts write|record|fit <dir>`. `write` makes the probe as a WAV and the knob sheet. `record` plays it out of the interface (afplay) and records the return (ffmpeg) once per take. `fit` lines each take up against a render of the amp it tries (`src/circuit/capture.ts`: one cross-correlation, so the amp's own delay cancels and only the interface's is left), ignores the recording's level, and fits each of our amps in turn. The closest one comes out as a voicing. The input level into the amp is not fitted yet: use a reamp box at guitar level.

## 7. The board is the source

Done in #4831: every circuit is a board in `circuits/`, the netlist is read from it, and Q Amp has the board view with clipper and capacitor sockets. The plan it followed:

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

**The other way round, a DSP pedal:** the TypeScript solver runs Q Drive in about 1.2 µs per sample on one M1 Pro core (17× real time at 48 kHz, 5× at the rigs' 4× oversampling). A 480 MHz Cortex-M7 audio board has about 10,000 cycles per sample at 48 kHz and 2,500 at 192 kHz. So a single pedal in Rust may fit at 1× or 2× oversampling, a tube amp likely doesn't, and a Cortex-A board has room. That was an estimate from the TS figure. The Rust solver, timed, is in the next part (#4938).

### A pedal on a DSP chip, timed (#4938)

**On a Cortex-M7: no, not as the solver is now, even at 1×. On a Cortex-A board: yes, one pedal, even at 4×.** `bun scripts/pedal-bench.ts` runs each pedal's netlist in TypeScript and in native Rust (`native/crates/fm_daw/examples/pedal_bench.rs`, release build), knob at 10 and the riff at 0.5 V, and counts the Newton iterations per sample. On the builder (M1 Max, about 3.2 GHz):

| Pedal | Unknowns, ports | TS ns / sample | Rust ns / sample | Newton iterations (mean, most) | Host cycles / sample |
|---|---|---|---|---|---|
| Q Drive | 9, 4 | 1,190 | 800 | 4.6, 18 | about 2,600 |
| Q Dist | 10, 4 | 1,260 | 850 | 4.9, 18 | about 2,700 |
| Q Germ | 11, 4 | 1,220 | 810 | 4.3, 18 | about 2,600 |
| Q Fuzz | 10, 6 | 2,430 | 1,690 | 4.7, 20 | about 5,400 |

Those are at 48 kHz; at 96 and 192 kHz the cost per sample stays within 10% (oversampling doesn't cut the iterations much, about 4.2 to 4.9 at every rate). The M7's budget is 10,000 cycles per sample at 48 kHz, 5,000 at 96 kHz and 2,500 at 192 kHz.

- **Rust is only 1.5× the TypeScript.** Bun's JIT does well on this flat f64 loop; the cost is in the algorithm, not the language. Most of it is the Newton loop: for each iteration it builds the ports' Jacobian as a dense `ports³` product, though most entries are zero.
- **Why the M7 misses:** the same f64 code on a 480 MHz M7 runs at about one instruction per cycle against the M1's four or more, its f64 unit is slower than its f32 one, and `exp` (every diode, every iteration) is in software. That is 3 to 6 times the M1's cycles: 8,000 to 15,000 for Q Drive at 48 kHz on average, and real time is set by the hard samples (18 iterations, about 4 times the mean). A board run would only confirm it, so we didn't build for `thumbv7em-none-eabihf` (the crate needs `std` today, and a board is the owner's to buy).
- **A Cortex-A board fits:** a Pi-class Cortex-A72 at 1.5 GHz is about a third of an M1 core, so Q Drive at 4× (192 kHz) takes about 2.5 µs of its 5.2 µs, with room for one pedal but not a tube amp behind it.
- **Not in Rust yet:** Q Phase, Q Vibe, Q Wah, Q Envelope and Q Octave (a rail-less op-amp), Q Trem and Q Squeeze (`VarR`). In TypeScript they cost 170 ns (Q Trem) to 2,430 ns (Q Octave) per sample.
- **To fit an M7** (#5109): a sparse Jacobian, a cap on iterations per sample, an f32 build, then `no_std` and a cycle count on a board.

**Owner decisions, listed, not answered:**

1. Sell built pedals at all? It needs FCC (US) and CE (EU) checks, and a returns and repair story. Kits need less.
2. The hardware license for our layouts (open hardware like CERN-OHL, or the app's own license).
3. Kit, built, or only "order your own".
4. Tube amps stay off kits (300 V). A low-voltage 12AX7 preamp (12 to 24 V) is a later maybe.

### Every pedal on the floor (#5057)

**Every pedal on the gear room's wall has fab files now: Q Drive, Q Fuzz, Q Dist and Q Squeeze.** The box they share (supply, bias, Level, LED, jack and footswitch pads) is `circuits/q-box.tsx`; each pedal file (`q-drive.tsx`, `q-fuzz.tsx`, `q-dist.tsx`, `q-squeeze.tsx`) brings only its own circuit and Drive pot. `bun scripts/pcb.ts` renders all of them, `bun scripts/pcb.ts fuzz` one, into `circuits/q-<pedal>/` with the same file names as `q-drive/`. All four place, route and pass DRC with 0 errors on a 58 × 68 mm board.

- **The sim's names stay:** the box's parts take the first free numbers after the pedal's own, so D1, D3 or C4 on the board is the socket the app swaps. Q Drive's files came out the same as before, apart from timestamps.
- **Diodes to ground, on 9 V:** Q Dist and Q Fuzz clip to ground in the sim. On a 9 V board the op-amp's output sits at the 4.5 V bias, so the board clips to the bias instead; to the signal it is the same node.
- **Drive pots:** Q Dist is 10k plus a 200k pot (the app's knob tops out at 200k total), Q Fuzz 20k plus a 2M audio pot, whose turn comes out near the square the app uses. A 2M 16 mm pot is not a stock part at every shop. Both use a 500k Level, so it loads their 10k and 4.7k tone nodes by under 2%.
- **Played like the voicing:** `test/circuit.test.ts` reads each board's netlist back and compares it with its voicing at three Drive turns, one table over the four pedals: each within 3%.
- **Q Squeeze builds its own envelope follower.** In the sim a rig `Mod` lights the vactrol's LED; on the board, C2 and R5 take the output to a 2N3904 (Q1), D1 keeps the negative half off its base, and each peak past about 0.6 V sinks the LED's current through R6. Attack is as quick as the peaks, release is the LDR's own. Its Sustain is 10k plus a 250k audio pot (the sim turns 10k to 310k), R4 (1M) holds the op-amp's input at the bias while the LDR is dark, and its LDR goes to the bias instead of ground. The vactrol is one 4-leg part (an LED and an LDR sealed together); a bare LED and LDR in heat-shrink do the same job. The test leaves the driver out and plays the vactrol dark.

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
6. Profiling: fit a circuit to a real amp's recording ([#4830](https://github.com/QuinnsCode/RustyBuns/issues/4830), offline fit done; tone stack and capture [#4943](https://github.com/QuinnsCode/RustyBuns/issues/4943))
7. The board is the source, with a board view and part swaps ([#4831](https://github.com/QuinnsCode/RustyBuns/issues/4831))
8. Spike: from a tscircuit board to a PCB you can order, as a kit or built ([#4832](https://github.com/QuinnsCode/RustyBuns/issues/4832))
