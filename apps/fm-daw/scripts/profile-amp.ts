// Profile an amp into a circuit, offline (ANALOG.md section 6, #4830). Takes one
// of our own amps, renders the test signal through it, scrambles its part values
// (each up to ×/÷ 2, rounded to E24), and fits them back from the render alone.
// Prints each part: true, scrambled, fitted, and "can't hear" for a part whose
// own step up to ×1.5 barely moves the score (a coupling cap whose corner is
// under 10 Hz): no recording can find those, and they don't matter. Then the
// fitted amp as JSON (the Q Amp voicing) and its rig of netlists, with `--out <file>`.
//
//   bun scripts/profile-amp.ts [amp] [--seed 1] [--generations 90] [--short] [--takes 3]
//                              [--tone-generations 40] [--tone-only] [--out fit.json]
//
// amp is brit (default), lead or triple. --short plays a quicker test signal.
// --takes is how many tone-knob settings are recorded (TONE_SETTINGS in fit.ts; 1 is the
// amp's own panel only). --tone-generations runs a second search over the tone stack
// alone (0 skips it). --tone-only scrambles and fits just the tone stack and V1's
// coupling cap, the gain staging held at its true values.
// It runs the rig a couple of thousand times (a few minutes), so send it to the builder:
//   bun run builder run apps/fm-daw bun scripts/profile-amp.ts brit
import { help } from "../../../scripts/help.ts";
import { AMPS, buildRig } from "../src/circuit/amps.ts";
import { FIT_KNOBS, TONE_PARTS, TONE_SETTINGS, fit, probe, scramble, selfTakes, takesDistance, targetsOf, valuesOf, withValues } from "../src/circuit/fit.ts";

help(import.meta.path);
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const id = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--")) ?? "brit";
const amp = AMPS.find((a) => a.id === id);
if (!amp) { console.error(`no amp ${id}: ${AMPS.map((a) => a.id).join(", ")}`); process.exit(1); }
const seed = Number(flag("--seed") ?? 1), generations = Number(flag("--generations") ?? 90), out = flag("--out");
const settings = TONE_SETTINGS.slice(0, Number(flag("--takes") ?? TONE_SETTINGS.length + 1) - 1);
const toneGenerations = Number(flag("--tone-generations") ?? 40);
const only = argv.includes("--tone-only") ? TONE_PARTS : undefined;

const p = probe(24000, argv.includes("--short"));
const takes = selfTakes(amp, p, settings);
const start = scramble(amp, seed, 2, only);
const t0 = performance.now();
const r = fit(start, p, takes, {
  generations, seed, only, toneGenerations,
  onGeneration: (g, best) => { if (g % 10 === 0) console.log(`gen ${g}  distance ${best.toFixed(4)}`); },
});
const secs = (performance.now() - t0) / 1000;

const truth = valuesOf(amp), guess = valuesOf(start);
const si = (v: number, part: boolean) => {
  if (!part) return v.toFixed(2);
  for (const [u, s] of [[1e-6, "u"], [1e-9, "n"], [1e-12, "p"]] as const) if (v < u * 1000 && v < 1) return `${Number((v / u).toPrecision(3))}${s}`;
  return v >= 1e3 ? `${Number((v / 1e3).toPrecision(3))}k` : `${Number(v.toPrecision(3))}`;
};
const want = targetsOf(takes, p), fittedVals = r.values.map((v) => v.value);
const heard = fittedVals.map((v, i) => {
  const moved = fittedVals.slice();
  moved[i] = v * 1.5;
  return takesDistance(withValues(r.amp, moved), p, want) - r.snapped > 0.003;
});
let hits = 0, deaf = 0;
console.log(`\n${amp.name}, ${takes.length} takes: ${r.evaluations * takes.length} renders in ${secs.toFixed(0)} s, distance ${r.fitted.toFixed(4)} fitted, ${r.snapped.toFixed(4)} on E24`);
console.log("part            true     scrambled  fitted");
truth.forEach((v, i) => {
  const hit = v.part ? Math.abs(Math.log(r.values[i].value / v.value)) < 0.06 : Math.abs(r.values[i].value / v.value - 1) < 0.1;
  if (hit) hits++;
  else if (!heard[i]) deaf++;
  console.log(`${v.name.padEnd(15)} ${si(v.value, v.part).padEnd(8)} ${si(guess[i].value, v.part).padEnd(10)} ${si(r.values[i].value, v.part).padEnd(8)} ${hit ? "back" : heard[i] ? "" : "can't hear"}`);
});
console.log(`${hits} of ${truth.length} back, ${deaf} more you can't hear`);
if (out) {
  await Bun.write(out, JSON.stringify({ voicing: r.amp, rig: buildRig(r.amp, FIT_KNOBS(r.amp)), distance: r.snapped }, null, 2));
  console.log(`wrote ${out}`);
}
