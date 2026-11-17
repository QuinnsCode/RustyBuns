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
- `compile(placed, cables, { outlets })`: a patch of gear, cables and wall outlets. It returns which speakers are fed and a list of problems, each naming the items and jack: wrong cable, jack used twice, two outputs joined, a load below the amp minimum, a tripped breaker, a loop, no power, and a DI hum: its thru and XLR both on mains-earthed gear with its ground lift (`lift` on the placed box) off.

`@rustybuns/gear/circuit` is the guitar side: `Circuit`, an audio circuit solver (modified nodal analysis, Newton-Raphson for diodes, transistors, triodes, op-amps and the rest), and `Rig` and `runRig` to run netlists oversampled through a power stage and cabinet. Links run one after another, or side by side: a `Blend` in `blends` feeds each side the same signal and sums them back at its `mix` (a side with no links is the dry signal). The circuits themselves are tscircuit boards in FM DAW (`apps/fm-daw/circuits`), read into netlists there along with its named amps and pedals; its Rust port stays in FM DAW's engine wasm.
