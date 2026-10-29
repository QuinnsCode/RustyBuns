import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { MoveFx } from "../src/fx.ts";
import { creature } from "../src/roster.ts";
import { frames, IDLE, newMatch, step, type Input, type Match } from "../src/sim.ts";

// The effects are judged by eye in a fight; what a test can hold is that the right moments make particles, that
// they die, and that a long fight reuses them instead of filling the scene.
const hold = (i: Partial<Input>): Input => ({ ...IDLE, ...i });
const dragon = creature("red-dragon"), devil = creature("jersey-devil");
function rig(a = dragon, b = devil) {
  const scene = new THREE.Scene(), fx = new MoveFx(scene, mulberry32(7)), m = newMatch(a, b);
  const live = () => scene.children.filter((o) => o.visible).length;
  const tick = (inputs: [Input, Input] = [IDLE, IDLE]) => { step(m, inputs); fx.events(m, m.events); fx.draw(m); fx.update(1 / 60); };
  return { scene, fx, m, live, tick };
}
/** Run `m` until fighter 0 is in `state`, then `more` ticks further. */
function until(r: ReturnType<typeof rig>, inputs: [Input, Input], state: string, more = 0) {
  for (let t = 0; t < 120 && r.m.f[0].state !== state; t++) r.tick(inputs);
  expect(r.m.f[0].state).toBe(state);
  for (let t = 0; t < more; t++) r.tick(inputs);
}

describe("move effects", () => {
  test("a beast standing still sheds its element, a charge gathers more, and it all dies away", () => {
    const r = rig();
    for (let t = 0; t < 30; t++) r.tick();
    const idle = r.live();
    expect(idle).toBeGreaterThan(2); // the auras, plus ember motes
    until(r, [hold({ charge: true }), IDLE], "charge", 30);
    expect(r.live()).toBeGreaterThan(idle);
    for (let t = 0; t < 200; t++) r.fx.update(1 / 60);
    expect(r.live()).toBeLessThanOrEqual(2); // only the two auras stay
  });

  test("a breath keeps pouring out ahead of the mouth long after a jab's trail has stopped", () => {
    const ahead = (slot: "ultimate" | "light") => {
      const r = rig();
      r.m.f[0].energy = 100;
      until(r, [hold({ [slot]: true }), IDLE], "attack", frames(r.m.f[0].moves[slot]).startup + 20);
      const f = r.m.f[0], fwd = new THREE.Vector3(Math.cos(f.yaw), 0, Math.sin(f.yaw)), at = new THREE.Vector3(f.pos.x, f.pos.y, f.pos.z);
      return r.scene.children.filter((o) => o.visible && o.position.clone().sub(at).dot(fwd) > 0.8).length;
    };
    // what's ahead of a jab by then is the other fighter's own aura and motes; the breath is far more than that
    const jab = ahead("light");
    expect(ahead("ultimate")).toBeGreaterThan(jab * 2 + 20);
  });

  test("a hit flashes the one struck for eight ticks, and a landing raises dust by how hard it was", () => {
    const r = rig(creature("hodag"), creature("jackalope"));
    r.m.f[1].pos = { x: -4.6, y: 0, z: 0 }; r.m.f[1].yaw = Math.PI;
    let hitTick = -1;
    for (let t = 0; t < 60 && hitTick < 0; t++) { r.tick([hold({ light: true }), IDLE]); if (r.m.events.some((e) => e.kind === "hit")) hitTick = r.m.tick; }
    expect(hitTick).toBeGreaterThan(0);
    expect(r.fx.flashOf(1, hitTick)).toBe(1);
    expect(r.fx.flashOf(1, hitTick + 8)).toBe(0);
    const fall = (vy: number) => {
      const q = rig(creature("hodag"), creature("jackalope"));
      for (let t = 0; t < 10; t++) q.tick();
      const before = q.live();
      Object.assign(q.m.f[0], { pos: { x: 0, y: 0.05, z: 0 }, vel: { x: 0, y: -vy, z: 0 }, onGround: false });
      q.tick();
      return q.live() - before;
    };
    expect(fall(12)).toBeGreaterThan(fall(2));
  });

  test("a long fight pools its particles: the scene stops growing", () => {
    const r = rig();
    const bots = (m: Match): [Input, Input] => [hold({ light: m.tick % 20 < 10, heavy: m.tick % 50 === 0, special: m.tick % 70 === 0 }), hold({ light: m.tick % 15 < 8 })];
    for (let t = 0; t < 400; t++) r.tick(bots(r.m));
    const grown = r.scene.children.length;
    for (let t = 0; t < 400; t++) r.tick(bots(r.m));
    expect(r.scene.children.length).toBeLessThanOrEqual(grown + 20);
    expect(r.scene.children.length).toBeLessThan(900);
  });

  test("shots are drawn where they fly, and clear() hides everything", () => {
    const r = rig();
    r.m.f[0].energy = 100;
    until(r, [hold({ special: true }), IDLE], "attack", frames(r.m.f[0].moves.special).startup + 2);
    expect(r.m.shots.length).toBe(1);
    const shot = r.m.shots[0]!;
    const near = r.scene.children.filter((o) => o.visible && o.position.distanceTo(new THREE.Vector3(shot.pos.x, shot.pos.y, shot.pos.z)) < 0.01);
    expect(near.length).toBeGreaterThanOrEqual(2); // the core and its glow
    r.fx.clear();
    expect(r.live()).toBe(0);
  });
});
