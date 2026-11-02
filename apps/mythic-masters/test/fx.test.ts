import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { chladniModes, chunkScale, groundOf, MAX_LIVE_PHONE, MoveFx, shakeOf } from "../src/fx.ts";
import { creature } from "../src/roster.ts";
import { frames, IDLE, newMatch, step, type Input, type Match, type State } from "../src/sim.ts";

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
function until(r: ReturnType<typeof rig>, inputs: [Input, Input], state: State, more = 0) {
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

  test("holding guard wears a shell of the beast's own field, and it goes when the guard drops", () => {
    const r = rig();
    // the shell is the one visible sphere wrapped round the body at its height; ember motes are far smaller
    const shell = () => r.scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && o.geometry.type === "SphereGeometry" && o.scale.y > 0.5);
    for (let t = 0; t < 5; t++) r.tick();
    expect(shell()).toBeUndefined();
    until(r, [hold({ guard: true }), IDLE], "guard", 3);
    const g = shell()!;
    expect(g).toBeDefined();
    for (let t = 0; t < 4; t++) r.tick();
    expect(shell()).toBeUndefined();
  });

  test("a phone's smaller cap holds the live particles down in a busy fight", () => {
    const scene = new THREE.Scene(), fx = new MoveFx(scene, mulberry32(7), MAX_LIVE_PHONE), m = newMatch(dragon, devil);
    for (let t = 0; t < 600; t++) {
      step(m, [hold({ light: t % 20 < 10, heavy: t % 50 === 0, special: t % 70 === 0 }), hold({ light: t % 15 < 8 })]);
      fx.events(m, m.events); fx.draw(m); fx.update(1 / 600);
    }
    expect(scene.children.filter((o) => o.visible).length).toBeLessThanOrEqual(MAX_LIVE_PHONE + 12);
  });

  test("a falling particle lands on its floor and hops back with its share of the speed, or sticks at 0", () => {
    const rows: [number, number][] = [[0.5, 5], [0.3, 3], [0, 0]]; // bounce, rebound speed from a 10 m/s fall
    for (const [bounce, up] of rows) {
      const scene = new THREE.Scene(), fx = new MoveFx(scene, mulberry32(1));
      const p = fx["spawn"]("chunk", 0xffffff, { x: 0, y: 0.05, z: 0 }, { x: 2, y: -10, z: 0 }, 0.1, 5, { floor: 0, bounce });
      fx.update(0.02);
      expect(p.o.position.y).toBe(0);
      expect(p.vel.y).toBeCloseTo(up, 5);
      expect(p.vel.x).toBeCloseTo(up ? 1.2 : 0, 5); // it skids, or settles dead at 0
    }
  });

  test("heavy blows throw bigger chunks and shake the view harder; a jab does neither", () => {
    expect(chunkScale(0.35)).toBe(1);
    expect(chunkScale(1.7)).toBeGreaterThan(chunkScale(1));
    expect(chunkScale(9)).toBeLessThanOrEqual(1.8);
    expect(shakeOf(20, "ultimate")).toBeGreaterThan(shakeOf(20, "heavy"));
    expect(shakeOf(20, "heavy")).toBeGreaterThan(shakeOf(20, "light"));
    expect(shakeOf(500, "ultimate")).toBe(0.45);
  });

  test("a winding-up move draws Chladni lines on the floor under the fighter, and they are gone when the blow lands", () => {
    const r = rig();
    const plate = () => r.scene.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && o.material instanceof THREE.ShaderMaterial && "strength" in o.material.uniforms);
    for (let t = 0; t < 5; t++) r.tick();
    expect(plate()).toBeUndefined();
    r.m.f[0].energy = 100;
    until(r, [hold({ heavy: true }), IDLE], "attack", 3);
    const p = plate()!;
    expect(p).toBeDefined();
    expect((p.material as THREE.ShaderMaterial).uniforms.strength!.value).toBeGreaterThan(0);
    expect(p.position.y).toBeGreaterThan(r.m.f[0].pos.y);
    for (let t = 0; t < frames(r.m.f[0].moves.heavy).startup + 2; t++) r.tick([hold({ heavy: true }), IDLE]);
    expect(plate()).toBeUndefined();
    expect(chladniModes(8)[0]).toBeGreaterThan(chladniModes(2)[0]); // an ultimate draws a busier figure than a jab
  });

  test("the floor changes the debris: grass throws small dead chunks and little dust, sand more dust, basalt big bouncy slabs", () => {
    const turf = groundOf("turf"), sand = groundOf("sand"), basalt = groundOf("basalt");
    expect(turf.size).toBeLessThan(basalt.size);
    expect(turf.bounce).toBeLessThan(basalt.bounce);
    expect(sand.dust).toBeGreaterThan(turf.dust);
    const size = (floor: "turf" | "basalt") => {
      const scene = new THREE.Scene(), fx = new MoveFx(scene, mulberry32(3));
      fx.setGround(floor);
      fx["kick"]("stone", "heavy", { x: 0, y: 0, z: 0 }, { x: 1, z: 0 }, 40);
      return Math.max(...scene.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry.type === "BoxGeometry").map((o) => o.scale.x));
    };
    expect(size("turf")).toBeLessThan(size("basalt"));
  });

  test("frost shards stick in the ground, and a storm's arcs fork", () => {
    const frost = new THREE.Scene(), ffx = new MoveFx(frost, mulberry32(5));
    ffx["kick"]("frost", "heavy", { x: 0, y: 0, z: 0 }, { x: 1, z: 0 }, 40);
    for (let t = 0; t < 90; t++) ffx.update(1 / 60); // 1.5 s: the shards have landed
    const stuck = frost.children.filter((o) => o.visible && o instanceof THREE.Mesh && o.position.y <= 0.02 && o.scale.y > o.scale.x * 2);
    expect(stuck.length).toBeGreaterThan(0);
    const arcs = (field: "storm" | "gale") => {
      const s = new THREE.Scene(), fx = new MoveFx(s, mulberry32(5));
      fx["kick"](field, "heavy", { x: 0, y: 0, z: 0 }, { x: 1, z: 0 }, 40);
      return s.children.filter((o) => o.visible && o instanceof THREE.Mesh && o.geometry.type === "CylinderGeometry").length;
    };
    expect(arcs("storm")).toBeGreaterThan(arcs("gale") * 2);
  });
});
