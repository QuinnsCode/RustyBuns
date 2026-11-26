// A lesson in each BUILD sector (#6085), walked as a beginner does it, on each page's own model: the Event Planner's
// through the studio builder's edits (the same ones its tools send) and the coverage map its PA panel draws; Q Amps'
// through the amp's knobs, the board's order and the stage's cables as compile and heard read them. Each journey makes
// a mistake the page lets you make, reads why in plain words, puts it right, and ends with the lesson done.
import { expect, test } from "bun:test";
import { AMP_LESSON, type AmpAt } from "../src/amp/lesson.ts";
import { BUILD_LESSON, type BuildAt } from "../src/amp/build-lesson.ts";
import { AMP_SLOT, freshOrder, moveTo } from "../src/amp/pedalboard.ts";
import { STAGE, compile, heard, type Cable } from "../src/circuit/patch.ts";
import { edit, type Edit } from "../src/studio/builder.ts";
import { floorMap } from "../src/studio/coverage.ts";
import { roomPa } from "../src/studio/pa-room.ts";
import { PageLesson } from "../src/studio/page-lesson.ts";
import { PLAN_LESSON, PLAN_ROOM, type PlanAt } from "../src/studio/plan-lesson.ts";
import type { StudioDef } from "../src/studio/room.ts";
import { ROOM_LIST } from "../src/studio/rooms/index.ts";

test("Event Planner: two stacks on the Desert Gathering, too close, then one aimed off, the small generator, the gear list", () => {
  let room: StudioDef = structuredClone(ROOM_LIST.find((r) => r.id === PLAN_ROOM)!), listed = false;
  const go = (e: Edit) => { const out = edit(room, e); expect(out).toMatchObject({ ok: true }); room = out.def; };
  const lesson = new PageLesson<PlanAt>(PLAN_LESSON, () => ({ def: room, map: floorMap(room, 1), listed }), () => {
    while (roomPa(room)?.stacks.length) go({ t: "unstack", index: 0 });
  });
  lesson.start();
  const now = () => lesson.state()!;
  expect(now()).toMatchObject({ id: "plan", next: 0, done: false });

  // one stack at the front left: the far side of the field goes quiet, and the card says by how much
  go({ t: "stack", at: [-15, -16] });
  expect(now().steps[0].why).toMatch(/^One stack throws at its own side of the field: the quietest part of the crowd hears it \d+ dB under the middle/);
  // a second one 3 m from it is still one source
  go({ t: "stack", at: [-12, -16] });
  expect(now().steps[0].why).toContain("3 m apart");
  // Move drags it across the front: spread, but it still faces where it stood
  go({ t: "moveStack", index: 1, at: [15, -16] });
  expect(now()).toMatchObject({ next: 1 });
  expect(now().steps[1].why).toMatch(/^Stack 2 points \d+° off the middle/);
  go({ t: "aimStack", index: 1, yaw: Math.atan2(-15, 16) });
  expect(now()).toMatchObject({ next: 2 });

  // the 7 kVA set can't hold the rig: the power plan's own words, then the 100 kVA set holds it
  go({ t: "generator", set: "generator-7kva" });
  expect(now().steps[2].why).toMatch(/7 kVA generator gives 6\.3 kW and the rig draws/);
  go({ t: "generator", set: "generator-100kva" });
  expect(now()).toMatchObject({ next: 3 });
  listed = true;
  expect(now()).toMatchObject({ done: true });
  expect(lesson.finished).toBe(true);
});

test("Q Amps: gain down, Q Drive with its board uncabled and then too hot, Q Tape dragged in front of the amp", () => {
  const s = { gain: 7, lit: [] as string[], drive: { drive: 3 } as Record<string, number>, tape: false, order: freshOrder(), cables: [...STAGE.cables] as Cable[] };
  const lesson = new PageLesson<AmpAt>(AMP_LESSON, () => {
    const p = { placed: STAGE.placed, cables: s.cables };
    return { ...s, pedalsHeard: heard(p, compile(p)).pedals };
  });
  lesson.start();
  const now = () => lesson.state()!;

  // Q Lead 50 comes at Gain 7: already dirty
  expect(now().steps[0].why).toMatch(/^Gain at 7: the preamp's first tube clips/);
  s.gain = 3;
  expect(now()).toMatchObject({ next: 1 });

  // the guitar straight into the amp, past the board: Q Drive's switch is on, but it isn't in the sound
  s.cables = [{ from: ["guitar", "out"], to: ["head", "in"], kind: "instrument" }, STAGE.cables[2]];
  s.lit = ["drive"];
  expect(now().steps[1].why).toContain("isn't cabled between the guitar and the amp");
  s.cables = [...STAGE.cables];
  s.drive.drive = 8;
  expect(now().steps[1].why).toMatch(/^Q Drive at 8 is a distortion of its own/);
  s.drive.drive = 4;
  expect(now()).toMatchObject({ next: 2 });

  // Q Tape on, dragged to the front of the board: its echoes go through the clipping
  s.tape = true;
  s.order = moveTo(s.order, "tape", 0);
  expect(s.order.indexOf("tape")).toBeLessThan(s.order.indexOf(AMP_SLOT));
  expect(now().steps[2].why).toMatch(/^Q Tape sits in front of the amp/);
  s.order = moveTo(s.order, "tape", s.order.length - 1);
  expect(now()).toMatchObject({ done: true });
});

test("Q Builder: Q Drive's board, a capacitor swapped first, then a MOSFET, then germanium and LEDs, read off the solved circuit", () => {
  const s: BuildAt = { pedal: null, lit: [], board: true, drive: 5, swaps: {}, tried: [] };
  const lesson = new PageLesson<BuildAt>(BUILD_LESSON, () => {
    if (s.pedal === "drive") s.tried = [...new Set([...s.tried, s.swaps.D1 ?? "silicon"])];
    return s;
  });
  lesson.start();
  const now = () => lesson.state()!;

  // the board view open on the amp's own tube stage: switch Q Drive on to see its board
  expect(now().steps[0].why).toMatch(/^The board shows the circuit you're playing, the amp's first tube/);
  s.pedal = "drive"; s.lit = ["drive"];
  expect(now()).toMatchObject({ next: 1 });

  // C2 isn't a clipping part: the card says what it is and where the diodes are
  s.swaps = { C2: "2.2" };
  expect(now().steps[1].why).toMatch(/^C2 is half of the leg .* The clipping diodes are D1 and D2/);
  s.swaps = { D1: "mosfet" };
  expect(now().steps[1].why).toMatch(/^A MOSFET opens at about 1\.2 V/);

  // germanium: the solved circuit's peak, under silicon's
  s.swaps = { D1: "germanium" };
  const ge = now();
  expect(ge).toMatchObject({ next: 2 });
  expect(ge.steps[2].job).toBe("Now the other end: LEDs in D1 and D2");
  const [, geV, siV] = ge.steps[2].why!.match(/peaks at ([\d.]+) V out of Q Drive, where silicon gave ([\d.]+) V/)!.map(Number);
  expect(geV).toBeLessThan(siV);

  // LEDs: louder than silicon, and the lesson ends with all three read
  s.swaps = { D1: "led" };
  const done = now();
  expect(done).toMatchObject({ done: true });
  const [, g, si, led] = done.end!.match(/Germanium peaks at ([\d.]+) V, silicon at ([\d.]+) V, LEDs at ([\d.]+) V/)!.map(Number);
  expect(g).toBe(geV);
  expect(si).toBe(siV);
  expect(led).toBeGreaterThan(si);
  expect(done.end).toContain("Your board keeps LEDs in D1 and D2");
});
