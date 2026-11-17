// Profile a real amp (ANALOG.md section 6, #4943): play the test signal out of the
// audio interface, record what the amp sends back, and fit our closest amp to it.
//
//   bun scripts/capture-amp.ts write <dir>                      the takes' signal, probe.wav, and the knob sheet
//   bun scripts/capture-amp.ts record <dir> [--input 0]         plays probe.wav and records take-1.wav, take-2.wav, ...
//   bun scripts/capture-amp.ts fit <dir> [--amp brit] [--generations 90] [--out fit.json]
//
// Wiring: interface out -> reamp box -> amp input; amp speaker out -> load box (or a mic
// on the cab) -> interface in. Set the Mac's sound output to the interface. `record`
// uses ffmpeg (avfoundation) and afplay; `--input` is the audio device number from
// `ffmpeg -f avfoundation -list_devices true -i ""`. Between takes it asks you to set
// the tone knobs to the sheet's numbers (gain and master stay where they are); Enter starts each.
// Already recorded in a DAW? Name the files take-1.wav ... in <dir> and skip `record`.
//
// `fit` reads every take (any format ffmpeg reads), lines each one up against a render
// of the amp it is trying, ignores the recording's level, and fits each of our amps in
// turn (or just `--amp`). The closest one is printed and, with `--out`, written as a
// voicing and its rig. It is a few thousand renders per amp, so send it to the builder:
//   bun run builder run apps/fm-daw bun scripts/capture-amp.ts fit <dir> --amp brit
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { AMPS, buildRig, type AmpDef } from "../src/circuit/amps.ts";
import { cut, padded } from "../src/circuit/capture.ts";
import { FIT_KNOBS, fit, probe, render, takeKnobs, type FitResult, type Take } from "../src/circuit/fit.ts";
import { encodeWav } from "../src/engine/wav.ts";

help(import.meta.path);
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const [cmd, dir] = argv;
if (!dir || !["write", "record", "fit"].includes(cmd)) { console.error("usage: capture-amp.ts write|record|fit <dir> (--help)"); process.exit(1); }

const p = probe(24000);
// The knob sheet uses Q Brit 3's own panel: the tone numbers are what matter, and every take shares gain and master.
const sheet = takeKnobs(AMPS[0]).map((k) => ({ bass: k.bass, mid: k.mid, treble: k.treble }));
const takeFile = (i: number) => join(dir, `take-${i + 1}.wav`);

if (cmd === "write") {
  mkdirSync(dir, { recursive: true });
  const sig = padded(p), stereo = new Float32Array(sig.length * 2);
  sig.forEach((v, i) => { stereo[2 * i] = v; stereo[2 * i + 1] = v; });
  await Bun.write(join(dir, "probe.wav"), encodeWav(stereo, p.sampleRate));
  await Bun.write(join(dir, "knobs.json"), JSON.stringify(sheet, null, 2));
  console.log(`wrote ${join(dir, "probe.wav")} (${(sig.length / p.sampleRate).toFixed(1)} s) and knobs.json`);
  sheet.forEach((k, i) => console.log(`take ${i + 1}: bass ${k.bass}, mid ${k.mid}, treble ${k.treble}`));
}

if (cmd === "record") {
  const input = flag("--input") ?? "0";
  for (const [i, k] of sheet.entries()) {
    console.log(`take ${i + 1} of ${sheet.length}: set bass ${k.bass}, mid ${k.mid}, treble ${k.treble}, then press Enter`);
    for await (const _ of console) break;
    const rec = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "avfoundation", "-i", `:${input}`, "-ac", "1", takeFile(i)], { stdin: "pipe" });
    try {
      await Bun.sleep(500); // the device opens before the probe starts
      await Bun.spawn(["afplay", join(dir, "probe.wav")]).exited;
      await Bun.sleep(300);
      rec.stdin.write("q");
      await rec.stdin.end();
      await rec.exited;
    } finally {
      rec.kill();
    }
    console.log(`  wrote ${takeFile(i)}`);
  }
}

/** A take decoded to mono floats at the probe's rate, whatever the file was. */
async function decode(file: string): Promise<Float32Array> {
  const ff = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", file, "-ac", "1", "-ar", String(p.sampleRate), "-f", "f32le", "-"], { stdout: "pipe" });
  const bytes = new Uint8Array(await new Response(ff.stdout).arrayBuffer());
  if ((await ff.exited) !== 0) throw new Error(`ffmpeg could not read ${file}`);
  return new Float32Array(bytes.buffer, 0, bytes.byteLength >> 2);
}

if (cmd === "fit") {
  const recordings: Float32Array[] = [];
  for (let i = 0; i < sheet.length; i++) {
    if (!(await Bun.file(takeFile(i)).exists())) break;
    recordings.push(await decode(takeFile(i)));
  }
  if (!recordings.length) { console.error(`no ${takeFile(0)}: record first`); process.exit(1); }
  const wanted = flag("--amp");
  const tries = wanted ? AMPS.filter((a) => a.id === wanted) : AMPS;
  if (!tries.length) { console.error(`no amp ${wanted}: ${AMPS.map((a) => a.id).join(", ")}`); process.exit(1); }
  const generations = Number(flag("--generations") ?? 90), out = flag("--out");
  let best: { amp: AmpDef; r: FitResult } | undefined;
  for (const amp of tries) {
    // Each take keeps the amp's gain and master and takes the sheet's tone numbers.
    const takes: Take[] = recordings.map((rec, i) => {
      const knobs = { ...FIT_KNOBS(amp), ...sheet[i] };
      return { knobs, recording: cut(rec, render(amp, p, knobs)), anyLevel: true };
    });
    const t0 = performance.now();
    const r = fit(amp, p, takes, { generations });
    console.log(`${amp.name.padEnd(14)} distance ${r.snapped.toFixed(4)} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
    if (!best || r.snapped < best.r.snapped) best = { amp, r };
  }
  if (!best) process.exit(1);
  console.log(`\nclosest: ${best.amp.name}, from ${recordings.length} take(s)`);
  for (const v of best.r.values) console.log(`  ${v.name.padEnd(15)} ${Number(v.value.toPrecision(3))}`);
  if (out) {
    await Bun.write(out, JSON.stringify({ voicing: best.r.amp, rig: buildRig(best.r.amp, FIT_KNOBS(best.r.amp)), distance: best.r.snapped }, null, 2));
    console.log(`wrote ${out}`);
  }
}
