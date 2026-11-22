import { expect, setDefaultTimeout, test } from "bun:test";
import { NO_PODS, type BattleSpec } from "../src/battle/contract.ts";
import { groundInputs, groundRecorder } from "../src/battle/replay.ts";
import { DUCKED_BLAST, DUCKED_HIT, NADE_MAX, NADE_START, ducked, heroUnit, hitChance, shielded, startBattle, step, type Battle, type Input } from "../src/battle/sim.ts";

setDefaultTimeout(30_000);

const spec = (over: Partial<BattleSpec> = {}): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector: "shield",
  factions: { attacker: "marines", defender: "marines" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 2, defender: 2 }, tickets: { attacker: 75, defender: 75 },
  vehicles: { attacker: {}, defender: {} }, strikes: { attacker: 0, defender: 0 },
  reinforcements: { attacker: NO_PODS, defender: NO_PODS }, turrets: 0, seed: 7, ...over,
});
const idle = (over: Partial<Input> = {}): Input => ({ forward: 0, right: 0, yaw: Math.PI, fire: false, ...over });

// The hero alone with one foe and one sandbag wall between them, the wall 3 m to the hero's north (towards -z).
function field() {
  const b = startBattle(spec());
  const hero = heroUnit(b)!, foe = b.units.find((u) => u.side === "defender" && u.kind === "assault")!;
  b.units = [hero, foe];
  b.trees = []; b.blocks = [{ x: 0, z: -3, w: 6, d: 1, h: 1.15 }]; b.caches = []; b.crates = [];
  Object.assign(hero, { x: 0, z: 0, yaw: Math.PI });
  Object.assign(foe, { x: 0, z: -25 });
  return { b, hero, foe };
}
const slideIn = (b: Battle) => { step(b, idle({ cover: true })); for (let i = 0; i < 40 && !b.hero.cover; i++) step(b, idle()); };

test("the cover key slides the hero up to a low wall, and ducked there a shot from over it rarely lands", () => {
  const { b, hero, foe } = field();
  const open = hitChance(b, foe, hero);
  slideIn(b);
  expect(b.hero.cover).not.toBeNull();
  expect(Math.abs(hero.z - -3)).toBeLessThan(1.6); // up against it
  expect(ducked(b, hero)).toBe(true);
  expect(hitChance(b, foe, hero)).toBeLessThanOrEqual(open * DUCKED_HIT);
  // Fire, and you stand up to shoot over it: no better than a wall alone.
  step(b, idle({ fire: true }));
  expect(ducked(b, hero)).toBe(false);
  // The cover key again, and you're out.
  for (let i = 0; i < 30; i++) step(b, idle());
  step(b, idle({ cover: true }));
  expect(b.hero.cover).toBeNull();
});

test("ducked, a blast on the far side of the wall barely gets over, and one on your side gets you in full", () => {
  const { b, hero } = field();
  slideIn(b);
  expect(shielded(b, hero, { x: 0, z: -7 })).toBe(true);   // the far side
  expect(shielded(b, hero, { x: 0, z: 0 })).toBe(false);   // your side
  expect(shielded(b, hero, { x: 20, z: -7 })).toBe(false); // round the end of the wall
  expect(DUCKED_BLAST).toBeLessThan(0.5);
});

test("a grenade crate fills the hero up, and a thrown grenade lands where the gun points and goes off there", () => {
  const { b, hero, foe } = field();
  expect(b.hero.nades).toBe(NADE_START);
  b.blocks = [];
  Object.assign(foe, { x: 0, z: -15 });
  const hp = foe.hp;
  step(b, idle({ nade: true }));
  expect(b.hero.nades).toBe(NADE_START - 1);
  const nade = b.strikes.find((s) => s.nade)!;
  expect(Math.hypot(nade.x - foe.x, nade.z - foe.z)).toBeLessThan(1);
  for (let i = 0; i < 60; i++) step(b, idle());
  expect(foe.hp < hp || !b.units.includes(foe)).toBe(true);
  b.crates = [{ id: 0, x: hero.x, z: hero.z, ready: 0 }];
  step(b, idle());
  expect(b.hero.nades).toBe(NADE_MAX);
});

test("the cover key and grenades go into the input log and come back out", () => {
  const rec = groundRecorder(), played = [idle(), idle({ cover: true }), idle({ nade: true, fire: true }), idle({ cover: true, nade: true, order: { kind: "hold", x: 1, z: 2 } }), idle()].map((i) => rec.take(i));
  expect([...groundInputs(rec.log())]).toEqual(played);
});
