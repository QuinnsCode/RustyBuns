// Hear the circuit-sim amp spike (CIRCUITS.md): plucks a dry guitar riff (Karplus-Strong),
// runs it through every rig in src/circuit/rig.ts, writes a WAV for each and prints how
// many times faster than real time each one ran.
//   bun scripts/amp.ts                 every rig, plus the dry riff and the tscircuit board
//   bun scripts/amp.ts brit scooped    just those
//   --play                             play each one after writing it (afplay, macOS)
// WAVs land in $FM_DAW_DIR, or the temp folder. Speakers down: they're normalized to -1 dBFS.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { encodeWav } from "../src/engine/wav.ts";
import { overdrive } from "../src/circuit/circuits.ts";
import { RIGS, runRig, type RigSpec } from "../src/circuit/rig.ts";
import { boardToNetlist } from "../src/circuit/tscircuit.ts";

help(import.meta.path);
const SR = 48000;

/** A plucked string: a burst of filtered noise circulating in a delay line that loses a little each pass. */
function pluck(out: Float32Array, at: number, hz: number, seconds: number, muted: boolean, amp: number) {
  const len = SR / hz, n = Math.floor(len), frac = len - n;
  const line = new Float32Array(n + 2);
  let lp = 0;
  for (let i = 0; i < line.length; i++) { lp += 0.6 * (Math.random() * 2 - 1 - lp); line[i] = lp; }
  const loss = muted ? 0.93 : 0.997, end = Math.min(out.length, at + Math.floor(seconds * SR));
  let p = 0, prev = 0;
  for (let t = at; t < end; t++) {
    const a = line[p], b = line[(p + 1) % line.length];
    const y = a + frac * (b - a);
    line[p] = loss * 0.5 * (y + prev);
    prev = y;
    p = (p + 1) % n;
    const fade = Math.min(1, (end - t) / 480); // let go without a click
    out[t] += amp * y * fade;
  }
}

/** Two bars at 140: palm-muted chugs, power chords, then a held lead line up high. */
function riff(): Float32Array {
  const e = 60 / 140 / 2, out = new Float32Array(Math.round(SR * e * 22));
  const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  const chord = (at: number, root: number, beats: number) => [0, 7, 12].forEach((s) => pluck(out, Math.round(at * SR), hz(root + s), beats * e, false, 0.5));
  for (let i = 0; i < 6; i++) pluck(out, Math.round(i * e * SR), hz(40), e, true, 0.8);
  chord(6 * e, 40, 2);
  chord(8 * e, 43, 1); chord(9 * e, 45, 1); chord(10 * e, 40, 2);
  [59, 62, 64].forEach((m, i) => pluck(out, Math.round((12 + i) * e * SR), hz(m), i === 2 ? 8 * e : e, false, 0.6));
  let pk = 0;
  for (const v of out) pk = Math.max(pk, Math.abs(v));
  return out.map((v) => (v / pk) * 0.8);
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const play = process.argv.includes("--play");
const dir = process.env.FM_DAW_DIR ?? tmpdir();
const board = boardToNetlist(await Bun.file(join(import.meta.dir, "../test/fixtures/hard-clip.circuit.json")).json());
const rigs: Record<string, RigSpec> = {
  ...RIGS,
  "hard-clip-tscircuit": { ...RIGS["hard-clip"], links: [{ net: board }] },
  "boosted-us-high-gain": { ...RIGS["us-high-gain"], links: [{ net: overdrive(0) }, ...RIGS["us-high-gain"].links] },
};

const dry = riff();
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
