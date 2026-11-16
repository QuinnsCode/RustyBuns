import { expect, setDefaultTimeout, test } from "bun:test";
import { firstDiff, load, roundTrip, save } from "@rustybuns/util/lab/save-state";
import { NO_PODS, orbitPods, type BattleSpec } from "../src/battle/contract.ts";
import { startBattle, step, type Input } from "../src/battle/sim.ts";
import { startSpaceBattle, stepSpace, type SpaceInput } from "../src/battle/space.ts";

// Whole battles run here; bunfig's timeout is ignored, so it's set per file.
setDefaultTimeout(30_000);

const spec = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 2, defender: 0 },
  reinforcements: { attacker: orbitPods(3), defender: NO_PODS }, turrets: 2, seed: 42, ...over,
});

// A player who runs, turns, fires and calls a strike now and then; the same frame always gives the same input.
const ground = (i: number): Input => ({
  forward: (i / 40 | 0) % 3 - 1, right: (i / 70 | 0) % 3 - 1, yaw: Math.sin(i / 90), fire: i % 11 < 6,
  ...(i % 900 === 300 && { strike: { x: 40, z: -60 } }),
});
const space = (i: number): SpaceInput => ({ yaw: Math.sin(i / 80), pitch: Math.cos(i / 130) * 0.6, throttle: (i / 50 | 0) % 3 - 1, fire: i % 9 < 4 });

// The first step #4686 asks for: save mid-fight, load, step on, and land where stepping straight through lands.
test.each([
  ["ground, a played hero", () => startBattle(spec()), ground],
  ["ground, the AI alone", () => startBattle(spec({ seed: 7 })), () => null],
  ["ground, a hill on a big map", () => startBattle(spec({ mode: "hill", seed: 3 })), ground],
] as const)("a Two Fronts battle round-trips: %s", (_name, start, input) => {
  expect(roundTrip({ step }, start, input, 1200, 4800)).toBeNull();
});

test("a Two Fronts space battle round-trips", () => {
  const start = () => startSpaceBattle({ id: "1-kessa-orbit", turn: 1, system: "Kessa", factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1, fleets: { attacker: 3, defender: 3 }, seed: 9 });
  expect(roundTrip({ step: stepSpace }, start, space, 900, 3600)).toBeNull();
});

test("the round-trip catches a battle whose dice live outside its state, and the battle is still on when saved", () => {
  const b = startBattle(spec());
  for (let i = 0; i < 1200; i++) step(b, ground(i));
  expect(b.over).toBeNull();
  // The sim, but its random stream kept outside the battle, so a load can't bring it back.
  let dice = 99;
  const leaky = { step: (s: ReturnType<typeof startBattle>, i: Input) => { s.seed = dice; step(s, i); dice = s.seed; } };
  expect(roundTrip(leaky, () => startBattle(spec()), ground, 1200, 1500)).not.toBeNull();
});

test("a save keeps what JSON would lose, and won't load into another sim", () => {
  const s = { t: -0, far: Infinity, near: -Infinity, bad: NaN, gone: undefined, units: [{ hp: 3 }] };
  const back = load(save(s), s);
  expect(Object.is(back.t, -0)).toBe(true);
  expect([back.far, back.near, back.bad]).toEqual([Infinity, -Infinity, NaN]);
  expect(firstDiff(s, back)).toBeNull();
  expect(firstDiff(s, { ...back, units: [{ hp: 2 }] })).toBe("units.0.hp: 3 != 2");
  expect(() => load(save({ t: 0, far: 1, near: 1, bad: 1, units: {} }), s)).toThrow("not a save of this sim");
  expect(() => load(save(startSpaceBattle({ id: "x", turn: 1, system: "Kessa", factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1, fleets: { attacker: 1, defender: 1 }, seed: 1 })), startBattle(spec()))).toThrow();
});
