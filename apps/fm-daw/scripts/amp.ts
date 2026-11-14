// Hear the circuit-sim amp spike (CIRCUITS.md): plucks a dry guitar riff (Karplus-Strong),
// runs it through every rig in src/circuit/amps.ts, writes a WAV for each and prints how
// many times faster than real time each one ran.
//   bun scripts/amp.ts                 every rig, plus the dry riff and the tscircuit board
//   bun scripts/amp.ts brit triple     just those
//   --play                             play each one after writing it (afplay, macOS)
// WAVs land in $FM_DAW_DIR, or the temp folder. Speakers down: they're normalized to -1 dBFS.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { encodeWav } from "../src/engine/wav.ts";
import { overdrive } from "../src/circuit/circuits.ts";
import { RIGS } from "../src/circuit/amps.ts";
import { runRig, type RigSpec } from "../src/circuit/rig.ts";
import { boardToNetlist } from "../src/circuit/tscircuit.ts";
import { riff } from "../src/circuit/riff.ts";

help(import.meta.path);
const SR = 48000;

const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const play = process.argv.includes("--play");
const dir = process.env.FM_DAW_DIR ?? tmpdir();
const board = boardToNetlist(await Bun.file(join(import.meta.dir, "../test/fixtures/hard-clip.circuit.json")).json());
const rigs: Record<string, RigSpec> = {
  ...RIGS,
  "hard-clip-tscircuit": { ...RIGS["hard-clip"], links: [{ net: board }] },
  "boosted-lead": { ...RIGS.lead, links: [{ net: overdrive(0) }, ...RIGS.lead.links] },
};

const dry = riff(SR);
const seconds = dry.length / SR;
async function write(name: string, mono: Float32Array) {
  let pk = 0;
  for (const v of mono) pk = Math.max(pk, Math.abs(v));
  const g = pk > 0 ? 0.89 / pk : 0, st = new Float32Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) st[i * 2] = st[i * 2 + 1] = mono[i] * g;
  const path = join(dir, `amp-${name}.wav`);
  await Bun.write(path, encodeWav(st, SR));
  if (play) Bun.spawnSync(["afplay", path]);
  return path;
}

if (want.length === 0) console.log(`dry riff`.padEnd(22), `${seconds.toFixed(1)} s`.padEnd(30), await write("dry", dry));
for (const [name, spec] of Object.entries(rigs)) {
  if (want.length && !want.includes(name)) continue;
  const t = performance.now();
  const run = runRig(spec, dry, SR);
  const x = (seconds * 1000) / (performance.now() - t);
  const stats = `x${x.toFixed(1)} real time, ${run.iterationsPerStep.toFixed(2)} it/step${run.misses ? `, ${run.misses} misses` : ""}`;
  console.log(name.padEnd(22), stats.padEnd(30), await write(name, run.out));
}
