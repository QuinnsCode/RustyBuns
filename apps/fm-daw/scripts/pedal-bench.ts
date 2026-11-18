// Does a pedal fit on a DSP chip? (#4938, ANALOG.md section 8.) Times every pedal's circuit per sample,
// in TypeScript and in native Rust (the `pedal_bench` example in native/), at 48, 96 and 192 kHz (1×, 2×
// and 4× oversampling), and counts the Newton iterations per sample: the cost that grows when diodes clip.
// Each pedal plays the riff at 0.5 V with its knob at 10 (the most clipping). Pedals with an LFO or an
// envelope run with it parked: the solve per sample costs the same. Prints a markdown table, with the host's
// clock cycles per sample next to a 480 MHz Cortex-M7's budget for that rate. A second table runs Rust again
// with Newton capped per sample (#5109), and says how far that output lands from the uncapped one.
//
//   bun scripts/pedal-bench.ts [--ghz 3.2] [--cap 6]
//
// --ghz is the host core's clock, for the cycles column (3.2 for an M1 Pro or Max performance core).
// --cap is the most Newton iterations per sample in the capped run.
// It builds the Rust example, so with the valve shut it runs on the builder by itself.
import { $ } from "bun";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Circuit, encodeNetlist } from "@rustybuns/gear/circuit";
import { help } from "../../../scripts/help.ts";
import { offload } from "../../../scripts/remote-ci.ts";
import { PEDALS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";

help(import.meta.path);
await offload();
const argv = process.argv.slice(2);
const flag = (name: string, fallback: number) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) : fallback);
const ghz = flag("--ghz", 3.2);
const cap = flag("--cap", 6);
const M7_HZ = 480e6;
const dir = await mkdtemp(join(tmpdir(), "pedal-bench-"));
const f64 = (path: string, a: ArrayLike<number>) => writeFile(path, new Uint8Array(Float64Array.from(a).buffer));

await $`cargo build --release --quiet --example pedal_bench --manifest-path native/Cargo.toml`;
const bin = join("native", "target", "release", "examples", "pedal_bench");
const cpu = (await $`sysctl -n machdep.cpu.brand_string`.nothrow().quiet().text()).trim() || process.arch;

/** TypeScript: ns per sample (best of three) and Newton iterations per sample. */
function ts(net: ReturnType<(typeof PEDALS)[number]["net"]>, sr: number, input: Float64Array) {
  let best = Infinity, its = 0;
  for (let run = 0; run < 3; run++) {
    const c = new Circuit(net, sr);
    c.settle(0);
    const it0 = c.iterations, t0 = Bun.nanoseconds();
    for (let i = 0; i < input.length; i++) c.step(input[i]);
    best = Math.min(best, (Bun.nanoseconds() - t0) / input.length);
    its = (c.iterations - it0) / input.length;
  }
  return { ns: best, its };
}

console.log(`${cpu}, ${ghz} GHz assumed. Knob at 10, riff at 0.5 V. M7 budget: ${M7_HZ / 1e6} MHz / sample rate.\n`);
const skipped: string[] = [];
const capRows: string[] = [];
console.log("| Pedal | Rate | Unknowns, ports | TS ns | Rust ns | Rust worst 1 ms block, ns | Newton its (mean, max) | Host cycles | M7 budget |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const sr of [48000, 96000, 192000]) {
  const input = Float64Array.from(riff(sr), (v) => v * 0.5);
  const inFile = join(dir, `in-${sr}.f64`);
  await f64(inFile, input);
  const args: string[] = [];
  skipped.length = 0;
  for (const p of PEDALS) {
    try { await f64(join(dir, `${p.id}.f64`), encodeNetlist(p.net(10))); args.push(`${p.id}=${join(dir, `${p.id}.f64`)}`); }
    catch (e) { skipped.push(`${p.name} (${e instanceof Error ? e.message : e})`); }
  }
  const rust = new Map<string, string[]>();
  for (const line of (await $`${bin} ${sr} ${inFile} ${cap} ${args}`.text()).trim().split("\n")) rust.set(line.split("\t")[0], line.split("\t"));
  for (const p of PEDALS) {
    const t = ts(p.net(10), sr, input), r = rust.get(p.id);
    const cell = (s: string | undefined) => s ?? "n/a";
    const cycles = r ? Math.round(Number(r[3]) * ghz) : undefined;
    console.log(`| ${p.name} | ${sr / 1000}k | ${r ? `${r[1]}, ${r[2]}` : "n/a"} | ${t.ns.toFixed(0)} | ${cell(r?.[3])} | ${cell(r?.[4])} | ${r ? `${r[5]}, ${r[6]}` : `${t.its.toFixed(2)} (TS)`}${r && r[7] !== "0" ? `, ${r[7]} misses` : ""} | ${cell(cycles?.toString())} | ${Math.round(M7_HZ / sr)} |`);
    if (r) capRows.push(`| ${p.name} | ${sr / 1000}k | ${r[3]} | ${r[8]} | ${r[9]} | ${r[10]} | ${r[11]} | ${r[12]} dB | ${r[13]} | ${Math.round(Number(r[9]) * ghz)} |`);
  }
}
console.log(`\nRust with Newton capped at ${cap} iterations per sample, against the uncapped run:\n`);
console.log("| Pedal | Rate | Uncapped ns | Capped ns | Capped worst 1 ms block, ns | Newton its, mean | Capped samples | RMS error vs signal | Peak error, mV | Host cycles, worst block |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const row of capRows) console.log(row);
if (skipped.length) console.log(`\nNot in Rust yet: ${skipped.join("; ")}`);
