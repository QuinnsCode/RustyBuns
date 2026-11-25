// Q Keys' firmware (firmware/keys) against the sim's `Keys`, which plays what it should do: the same MIDI through
// both, built for this computer with its C compiler, and the same DAC codes, gate and clock out of each.
import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSim } from "../src/wall/sims.ts";

setDefaultTimeout(30_000);

const dir = join(import.meta.dir, "../firmware/keys");

/** The firmware's logic built for this computer: lines in, its state after each line out. */
function firmware(lines: string[]) {
  const bin = join(mkdtempSync(join(tmpdir(), "keys-")), "keys");
  const cc = Bun.spawnSync(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-O2", "-o", bin, "host.c", "keys.c"], { cwd: dir, stderr: "pipe" });
  expect(cc.stderr.toString()).toBe("");
  const run = Bun.spawnSync([bin], { stdin: new TextEncoder().encode(lines.join("\n") + "\n") });
  return run.stdout.toString().trim().split("\n").map((l) => {
    const [dacA, dacB, gate, clock, div] = l.split(" ").map(Number);
    return { dacA, dacB, gate, clock, div };
  });
}

const hex = (...b: number[]) => b.map((x) => x.toString(16).padStart(2, "0")).join(" ");

test("the firmware plays the same notes as the sim: last key held, velocity, gate", () => {
  // [status or 0 for running status, key, velocity 0 to 127]: on channel 1 and 5, a key below C2 and one off the top,
  // a key held over another and let go, one pressed again while held, and note-offs both ways (0x80, and velocity 0).
  const notes: [number, number, number][] = [
    [0x90, 48, 100], [0, 60, 127], [0, 60, 0], [0x94, 30, 64], [0x84, 30, 0],
    [0x90, 55, 20], [0, 48, 90], [0x80, 48, 0], [0x90, 55, 70], [0, 120, 1], [0, 120, 0], [0, 55, 0], [0, 48, 0],
  ];
  const fw = firmware(notes.map(([s, n, v]) => s ? hex(s, n, v) : hex(n, v)));
  const sim = makeSim("keys", 48000), x = new Float64Array(0), y = new Float64Array(4);
  let status = 0;
  notes.forEach(([s, n, v], i) => {
    status = s || status;
    sim.note?.(n, (status & 0xf0) === 0x80 ? 0 : v / 127);
    sim.step(x, y);
    const r = sim.read();
    expect(fw[i], `after ${notes[i]}`).toMatchObject({ dacA: r.dacA, dacB: r.dacB, gate: y[1] > 1 ? 1 : 0 });
  });
  // C3 is a volt (500 mV before U5's gain of two); the last key let go (G3) leaves the pitch where it was.
  expect(fw[0].dacA).toBe(500);
  expect(fw.at(-1)).toMatchObject({ dacA: 792, gate: 0 });
});

test("the firmware's clock counts the MIDI clock down to Div as the sim does, from Start and a song position", () => {
  for (const turn of [0, 0.5, 1]) {
    const adc = Math.min(1023, Math.floor(turn * 1024));
    // Start, two beats of clock, then a song position of 9 sixteenths (two beats and a quarter) and a beat more.
    const ticks = [...Array(48).keys()].map((t) => t / 24).concat([...Array(24).keys()].map((t) => 9 / 4 + t / 24));
    const fw = firmware([`div ${adc}`, hex(0xfa), ...Array(48).fill(hex(0xf8)), hex(0xf2, 9, 0), ...Array(24).fill(hex(0xf8))]);
    const clocks = fw.slice(2, 50).concat(fw.slice(51)).map((s) => s.clock);
    const sim = makeSim("keys", 48000, { div: turn }), x = new Float64Array(0), y = new Float64Array(4);
    // The sim's clock mid-tick: its beat set just inside the tick, then a sample on.
    const want = ticks.map((beat) => { sim.tempo?.(120, beat + 0.25 / 24); sim.step(x, y); return y[3] > 1 ? 1 : 0; });
    expect(fw[0].div).toBe(sim.read().div);
    expect(clocks, `Div at ${turn}`).toEqual(want);
  }
});
