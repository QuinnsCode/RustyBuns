# @rustybuns/gear

Sound and power math for live-sound gear, with no dependencies. It runs the numbers under Load In, the roadie sim (#4849).

- `GEAR`, `gear(id)`, `jackNames(g)`: generic speakers, amps, a mixer, a DI box, a generator, a distro, ramps and cases. Each has its size, weight and jacks, plus a spec sheet where it has one.
- `splAt(source, point)`: sensitivity + 10 log10(W) - 20 log10(d), minus a smooth off-axis loss that is 6 dB down at the coverage edge.
- `sumPower`, `sumCoherent`, `levelAt`: mids and highs add as power. Subs add with phase from path length, so two subs make lobes and a power alley.
- `arrayPoses(top, yaw, tilt, splays, n, boxH)`, `splayCalc(top, yaw, n, boxH, far, near)`: where each box of a flown line array hangs once its splays are set, and the splay calculator: the top box aimed at the back seat, the ones below at nearer seats spaced by distance in proportion, whole degrees up to `MAX_SPLAY_DEG`.
- Out of doors (`outdoor.ts`): `airAbsorption(freq, tempC, humidity, kPa)` (ISO 9613-1), `speedOfSound(tempC)`, `pressureAt(altitude)`, `reflection(source, face, point)` (a rock face by the image source), `echoOf(arrivals)` (late by 50 ms and within 10 dB), `bendAngle` (wind and temperature gradients), `weatherAtDistance` (night and wind at a far house) and `barrierLoss` (Maekawa).
- `coverage(sources, area, band)`: a `Float32Array` of dB over a floor, for a heat map.
- `ampWatts`, `parallel`, `series`: watts per channel into a load, and what happens below the amp's minimum load.
- `circuitLoad`, `generatorLoad`: mains draw against a 15 A or 20 A breaker, or a generator's kVA.
- `burnLph`, `runHours`: litres an hour a generator burns at a load, and how long a tank (and jerry cans) runs it.
- `cableLoss(awg, metres, ohms)`: dB lost in a speaker cable run.
- `feedback(loop)`: a mic, a channel (trim, EQ) and the wedges it is sent to. Loop gain per third-octave band from the distance, the wedge's off-axis loss, the mic's pattern (a cardioid hears little from behind, and widens in the low mids) and both boxes' own response; the bands over 0 dB ring, and `margin` is the gain left before any does.
- `fillFloor`, `crowdLoss`, `coverageThrough`, `reverbTime`, `crowdNoise`: a crowd as people per m2, packed at the stage. Bodies in the line under head height take mids and highs (about 10 dB per 10 m at 4 kHz through a packed crowd, next to nothing in the bass), each person adds about 0.45 m2 of Sabine absorption so a full room rings shorter, and a crowd is 85 to 95 dB on its own.
- `SYSTEMS`, `system(id)`, `systemSound(s)`, `stackWidth(s)`, `passive(s)` (`systems.ts`): five open-air rigs for a dance floor, each our own boxes in a well-known family: the horn stack (horn-loaded all the way down), synergy horns over tapped-horn 18s, the sculpted array on triple-21 hybrid horns, the tri-amp touring stack, and a ground-stacked line array on 18" subs (powered: `passive` is false). Each carries `setup`: how a crew stands it up, from the family's setup guides. A rig is one stack bottom to top, its pattern and low end from its boxes' sheets, and its family's voicing as a few EQ bands. Qollab Studio's Desert Gathering draws and plays whichever its room (or `?rig=`) asks for. See "Where the numbers come from" below.
- `compile(placed, cables, { outlets })`: a patch of gear, cables and wall outlets. It returns which speakers are fed and a list of problems, each naming the items and jack: wrong cable, jack used twice, two outputs joined, a load below the amp minimum, a tripped breaker, a loop, no power, and a DI hum: its thru and XLR both on mains-earthed gear with its ground lift (`lift` on the placed box) off.

`@rustybuns/gear/circuit` is the guitar side: `Circuit`, an audio circuit solver (modified nodal analysis, Newton-Raphson for diodes, transistors, triodes, op-amps and the rest), and `Rig` and `runRig` to run netlists oversampled through a power stage and cabinet. Links run one after another, or side by side: a `Blend` in `blends` feeds each side the same signal and sums them back at its `mix` (a side with no links is the dry signal). The circuits themselves are tscircuit boards in FM DAW (`apps/fm-daw/circuits`), read into netlists there along with its named amps and pedals; its Rust port stays in FM DAW's engine wasm.

## Where the numbers come from

The rigs' boxes are generic, named by what they are, with our own looks; their numbers are from the published spec sheets of the family each one stands for, or typical of the class where a sheet is long out of print.

| Box | Numbers | From |
| --- | --- | --- |
| `synergy-horn` | 50 x 50 deg, 100 dB (2.83 V, 1 m), 127 dB continuous / 133 peak, -10 dB at 37 Hz, 28 x 28 x 25.5 in, 60 kg, 4 ohms, 1000 W | the maker's SH50 page and dealer sheets |
| `tapped-horn-18` | 105 dB half space, 134 continuous / 140 peak, 29 Hz at -10 dB, 1016 x 734 x 572 mm, 72.5 kg, 4 ohms, ~3.4 kW amp | the maker's TH118 spec sheet (2022) |
| `triple-21-sub` | 105 dB 1 W / 1 m, 146 dB peak, 29-95 Hz +/- 3 dB, 1479 x 696 x 1218 mm, 214 kg, 6 kW AES | the maker's sheet and dealer listings |
| `stack-mid-high` (and its family) | a tall horn top: 12" and 8" on horns and two 1"s, 25 x 20 deg, 60 kg, about 484 x 975 x 510 mm | the maker's Res 5E sheet (2022) |
| `tri-amp-top`, `tri-amp-bass` | high-Q horn top (two horn-loaded 10"s, a 1" waveguide) over horn-loaded 2 x 15"; 35 x 25 deg | typical of the class (the family's sheets are out of print) |
