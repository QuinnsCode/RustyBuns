# @rustybuns/gear

Sound and power math for live-sound gear, with no dependencies. It runs the numbers under Load In, the roadie sim (#4849).

- `GEAR`, `gear(id)`, `jackNames(g)`: generic speakers, amps, a mixer, a generator, a distro, ramps and cases. Each has its size, weight and jacks, plus a spec sheet where it has one.
- `splAt(source, point)`: sensitivity + 10 log10(W) - 20 log10(d), minus a smooth off-axis loss that is 6 dB down at the coverage edge.
- `sumPower`, `sumCoherent`, `levelAt`: mids and highs add as power. Subs add with phase from path length, so two subs make lobes and a power alley.
- `arrayPoses(top, yaw, tilt, splays, n, boxH)`, `splayCalc(top, yaw, n, boxH, far, near)`: where each box of a flown line array hangs once its splays are set, and the splay calculator: the top box aimed at the back seat, the ones below at nearer seats spaced by distance in proportion, whole degrees up to `MAX_SPLAY_DEG`.
- `coverage(sources, area, band)`: a `Float32Array` of dB over a floor, for a heat map.
- `ampWatts`, `parallel`, `series`: watts per channel into a load, and what happens below the amp's minimum load.
- `circuitLoad`, `generatorLoad`: mains draw against a 15 A or 20 A breaker, or a generator's kVA.
- `cableLoss(awg, metres, ohms)`: dB lost in a speaker cable run.
- `compile(placed, cables, { outlets })`: a patch of gear, cables and wall outlets. It returns which speakers are fed and a list of problems, each naming the items and jack: wrong cable, jack used twice, two outputs joined, a load below the amp minimum, a tripped breaker, a loop, no power.

`@rustybuns/gear/circuit` is the guitar side: `Circuit`, an audio circuit solver (modified nodal analysis, Newton-Raphson for diodes, transistors, triodes, op-amps and the rest), and `Rig` and `runRig` to run netlists oversampled through a power stage and cabinet. The circuits themselves are tscircuit boards in FM DAW (`apps/fm-daw/circuits`), read into netlists there along with its named amps and pedals; its Rust port stays in FM DAW's engine wasm.
