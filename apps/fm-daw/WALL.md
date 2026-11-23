# The sound wall

**What it is:** a modular synth in Qollab Studio's gear room (`/studio.html`). It is a Eurorack case on a stand to the right of the rack, with ten modules you patch with cables. Each module is a real circuit, drawn as a tscircuit board with Eurorack power. The sim plays that board, and the same board comes out of `bun scripts/pcb.ts` as Gerbers, a parts list and a front-panel drill template. So a patch you like in the room is also boards a fab can make.

The idea comes from Q Amp's pedals ([ANALOG.md](ANALOG.md) section 8): the circuit is the source, nothing is drawn twice. This page is the sound wall's part of that map.

**It lands in five pull requests**, so each can be read on its own:

1. The solver's new inputs and the board reader's dual and quad chips ([#5704](https://github.com/QuinnsCode/RustyBuns/pull/5704)).
2. The boards: panels, kit, module sources, `pcb.ts` and this page ([#5706](https://github.com/QuinnsCode/RustyBuns/pull/5706)).
3. The fab files `pcb.ts` writes from them, one pull request per module so they merge in parallel ([#5722](https://github.com/QuinnsCode/RustyBuns/pull/5722) to [#5729](https://github.com/QuinnsCode/RustyBuns/pull/5729)).
4. The sims and the engine ([#5709](https://github.com/QuinnsCode/RustyBuns/pull/5709)).
5. The gear room ([#5711](https://github.com/QuinnsCode/RustyBuns/pull/5711)).

Until the last is in, the sections on how the sim plays a module and on playing it in the room describe what those pull requests add.

## Play it

- **Where:** the gear room, `/studio.html`. Walk round the cab to the case right of the rack. The starter system stands in its lower row: one of each module, left to right.
- **Patch:** click a jack to take a cable, then click another jack to plug it in, as with the rest of the room's gear. Drag a knob to turn it. A first voice:
  1. Q Steps CV into Q Saw V/Oct.
  2. Q Saw's Saw into Q Filter In, and Q Filter LP into Q Level In.
  3. Q Steps Gate into Q Swell Gate, and Q Swell Out into Q Level CV.
  4. Q Level Out into Q Bus In 1, and Q Bus Main into Q Out In L.
- **Play it from the keys:** cable Q Keys' V/Oct into Q Saw's V/Oct and its Gate into Q Swell's Gate (in place of Q Steps'). Press Z and the letter keys play it, A to ' from C3, as FM DAW's keyboard does; you stand still until Z again. A MIDI keyboard plugged into the computer plays it too, whenever the speakers are up.
- **In time with the band:** Q Keys' Clock runs at the sesh's tempo (120 bpm on your own), on the band's beat once the sesh's clock is known. Its Div knob picks quarters, eighths or sixteenths. Cable it into Q Steps' Clock to step the sequencer in time, or into Q Hiss' Clock for a new random voltage on each one.
- **Hear it:** M brings the speakers up. The wall plays from where its Q Out stands. The status line at the bottom says "Sound wall playing", or why it is silent.
- **Clock In:** cable any clock (a square, a gate, another module's clock) into Q Steps' Clock and it steps on that instead of its own Rate.
- **Sends and returns:** Q Bus has two aux buses. Turn a channel's A knob up, cable Send A out to a pedal or one of the rack's machines (Q Spring, Q Tape, Q Bucket), and cable that box's out back into Ret A. The return comes back into the main bus on its own knob, as a desk's return does. A send can also go to another module (into Q Filter, say), and a module's out can go into a return.
- **Add a module:** N opens the module list. Pick one and it comes to your hands. Hold it in front of the case and click: it goes into the nearest free spot on the row nearest your hands, snapped to the HP grid. A module out of the case has no power, so it plays nothing.
- **Build sheet:** look at a module (or hold one) and press B. Its sheet has the schematic, the board, the front panel, the parts to order and the files, and one button for the zip. See [Building one](#building-one).
- **Probes:** `qstudio.addModule(kind)`, `await qstudio.wall()` and `await qstudio.moduleSheet(kind)`. See `bun run probe --list fm-daw`.

## The modules

Each module is named by what it does. Each panel is laid out in `circuits/wall-panels.ts`, which the board, the room and the drill template all read.

| Module | What it is | HP | The circuit | How the sim plays it |
|---|---|---|---|---|
| Q Steps | 8-step sequencer | 12 | A 555 astable clock into a CD4017 counter. Each step's pot feeds a Schottky onto a bus, which is buffered and divided by six to 0 to 2 V. The clock is also the gate out. Clock In takes the 555's place while a cable is in it, squared up by a transistor (any clock over about 1.3 V). | Clock rate and duty from R1, R2, Rate and C1. Each step's CV from its pot, the Schottky and the divider. A cabled clock steps it on each rise past the transistor's threshold (Vbe over R8 and R9). |
| Q Saw | VCO | 10 | Sawtooth core. An exponential converter (a matched NPN pair, its reference servoed by an op-amp) feeds an integrator. A comparator and a JFET reset it at 5 V. Saw and pulse (Width) out, exponential FM in. | The core's frequency from its parts: f = I / (C2 × 5 V), I = Iref·e^(−Vb/VT). The CV side's gains come from the board's netlist. PolyBLEP keeps the saw and pulse from aliasing. |
| Q Filter | VCF, 12 dB/octave state-variable | 10 | Two LM13700 OTAs as integrators with an op-amp summer, as in the LM13700 datasheet, giving LP, BP and HP at once. A three-PNP exponential converter sets both OTAs' bias. | The filter loop runs in the circuit solver every sample. The converter's current comes from its parts and is pushed into the OTAs' bias pins. |
| Q Level | VCA, linear | 6 | One LM13700 OTA, with an op-amp current-to-voltage stage (so 0 V out at rest) and a linear current sink and PNP mirror on its bias pin. | The OTA and output op-amp run in the solver. The bias current is P_CTL / R10, from the control side's netlist gains. |
| Q Swell | Envelope (attack, sustain on gate, release) | 6 | A comparator squares the gate, and diodes steer one capacitor: attack in through one diode, release out through a Schottky. | The whole board runs in the solver. |
| Q Wobble | LFO, triangle and square | 6 | An integrator and a Schmitt trigger. | Rate and levels from R1, Rate, C1 and the divider R2/R3. |
| Q Bus | Mixer: 4 channels, sends A and B, returns A and B, main | 16 | A buffer after each channel's level, then inverting summers (with an inverter after each) for main, A and B. DC-coupled, so it mixes CV too. | The board's own gains from its netlist (`src/wall/linear.ts`), worked out again when a knob moves. |
| Q Out | Line out to the room | 6 | Level, a 300k/100k divider to line level, and a buffer per side. In R takes In L when nothing is in it. | Its board's gains, as Q Bus. |
| Q Hiss | Noise, sample and hold | 6 | A transistor's base-emitter junction in breakdown, amplified a hundredfold. A clock's edge, high-passed and squared by a comparator, opens a JFET onto a 1 nF hold capacitor for a fifth of a millisecond. S&H In takes the noise when nothing is in it. | White noise at the junction (20 mV rms, a typical part) through the board's coupling, gain and the op-amp's bandwidth. The sample and hold tracks while the high-passed clock is over the comparator's threshold. |
| Q Keys | MIDI to CV and clock | 6 | MIDI in at the back (an opto input), an ATtiny1614 and an MCP4822 DAC on their own 5 V, and a TL074 doubling each output: V/Oct from C2 at 0 V (trimmed by RT1), Gate 0 to 10 V, Vel 0 to 8 V, and the MIDI clock divided by Div. | The firmware's logic (last key held, the clock counted down), written to the DAC in its 1 mV steps, through the board's own output gains. |

A module that switches (the clocks, the oscillators, the sample and hold) is read off its parts rather than solved each sample. A module that bends (OTAs, diodes) runs its netlist in the solver. A module that is linear mixes with its board's gain matrix. Change a part on a board and the sound follows: for example, C2 on Q Saw sets its pitch.

All levels are Eurorack's: audio is ±5 V, pitch is 1 V an octave, and gates are 0 to 10 V. Between a mixer's send and the room's gear, the wall turns 5 V into a hot 1 V line and back again. That return comes back one block late (128 samples, 2.7 ms at 48 kHz), because Q Amp's rig runs a block at a time.

## Where the circuits come from

Each circuit is drawn from a textbook topology or a datasheet's application circuit, with our own values. That is the rule for every circuit here ([ANALOG.md](ANALOG.md)): no kit or product layout is copied.

- **LM13700 datasheet** (Texas Instruments, [ti.com/lit/gpn/lm13700](https://www.ti.com/lit/gpn/lm13700)): the OTA amplifier (Q Level) and the state-variable filter (Q Filter). It also has a triangle/square VCO and a stereo volume control.
- **Exponential converter and sawtooth core** (Q Saw, Q Filter's converter): the textbook matched-pair converter. Its reference current is held by an op-amp, and its CV is divided down to VT·ln 2 a volt (17.9 mV at 26 °C). The scale trimmer is RT1.
- **MIDI input** (Q Keys): the MIDI Association's MIDI 1.0 electrical specification (the current loop, an optocoupler with a diode across its LED, 220 ohm in series, [midi.org](https://midi.org/midi-1-0-detailed-specification)), with an HCPL-0601 as the opto. The MCP4822 (Microchip) and ATtiny1614 (Microchip) are used as their datasheets lay them out: the DAC on SPI with LDAC low, the microcontroller's serial in and UPDI pin.
- **NE555 and CD4017 datasheets** (Q Steps): the 555's astable equation, f = 1.44 / ((R1 + 2 R2) C), and the 4017 counting eight with Q8 on its reset.
- **Noise and sample and hold** (Q Hiss): the textbook reverse-biased base-emitter noise source and a JFET track-and-hold, with the clock's edge differentiated into a comparator.
- **Transistor ladder filter**, US patent 3,475,623 (1969, now expired; a scan is at [till.com](https://www.till.com/articles/moog/US03475623.html)). It is not on the wall yet: the solver can play one, but a four-stage ladder of transistor pairs costs several times what Q Filter does (see [Next](#next)).
- **Eurorack mechanics and power**, from Doepfer's A-100 construction details ([doepfer.de/a100_man/a100m_e.htm](https://doepfer.de/a100_man/a100m_e.htm)). Panels are 128.5 mm tall and 1 HP is 5.08 mm, with 84 HP to a row. The 10-pin power header has −12 V on the ribbon's red stripe, ground in the middle and +12 V at the other end.
- **Footprints**, from KiCad's library: the 3.5 mm jack is `Connector_Audio/Jack_3.5mm_QingPu_WQP-PJ398SM_Vertical`, the "Thonkiconn" type (pads S, TN, T at 0, 3.1 and 11.4 mm, bushing at 6.48 mm). The pot is `Potentiometer_THT/Potentiometer_Alpha_RD901F-40-00D_Single_Vertical` (legs 2.5 mm apart, shaft 7.5 mm off the leg row, two mounting tabs). Only their pad positions were taken.

**Open-hardware modules, read but not copied.** These were looked at while choosing the circuits. Their licences are as their repos list them, so check before reusing anything. A share-alike licence would carry over to any board copied from them.

- Erica Synths' discontinued DIY kits: VCO, VCF, VCA, envelope and more, with schematics, Gerbers and BOMs ([github.com/driador/diy-eurorack](https://github.com/driador/diy-eurorack), listed as CC-BY-SA 3.0).
- A VCA and two filters at [github.com/jhbruhn/eurorack](https://github.com/jhbruhn/eurorack) (hardware CC-BY-SA 3.0, code MIT).
- Schematics in the public domain at [github.com/mzuelch/CATs-Eurosynth](https://www.github.com/mzuelch/CATs-Eurosynth).
- An FPGA module (CERN-OHL-S) whose VCO, VCA and filter are gateware, not analog ([github.com/apfelaudio/eurorack-pmod](https://github.com/apfelaudio/eurorack-pmod)).

## The boards

`circuits/wall-kit.tsx` holds what every module shares:
- The 10-pin power header, with an SS14 Schottky in series on each rail, so a ribbon on backwards does nothing.
- A 10 µF on each rail, and 100 nF on each rail of every chip.
- The panel's jacks and pots, where `wall-panels.ts` puts them.

Each module file (`wall-vco.tsx` and so on) brings only its own circuit. Small parts are surface mount (0805, SOIC, SOT-23, SOD-123), for a fab to assemble. The jacks, pots and header are through-hole, soldered by hand with the panel on.

`bun scripts/pcb.ts wall` (or `bun scripts/pcb.ts vco` for one) packs, autoroutes and DRC-checks each board, then writes `circuits/wall-<id>/`:
- `gerbers/` (copper, mask, silkscreen, outline, drill)
- `bom.csv` and `pnp.csv`
- `pcb.svg`
- `drill.svg`, the front panel's drill template at 100%: jacks 6 mm, pots 7 mm, rail screws 3.2 mm
- `schematic.svg`, the circuit, for the build sheet
- `panel/`, the front panel as a board of its own (`circuits/wall-panel.tsx`): `gerbers/` and `pcb.svg`. It is FR4 the panel's size, with the same holes as `drill.svg` (from `panelHoles` in `wall-panels.ts`), the module's name and each label in silkscreen, and no copper.

It also writes `circuits/wall-<id>.circuit.json`, the netlist the sim reads. Every board places, routes and passes DRC with 0 errors:

| Board | HP | Parts | Traces | Vias | Chips |
|---|---|---|---|---|---|
| Q Steps | 12 | 46 | 99 | 66 | NE555, CD4017, TL072 |
| Q Saw | 10 | 49 | 99 | 70 | TL074, TL072 |
| Q Filter | 10 | 48 | 104 | 48 | TL074, LM13700, TL072 |
| Q Level | 6 | 36 | 78 | 39 | TL074, LM13700 |
| Q Swell | 6 | 24 | 47 | 11 | TL072 |
| Q Wobble | 6 | 18 | 39 | 7 | TL072 |
| Q Bus | 16 | 64 | 136 | 118 | 2 × TL074, TL072 |
| Q Out | 6 | 20 | 42 | 14 | TL072 |
| Q Hiss | 6 | 30 | 62 | 31 | TL074 |
| Q Keys | 6 | 40 | 93 | 44 | LM78L05, HCPL-0601, ATtiny1614, MCP4822, TL074 |

The set fits one 84 HP row of the case (`test/wall-panels.test.ts` checks it); the upper row is free for more.

**A finding about the power header.** tscircuit numbers a two-row header around its outline, like a chip: pins 1 and 2 down the first column, 3 to 6 along one row, 7 to 10 back along the other. A ribbon cable numbers it with odd pins on one row and even on the other. With ribbon numbering, +12 V would have landed on two of the board's ground pins. The kit labels the header's pins by where tscircuit puts them, and `pcb.ts` fails any module board whose ±12 V pads aren't its two end columns.

**What simulating the real boards caught.** Every board was played before it was finished, and five drafts were wrong:
- Q Swell's first draft clamped its low side at −0.6 V with a diode to ground, so the envelope rested at −0.6 V, which every CV it fed would have carried.
- A 10k hold-down resistor in Q Swell's release path made the fastest release 110 ms. It is 2.2k now.
- A silicon release diode in Q Swell rested at 0.3 V, which leaks a VCA open by about −25 dB between notes. D3 is a Schottky now: a few hundredths of a volt.
- Q Out's first divider (30k/10k) loaded its level pot's wiper so much that the knob's turn changed. It is 300k/100k now: the same ratio, ten times lighter.
- Q Steps' first divider gave 2.1 V a full turn, which put the default pattern a quarter of a semitone sharp at the top. It is 49.9k/10k now: 2.0 V a turn.

**Speed.** The first voice above, with all eight modules in the case, renders at 3.6× real time on the office Mac, plain TypeScript. In the page it takes about 28% of its own audio thread. Q Filter is the heaviest module at about 2.9 µs a sample, then Q Swell at about 1.5 µs.

## Building one

The boards are made to be built, but none has been built yet. What a build takes:
- **Per module:** B on it in the gear room opens its build sheet; its download (`wall-<id>-kit.zip`) holds everything below and a `build-sheet.txt` in plain words.
  - `gerbers/` to a fab, with `bom.csv` and `pnp.csv` for SMD assembly (or hand soldering).
  - `panel/gerbers/` to the same fab: the front panel, 1.6 mm FR4. `drill.svg` is still there for an aluminium blank.
  - `order.csv`: one row per part to buy, with its quantity, maker and part number (MPN), for a shop's BOM upload. The table is `src/kit/parts.ts`: Yageo 0805 resistors (RT thin film for the 0.1% ones), Samsung ceramics, TI and onsemi chips and transistors, and the hand-soldered parts: Thonk PJ398SM jacks, Alpha RD901F-40 9 mm pots and a Würth 2×5 shrouded header. Every part on every module has one (`test/kit.test.ts` checks it). The MPNs are standard parts, not checked against a shop's stock: a shop may offer a twin with another suffix.
- **Power:** a Eurorack case with a ±12 V supply and ribbon cables. Those aren't on these boards.
- **Cost:** not worked out here. The boards are 108 mm tall, which is over the cheap 100 × 100 mm price tier the pedal spike quoted ([ANALOG.md](ANALOG.md#what-the-spike-found-4832)), so it takes a fab quote. Prices and the order are the owner's.

**Not checked by hand yet:**
- **Footprints:** the jack and pot footprints follow KiCad's library, but they haven't been tried against parts in hand. The trimmer RT1 (Q Saw's scale) uses a 2.54 mm in-line footprint, which is right for a 3362P-style trimmer, but check yours.
- **Hole sizes:** the 7 mm pot hole and 6 mm jack hole are the usual sizes for these parts. Check yours.
- **Timing capacitors:** Q Steps' C1, Q Swell's C1 and Q Wobble's C1 are X7R ceramics, which lose capacitance with voltage and temperature. Times may run 10 to 30% short of the sim's. A film or C0G part holds them.
- **Q Keys' firmware isn't written yet** ([#5749](https://github.com/QuinnsCode/RustyBuns/issues/5749)): the board has the microcontroller and its UPDI header (JP3), and the sim plays what the firmware should do. Its MIDI comes in on a 3-pin header at the back (JP2: source, sink, shield), for a TRS or DIN lead; a front-panel MIDI jack would need a stereo jack footprint the kit doesn't have yet.
- **Q Saw's tracking:** Q1 and Q2 must be matched and touching (or one dual part), and RT1 trimmed until an octave is an octave. The sim is the trimmed board at 26 °C.
- **Q Hiss' level:** how loud a junction hisses varies several times from one transistor to the next. Pick a loud one, or change R4 (the gain) to suit. Q2 is a J201 because its pinch-off (under 1.5 V) holds it off across ±5 V with the gate at −11 V; a J111 may not.
- **What the sim leaves out:** VCO drift, the 555's longer first cycle, Q Level's current-mirror mismatch, and the LM13700's Darlington buffers (not used here: op-amps buffer instead).

## What's where

| File | What it does |
|---|---|
| `circuits/wall-panels.ts` | Each module's panel: HP, every jack and knob by name, label, position and the board part it is, knob defaults and tapers. |
| `circuits/wall-kit.tsx` | The Eurorack power, jack and pot footprints, chip pinouts (TL072, TL074, LM13700, NE555, CD4017), and `wallBoard()`. |
| `circuits/wall-<id>.tsx` | Each module's circuit. `wall-<id>/` holds its fab files, and `wall-<id>.circuit.json` the netlist the sim reads. |
| `src/wall/linear.ts` | A linear board's gains from its netlist: the mixers, and every module's control side. |
| `src/wall/sims.ts` | Each module as sound, from its board. |
| `src/wall/wall.ts` | The patch at work: modules in cable order, a sample at a time, the sends' room gear a block at a time. `renderWall` for tests. |
| `src/room/wall-worklet.ts` | The wall's own audio thread in the gear room: the patch, the keys played and the sesh's tempo. |
| `src/room/room.ts` | The modules as room gear (`moduleGear`), the case's rows (`inCase`, where a module lands), and `listen().wall`. |
| `src/room/models.ts` | The case on its stand and each module's labelled panel. |
| `packages/gear/src/circuit/mna.ts` | What the solver gained for the wall: several driven inputs (`supplyAt`, `drive`), current sources (`I`, `sourceInto`, `push`), pots folded into resistors (`fixPots`), and carrying a circuit's charge over a rebuild (`adopt`). TypeScript only. |
| `test/wall.test.ts` | The journey (patch a voice, hear it follow the sequencer, add a module, loop a send through the spring, lose a module's power), and each board doing what its panel says. |

## Next

- The studios' gear wall (`/jam.html`) draws the case but doesn't play it yet. In a sesh, everyone's page should run the same wall from the shared patch, as the cab's chain does ([#5688](https://github.com/QuinnsCode/RustyBuns/issues/5688)).
- More modules for the upper row: a bucket-brigade delay ([#5747](https://github.com/QuinnsCode/RustyBuns/issues/5747), BBD stock first) and the transistor ladder filter ([#5748](https://github.com/QuinnsCode/RustyBuns/issues/5748), measured first).
- A prototype order and build, then the loop the pedals plan: record the built module, play the same patch in the sim, and compare. Whether to order one is the owner's call (a manual run).
