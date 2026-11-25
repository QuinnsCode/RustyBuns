// The sound wall (WALL.md) as a player walks up to it: the starter modules in the case, a voice patched by looking and
// clicking (the sequencer into the VCO, the filter and the VCA, the envelope on the VCA, the mixer into Q Out), heard
// playing the sequencer's notes; a new module set into the top row; a mixer send through the room's spring and back
// into its return; a module taken out of the case, and its power with it. Each module's own sound is test/wall-sims.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bringModule, inCase, item, listen, lookAt, newRoom, pickUp, putDown, use, walkTo, type Room } from "../src/room/room.ts";
import { renderWall } from "../src/wall/wall.ts";
import { PANELS } from "../circuits/wall-panels.ts";

setDefaultTimeout(30_000);

const click = (r: Room, id: string, part?: string) => { lookAt(r, id, part); return use(r); };
const cable = (r: Room, a: string, ja: string, b: string, jb: string) => [click(r, a, ja), click(r, b, jb)];
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test("patch a voice on the sound wall, hear it follow the sequencer, add a module, loop a send through the spring", () => {
  const r = newRoom();
  // Every module of the starter system stands in the case's lower row, powered; nothing is cabled, so it is quiet.
  const starters = r.studio.patch.placed.filter((p) => p.id.startsWith("wall-"));
  expect(starters.map((p) => p.id)).toEqual(PANELS.map((p) => `wall-${p.id}`));
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
  // The wall's audio thread gets the spring's rig for that return, as the desk's aux 2 does.
  expect(looped.spec.returns).toMatchObject([{ mixer: "wall-mix", aux: "a", settings: { direct: true, loop: [{ kind: "spring" }] } }]);

  // Take the VCO out of the case and set it down behind you: no power, so its cables carry nothing and the room says why.
  expect(pickUp(r, "wall-vco")).toEqual({ ok: true });
  r.you.yaw = Math.PI;
  expect(putDown(r)).toEqual({ ok: true });
  const off = listen(r.studio.patch).wall;
  expect(inCase(item(r, "wall-vco")!)).toBe(false);
  expect(off.modules).not.toContain("wall-vco");
  expect(off.problems).toContain("Q Saw isn't in the sound wall's case: no power");
});
