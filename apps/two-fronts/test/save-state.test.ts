import { expect, setDefaultTimeout, test } from "bun:test";
import { roundTrip } from "@rustybuns/util/lab/sim-save";
import { NO_PODS, orbitPods, type BattleSpec, type SpaceBattleSpec } from "../src/battle/contract.ts";
import { ORDERS, startBattle, step, type Input } from "../src/battle/sim.ts";
import { startSpaceBattle, stepSpace, type SpaceInput } from "../src/battle/space.ts";

// The first step of #4686: save a battle partway, load it, play on, and land where playing straight through does.
setDefaultTimeout(30_000);

const ground: BattleSpec = {
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 2, defender: 0 },
  reinforcements: { attacker: orbitPods(3), defender: NO_PODS }, turrets: 2, seed: 42,
};
const space: SpaceBattleSpec = {
  id: "1-kessa-orbit", turn: 1, system: "Kessa", factions: { attacker: "marines", defender: "wooka" },
  hero: "attacker", heroLevel: 1, fleets: { attacker: 3, defender: 3 }, seed: 9,
};

// A player's inputs, worked out from the frame alone so both runs get the same ones.
const wave = (i: number, k: number) => Math.sin(i * k) * 0.5 + 0.5;
const groundInput = (i: number): Input => ({
  forward: Math.round(wave(i >> 4, 1.3) * 2) - 1, right: Math.round(wave(i >> 4, 2.1) * 2) - 1,
  yaw: Math.sin(i * 0.01) * 3, fire: wave(i >> 3, 0.7) < 0.6,
  ...(i % 200 === 50 && { use: true }),
  ...(i % 900 === 300 && { strike: { x: wave(i, 0.3) * 200 - 100, z: wave(i, 0.9) * 200 - 100 } }),
  ...(i % 400 === 120 && { order: { kind: ORDERS[(i / 400) % 4 | 0]!, x: wave(i, 0.4) * 200 - 100, z: wave(i, 0.6) * 200 - 100 } }),
});
const spaceInput = (i: number): SpaceInput => ({
  yaw: Math.sin(i * 0.01) * 3, pitch: Math.sin(i * 0.007), throttle: Math.round(wave(i >> 4, 1.1) * 2) - 1, fire: wave(i, 0.9) < 0.5,
});

test.each([
  ["ground, the hero at the controls", () => roundTrip({ start: () => startBattle(ground), step: (b, i) => step(b, i) }, groundInput, 600, 2400)],
  ["ground, the AI on both sides", () => roundTrip({ start: () => startBattle({ ...ground, seed: 7 }), step: (b) => step(b, null) }, () => null, 900, 3000)],
  ["space, the hero at the controls", () => roundTrip({ start: () => startSpaceBattle(space), step: (b, i) => stepSpace(b, i) }, spaceInput, 600, 2400)],
])("a %s battle saved and loaded partway ends where it does played straight", (_, run) => {
  const r = run();
  expect(r.loadDiff).toBeNull();
  expect(r.diff).toBeNull();
  expect(r.bytes).toBeGreaterThan(0);
});
