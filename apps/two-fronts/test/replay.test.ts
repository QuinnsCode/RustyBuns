import { expect, setDefaultTimeout, test } from "bun:test";
import type { BattleSpec, SpaceBattleSpec } from "../src/battle/contract.ts";
import { acos, atan2, cos, hypot, sin } from "../src/battle/fmath.ts";
import { groundInputs, groundRecorder, replayGround, replaySpace, spaceRecorder } from "../src/battle/replay.ts";
import { startBattle, step, type Battle, type Input } from "../src/battle/sim.ts";
import { startSpaceBattle, stepSpace, type SpaceBattle, type SpaceInput } from "../src/battle/space.ts";
import { MAX_INPUTS } from "../src/war/table.ts";

// Whole battles run here, and a CI runner is slower than a laptop. bunfig's timeout is ignored,
// so it's set per file.
setDefaultTimeout(30_000);

const ground = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 2, defender: 0 },
  reinforcements: { attacker: 24, defender: 0 }, turrets: 2, seed: 42, ...over,
});
const space: SpaceBattleSpec = {
  id: "1-kessa-orbit", turn: 1, system: "Kessa", factions: { attacker: "marines", defender: "wooka" },
  hero: "attacker", heroLevel: 1, fleets: { attacker: 3, defender: 3 }, seed: 9,
};

// A restless player: keys held for a while, the mouse always moving, a strike and a vehicle now and then.
function player(seed: number) {
  let s = seed, yaw = 0, pitch = 0, keys = [0, 0], fire = false;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  return {
    ground(i: number): Input {
      if (i % 20 === 0) keys = [Math.floor(r() * 3) - 1, Math.floor(r() * 3) - 1];
      if (i % 7 === 0) fire = r() < 0.6;
      yaw += (r() - 0.5) * 0.1;
      return { forward: keys[0]!, right: keys[1]!, yaw, fire, ...(i % 200 === 50 && { use: true }), ...(i % 900 === 300 && { strike: { x: r() * 200 - 100, z: r() * 200 - 100 } }) };
    },
    space(i: number): SpaceInput {
      if (i % 20 === 0) keys = [Math.floor(r() * 3) - 1, 0];
      yaw += (r() - 0.5) * 0.1;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + (r() - 0.5) * 0.05));
      return { yaw, pitch, throttle: keys[0]!, fire: r() < 0.5 };
    },
  };
}

// The page's loop: the hero's input through the recorder until they hand over, then the AI.
function playGround(spec: BattleSpec, handOverAt = Infinity, seed = 1): { b: Battle; log: string } {
  const b = startBattle(spec), rec = groundRecorder(), p = player(seed);
  for (let i = 0; !b.over; i++) step(b, i < handOverAt ? rec.take(p.ground(i)) : null);
  return { b, log: rec.log() };
}
function playSpace(spec: SpaceBattleSpec, handOverAt = Infinity, seed = 1): { b: SpaceBattle; log: string } {
  const b = startSpaceBattle(spec), rec = spaceRecorder(), p = player(seed);
  for (let i = 0; !b.over; i++) stepSpace(b, i < handOverAt ? rec.take(p.space(i)) : null);
  return { b, log: rec.log() };
}

test("the sims' trig is Math's to within a hair", () => {
  for (let i = 0; i < 20000; i++) {
    const x = (i - 10000) * 0.0137;
    expect(Math.abs(sin(x) - Math.sin(x))).toBeLessThan(1e-14);
    expect(Math.abs(cos(x) - Math.cos(x))).toBeLessThan(1e-14);
    const y = Math.sin(i * 1.7) * 50, z = Math.cos(i * 0.3) * 50;
    expect(Math.abs(atan2(y, z) - Math.atan2(y, z))).toBeLessThan(1e-14);
    expect(Math.abs(hypot(y, z, x) - Math.hypot(y, z, x))).toBeLessThan(1e-12);
    const c = Math.sin(i);
    expect(Math.abs(acos(c) - Math.acos(c))).toBeLessThan(1e-7); // acos is touchy at the ends, for anyone
  }
  for (const [y, x] of [[0, 1], [0, -1], [1, 0], [-1, 0], [-0, -1], [0, 0], [3, -3], [-3, -3], [1e30, 1], [1, 1e-30]]) {
    expect(atan2(y!, x!)).toBeCloseTo(Math.atan2(y!, x!), 15);
  }
});

test("a played ground battle comes out the same when its inputs are played again", () => {
  for (const seed of [1, 2, 3]) {
    const { b, log } = playGround(ground({ seed: 40 + seed }), Infinity, seed);
    expect(replayGround(b.spec, log)).toEqual(b.over);
  }
});

test("a ground battle handed to the AI partway replays the same, the AI fighting the rest", () => {
  const { b, log } = playGround(ground(), 1500);
  expect(b.time).toBeGreaterThan(1500 / 30);
  expect(replayGround(b.spec, log)).toEqual(b.over);
  // Handed over before the first step: the battle left to the AI.
  const none = playGround(ground(), 0);
  expect(replayGround(none.b.spec, none.log)).toEqual(none.b.over);
});

test("a played space battle comes out the same when its inputs are played again", () => {
  for (const seed of [1, 2]) {
    const { b, log } = playSpace({ ...space, seed: 9 + seed }, Infinity, seed);
    expect(replaySpace(b.spec, log)).toEqual(b.over);
  }
  const { b, log } = playSpace(space, 900);
  expect(replaySpace(space, log)).toEqual(b.over);
});

test("the log reads back what was played, and holds a step that repeats as a count", () => {
  const rec = groundRecorder(), p = player(5), played: Input[] = [];
  for (let i = 0; i < 500; i++) played.push(rec.take(p.ground(i)));
  expect([...groundInputs(rec.log())]).toEqual(played);

  const still = groundRecorder();
  for (let i = 0; i < 18000; i++) still.take({ forward: i < 9000 ? 1 : 0, right: 0, yaw: 0.5, fire: i % 3000 < 1500 });
  expect(still.log().length).toBeLessThan(80);
});

test("ten minutes with the mouse never still fits in the result", () => {
  const rec = groundRecorder(), p = player(7);
  for (let i = 0; i < 600 * 30; i++) rec.take(p.ground(i));
  const g = rec.log().length;
  const srec = spaceRecorder();
  for (let i = 0; i < 300 * 30; i++) srec.take(p.space(i));
  expect(g).toBeLessThan(MAX_INPUTS / 2);
  expect(srec.log().length).toBeLessThan(MAX_INPUTS / 2);
});

test("a log that isn't one plays no battle", () => {
  expect(replayGround(ground(), "not base64!")).toBeNull();
  expect(replayGround(ground(), btoa("\x03\x05"))).toBeNull(); // a repeat of nothing
  expect(replayGround(ground(), btoa("\x81"))).toBeNull();     // a turn with no angle after it
  expect(replayGround(ground(), btoa("\x07"))).toBeNull();     // forward + 2: no such key
  expect(replaySpace(space, btoa("\xff"))).toBeNull();
});
