// The first gig as a beginner does it: wire the sound board right and pass, then the three ways a beginner gets it
// wrong (48 V left off, the amp switched on before the desk, the rack carried to the desk with a long speaker run).
import { expect, test } from "bun:test";
import type { Cable, CableKind } from "@rustybuns/gear";
import { CROWD, FIRST_GIG, type LaidCable, ZONES, judge, jobs, phantom, show } from "../src/venues/first-gig.ts";
import { type World, newWorld } from "../src/sim.ts";

const c = (kind: CableKind, from: string, to: string, lengthM: number): Cable => {
  const end = (s: string) => {
    const [id = "", jack = ""] = s.split(" ");
    return [id, jack] as const;
  };
  return { kind, lengthM, from: end(from), to: end(to) };
};

/** The room set up: the mic on its stand centre stage, the wedge in front facing the singer, the desk at the back. */
function setUp(rackAt: { x: number; z: number }): World {
  const w = newWorld(FIRST_GIG);
  const at = (key: string, x: number, z: number, rot = 0, y = 0) => Object.assign(w.items.find((i) => i.key === key)!, { x, z, rot, y });
  at("stand", 0, 1.2);
  at("mic", 0, 1.2, 0, 1.6);
  at("wedge", 0, 2.4, Math.PI);
  at("desk", 2.5, 8.2);
  at("rack", rackAt.x, rackAt.z);
  at("case", -2.5, 6);
  return w;
}

// Rack by the stage: short power, the long XLRs carry the mic back to the desk and the aux back to the rack, a 3 m speaker lead.
const byStage = [
  c("power", "stage-wall power-out-1", "rack power-in", 5),
  c("power", "side-wall power-out-1", "desk power-in", 5),
  c("xlr", "mic xlr-out", "desk xlr-in-1", 15),
  c("xlr", "desk xlr-out-1", "rack xlr-in-1", 15),
  c("speaker", "rack speaker-out-1", "wedge speaker-in", 3),
];
// Rack beside the desk: a 3 m XLR between them and 15 m of speaker cable up to the wedge.
const byDesk = [
  c("power", "side-wall power-out-2", "rack power-in", 5),
  c("power", "side-wall power-out-1", "desk power-in", 5),
  c("xlr", "mic xlr-out", "desk xlr-in-1", 15),
  c("xlr", "desk xlr-out-1", "rack xlr-in-1", 3),
  c("speaker", "rack speaker-out-1", "wedge speaker-in", 15),
];

/** Throw the switches in order, as the page sees them. */
const switchOn = (w: World, runs: Cable[], order: string[]) => {
  const on = new Set<string>();
  for (const k of order) judge(w, runs, on.add(k));
  return on;
};

test("wire the first gig in the real order and the singer hears the wedge: the show passes", () => {
  const w = setUp({ x: -2.2, z: 1.0 });
  phantom(w, true);
  const on = switchOn(w, byStage, ["desk", "rack"]);
  const j = judge(w, byStage, on);
  expect(j).toMatchObject({ fed: true, problems: [], speakerM: 3 });
  expect(j.atHead!).toBeCloseTo(100, 0);
  expect(j.damping!).toBeGreaterThan(90);
  expect(jobs(w, byStage, on).filter((x) => !x.done)).toEqual([]);
  expect(show(w, byStage, on)).toMatchObject({ sound: 100, faults: [], pass: true, pay: 120 });
});

test.each([
  {
    name: "48 V left off: the condenser makes no sound, so nor does the wedge",
    rackAt: { x: -2.2, z: 1.0 }, runs: byStage, phantom: false, order: ["desk", "rack"],
    fault: "no-phantom", fed: false, pass: false,
  },
  {
    name: "the amp switched on before the desk: the desk's switch-on pop thumps the wedge",
    rackAt: { x: -2.2, z: 1.0 }, runs: byStage, phantom: true, order: ["rack", "desk"],
    fault: "thump", fed: true, pass: true,
  },
  {
    name: "the rack carried to the desk: 15 m of speaker cable leaves the amp a loose grip on the wedge",
    rackAt: { x: 2.5, z: 7.4 }, runs: byDesk, phantom: true, order: ["desk", "rack"],
    fault: null, fed: true, pass: true,
  },
])("$name", ({ rackAt, runs, phantom: ph, order, fault, fed, pass }) => {
  const w = setUp(rackAt);
  phantom(w, ph);
  const on = switchOn(w, runs, order);
  const j = judge(w, runs, on);
  expect(j.fed).toBe(fed);
  expect(j.problems.map((p) => p.kind)).toEqual(fault ? [fault] : []);
  const s = show(w, runs, on);
  expect(s.pass).toBe(pass);
  expect(s.sound).toBeLessThan(95);
  if (!fault) expect(j.damping!).toBeLessThan(25);
});

test("the first gig's crowd stands between the stage and the back wall, clear of the stage and the mix position", () => {
  const f = CROWD.floor;
  expect(CROWD.capacity).toBe(60);
  expect(f.z0).toBeGreaterThanOrEqual(ZONES.stage.z1);
  expect(f.z1).toBeLessThanOrEqual(FIRST_GIG.room.z1);
  expect(f.x1).toBeLessThanOrEqual(ZONES.desk.x0);
  // About one and a half people a square metre when everyone is in: a full small room, not a crush.
  const perM2 = CROWD.capacity / ((f.x1 - f.x0) * (f.z1 - f.z0));
  expect(perM2).toBeGreaterThan(1.5);
  expect(perM2).toBeLessThan(2.5);
});

/** Rope points 0.2 m apart on the floor from one spot to another, as a laid cable's rope lies. */
const lay = (x0: number, z0: number, x1: number, z1: number) => {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: 0.006, z: z0 + ((z1 - z0) * i) / n }));
};

test("a power cord laid along the mic's cable hums through the wedge; moved apart, or crossed square, it stops", () => {
  const w = setUp({ x: -2.2, z: 1.0 });
  phantom(w, true);
  // The mic's cable runs down the side of the room to the desk; the rack's power cord lies 15 cm beside it.
  const runs = (power: ReturnType<typeof lay>): LaidCable[] => [
    { ...byStage[0]!, key: "power-5a", path: power },
    byStage[1]!,
    { ...byStage[2]!, key: "xlr-15a", path: lay(0, 1.2, 2.5, 8.2) },
    ...byStage.slice(3),
  ];
  const beside = runs(lay(0.14, 1.15, 1.6, 5.2));
  const on = switchOn(w, beside, ["desk", "rack"]);
  const j = judge(w, beside, on);
  expect(j.fed).toBe(true);
  expect(j.problems.map((p) => p.kind)).toEqual(["hum"]);
  expect(j.problems[0]!.message).toContain("cable xlr-15a lies along power cord power-5a");
  expect(j.problems[0]!.message).toContain("Run them apart");
  expect(show(w, beside, on).sound).toBeLessThan(100);

  // A metre away, or across it at a right angle: no hum, and the show is clean again.
  for (const power of [lay(-0.9, 1.5, 0.6, 5.5), lay(0.2, 4, 2.2, 3.3)]) {
    expect(judge(w, runs(power), on).problems).toEqual([]);
    expect(show(w, runs(power), on)).toMatchObject({ sound: 100, pass: true });
  }
});
