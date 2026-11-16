# @rustybuns/gear

Sound and power math for live-sound gear, with no dependencies. It runs the numbers under Load In, the roadie sim (#4849).

- `GEAR`, `gear(id)`, `jackNames(g)`: generic speakers, amps, a mixer, a generator, a distro, ramps and cases. Each has its size, weight and jacks, plus a spec sheet where it has one.
- `splAt(source, point)`: sensitivity + 10 log10(W) - 20 log10(d), minus a smooth off-axis loss that is 6 dB down at the coverage edge.
- `sumPower`, `sumCoherent`, `levelAt`: mids and highs add as power. Subs add with phase from path length, so two subs make lobes and a power alley.
- `coverage(sources, area, band)`: a `Float32Array` of dB over a floor, for a heat map.
- `ampWatts`, `parallel`, `series`: watts per channel into a load, and what happens below the amp's minimum load.
- `circuitLoad`, `generatorLoad`: mains draw against a 15 A or 20 A breaker, or a generator's kVA.
- `cableLoss(awg, metres, ohms)`: dB lost in a speaker cable run.
- `feedback(loop)`: a mic, a channel (trim, EQ) and the wedges it is sent to. Loop gain per third-octave band from the distance, the wedge's off-axis loss, the mic's pattern (a cardioid hears little from behind, and widens in the low mids) and both boxes' own response; the bands over 0 dB ring, and `margin` is the gain left before any does.
- `compile(placed, cables, { outlets })`: a patch of gear, cables and wall outlets. It returns which speakers are fed and a list of problems, each naming the items and jack: wrong cable, jack used twice, two outputs joined, a load below the amp minimum, a tripped breaker, a loop, no power.
