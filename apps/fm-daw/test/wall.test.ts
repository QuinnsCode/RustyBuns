// The sound wall (WALL.md) as a player walks up to it: the starter modules in the case, a voice patched by looking and
// clicking (the sequencer into the VCO, the filter and the VCA, the envelope on the VCA, the mixer into Q Out), heard
// playing the sequencer's notes; a new module set into the top row; a mixer send through the room's spring and back
// into its return; a module taken out of the case, and its power with it. Then each module's board doing what its
// panel says.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bringModule, inCase, item, listen, lookAt, newRoom, pickUp, putDown, use, walkTo, type Room } from "../src/room/room.ts";
import { renderWall, type WallSpec } from "../src/wall/wall.ts";
import { Linear, makeSim } from "../src/wall/sims.ts";

setDefaultTimeout(60_000);

const click = (r: Room, id: string, part?: string) => { lookAt(r, id, part); return use(r); };
const cable = (r: Room, a: string, ja: string, b: string, jb: string) => [click(r, a, ja), click(r, b, jb)];
const rms = (x: Float32Array, from = 0) => { let s = 0; for (let i = from; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length - from)); };

test("patch a voice on the sound wall, hear it follow the sequencer, add a module, loop a send through the spring", () => {
  const r = newRoom();
  // Every module of the starter system stands in the case's lower row, powered; nothing is cabled, so it is quiet.
  const starters = r.studio.patch.placed.filter((p) => p.id.startsWith("wall-"));
  expect(starters.map((p) => p.id)).toEqual(["wall-seq", "wall-vco", "wall-vcf", "wall-vca", "wall-env", "wall-lfo", "wall-mix", "wall-out"]);
  expect(starters.every((p) => inCase(p))).toBe(true);
  expect(listen(r.studio.patch).wall).toMatchObject({ playing: false, problems: ["nothing cabled into Q Out's inputs"] });

  // Round the cab to the case, then patch: pitch and gate from Q Steps, the saw through the filter and the VCA.
  walkTo(r, 2.5, 0.5); walkTo(r, 2.5, -2.0); walkTo(r, 1.84, -2.15);
  for (const [a, ja, b, jb] of [
    ["wall-seq", "cv", "wall-vco", "voct"], ["wall-vco", "saw", "wall-vcf", "in"], ["wall-vcf", "lp", "wall-vca", "in"],
    ["wall-seq", "gate", "wall-env", "gate"], ["wall-env", "out", "wall-vca", "cv"],
    ["wall-vca", "out", "wall-mix", "in-1"], ["wall-mix", "main", "wall-out", "in-l"],
  ]) expect(cable(r, a, ja, b, jb)).toEqual([{ ok: true }, { ok: true }]);
  const wall = listen(r.studio.patch).wall;
  expect(wall).toMatchObject({ playing: true, problems: [] });
  expect(wall.spec.cables).toContainEqual({ from: ["wall-env", "out"], to: ["wall-vca", "cv"] });

  // It plays: Q Out is fed both sides (In R takes In L), and the VCO sits at the step's volts, 133 Hz up an octave a volt.
  const { left, right, wall: w } = renderWall(wall.spec, 1.5);
  expect(rms(left)).toBeGreaterThan(0.01);
  expect(right).toEqual(left);
  const now = w.state(), seq = now.find((m) => m.id === "wall-seq"), vco = now.find((m) => m.id === "wall-vco");
  expect(vco?.read.hz).toBeCloseTo(133.3 * 2 ** (seq?.read.cv ?? NaN), 0);

  // N brings another VCO: held at eye height in front of the case, it goes into the top row's nearest free HP.
  expect(bringModule(r, "vco")).toEqual({ ok: true });
  r.you.yaw = 0; r.you.pitch = 0;
  expect(putDown(r)).toEqual({ ok: true });
  const second = item(r, "vco-1")!;
  expect(inCase(second)).toBe(true);
  expect(second.at[1]).toBeCloseTo(1.14 + 0.13335, 3);
  expect(listen(r.studio.patch).wall.modules).toContain("vco-1");

  // Send A through Q Spring on the rack and back into Return A, a cable carried each way: the wall's mixer runs it as
  // the desk runs aux 2.
  expect(click(r, "wall-mix", "send-a")).toEqual({ ok: true });
  walkTo(r, 0.65, -2.2);
  expect(click(r, "spring", "in")).toEqual({ ok: true });
  expect(click(r, "spring", "out")).toEqual({ ok: true });
  walkTo(r, 1.84, -2.15);
  expect(click(r, "wall-mix", "ret-a")).toEqual({ ok: true });
  const looped = listen(r.studio.patch).wall;
  expect(looped.loops).toMatchObject([{ mixer: "wall-mix", aux: "a", chain: ["wall-mix", "spring", "wall-mix"], whole: true }]);
  // Turn channel 1's send up: the spring comes back under the dry voice.
  const spec: WallSpec = { ...looped.spec, modules: looped.spec.modules.map((m) => (m.id === "wall-mix" ? { ...m, knobs: { "a-1": 0.9 } } : m)) };
  const dry = renderWall({ ...spec, returns: [] }, 1.5).left, wet = renderWall(spec, 1.5).left;
  const diff = new Float32Array(dry.length).map((_, i) => wet[i] - dry[i]);
  expect(rms(diff)).toBeGreaterThan(rms(dry) * 0.05);

  // Take the VCO out of the case and set it down behind you: no power, so its cables carry nothing and the room says why.
  expect(pickUp(r, "wall-vco")).toEqual({ ok: true });
  r.you.yaw = Math.PI;
  expect(putDown(r)).toEqual({ ok: true });
  const off = listen(r.studio.patch).wall;
  expect(inCase(item(r, "wall-vco")!)).toBe(false);
  expect(off.modules).not.toContain("wall-vco");
  expect(off.problems).toContain("Q Saw isn't in the sound wall's case: no power");
});

/** `seconds` of one module, its inputs from `drive(t)`, every output's peak over the last half. */
function run(kind: string, knobs: Record<string, number>, drive: (t: number) => number[], seconds = 0.2, sampleRate = 48000) {
  const sim = makeSim(kind, sampleRate, knobs), x = new Float64Array(sim.ins.length), y = new Float64Array(sim.outs.length);
  const n = Math.round(seconds * sampleRate), peak = sim.outs.map(() => 0), last: number[][] = sim.outs.map(() => []);
  for (let i = 0; i < n; i++) {
    x.set(drive(i / sampleRate));
    sim.step(x, y);
    if (i >= n / 2) y.forEach((v, o) => { peak[o] = Math.max(peak[o], Math.abs(v)); });
    if (i % (n / 10) === 0) y.forEach((v, o) => last[o].push(v));
  }
  return { sim, peak, trace: last };
}
const sine = (hz: number, v = 1) => (t: number) => v * Math.sin(2 * Math.PI * hz * t);

test("each module's board does what its panel says", () => {
  // Q Saw: a volt an octave from its exponential converter (RT1 trimmed), 133 Hz at 0 V.
  const hz = [-1, 0, 1, 2].map((v) => run("vco", {}, () => [v, 0], 0.01).sim.read().hz);
  expect(hz.map((f) => Math.round(f * 10) / 10)).toEqual([66.7, 133.3, 266.5, 532.8]);
  // Q Filter with Freq in the middle, about 1 kHz: low-pass keeps 100 Hz and loses 4 kHz, high-pass the other way round.
  const low = run("vcf", { freq: 0.5, res: 0.3 }, (t) => [sine(100)(t), 0]).peak, high = run("vcf", { freq: 0.5, res: 0.3 }, (t) => [sine(4000)(t), 0]).peak;
  expect(low[0]).toBeGreaterThan(0.9); expect(high[0]).toBeLessThan(0.1);
  expect(high[2]).toBeGreaterThan(0.9); expect(low[2]).toBeLessThan(0.05);
  // A volt more CV doubles its cutoff.
  const f0 = run("vcf", { cv: 1 }, () => [0, 0], 0.01).sim.read().hz, f1 = run("vcf", { cv: 1 }, () => [0, 1], 0.01).sim.read().hz;
  expect(f1 / f0).toBeCloseTo(2, 1);
  // Q Level: shut at 0 V of CV, unity at 5 V (Level at 0).
  expect(run("vca", { level: 0, cv: 1 }, (t) => [sine(440, 5)(t), 0]).peak[0]).toBeLessThan(0.001);
  expect(run("vca", { level: 0, cv: 1 }, (t) => [sine(440, 5)(t), 5]).peak[0]).toBeCloseTo(5, 0);
  // Q Swell: up to about 9.8 V while the gate is held, back down after it to rest within a tenth of a volt of 0 V, so a
  // VCA it drives shuts between notes.
  const swell = run("env", { attack: 0, release: 0 }, (t) => [t < 0.1 ? 5 : 0], 0.4).trace[0];
  expect(Math.max(...swell)).toBeGreaterThan(9.5);
  expect(swell[swell.length - 1]).toBeLessThan(0.1);
  expect(swell[swell.length - 1]).toBeGreaterThanOrEqual(0);
  // Q Bus: its board's own gains, a channel at full level straight to Main at unity, nothing on a send that's down.
  const bus = makeSim("mix", 48000, { "level-1": 1, main: 1, "a-1": 0, "b-1": 1 });
  if (!(bus instanceof Linear)) throw new Error("Q Bus mixes with its board's gains");
  expect(bus.gain("in-1", "main")).toBeCloseTo(1, 2);
  expect(bus.gain("in-1", "send-a")).toBeCloseTo(0, 3);
  expect(bus.gain("in-1", "send-b")).toBeCloseTo(1, 2);
  expect(bus.gain("ret-a", "main")).toBeGreaterThan(0.2);
});
