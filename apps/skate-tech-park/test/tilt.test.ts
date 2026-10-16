// A manual in the view, driven by the sim: hold it and the nose lifts (the tail, in a nose manual), the
// wheels that stay down stay on the floor whichever skin is showing, and the shaking grows as balance runs out.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { fingerboard, roadster } from "../src/models.ts";
import { makeLevel } from "../src/level.ts";
import { Skins } from "../src/render/skins.ts";
import { lieOnGround, manualPose, REST_TILT, TiltEase } from "../src/render/tilt.ts";
import { IDLE, start, step } from "../src/sim.ts";

const PIVOT = { fingerboard: 0.45, roadster: 0.6 };
const level = makeLevel({ name: "flat", pieces: [], rails: [], spawns: [{ name: "car", x: 0, z: -90, yaw: 0 }], bounds: { minX: -50, maxX: 50, minZ: -100, maxZ: 200 } }); // a long flat road
const ride = (manual: -1 | 1, secs: number) => {
  const p = level.spawns[0]!, sim = start(p.x, p.z, p.yaw, level);
  for (let i = 0; i < 90; i++) step(sim, { ...IDLE, throttle: 1 }, level); // up to speed first
  for (let i = 0; i < secs * 60; i++) step(sim, { ...IDLE, manual }, level);
  return sim;
};

test("a manual lifts the nose, a nose manual lifts the tail, and no manual is flat", () => {
  const m = ride(1, 0.4), n = ride(-1, 0.4);
  expect(m.manual).toBe(1);
  expect(n.manual).toBe(-1);
  expect(manualPose(m.manual, m.balance, "roadster", 0.6, m.manualTime).pitch).toBeLessThan(-0.1); // nose up
  expect(manualPose(n.manual, n.balance, "roadster", 0.6, n.manualTime).pitch).toBeGreaterThan(0.1); // nose down, tail up
  expect(manualPose(0, 0.9, "roadster", 0.6, 3)).toEqual({ pitch: 0, roll: 0, lift: 0 });
});

test.each([["fingerboard"], ["roadster"]] as const)("the %s keeps its wheels on the floor through a manual and a nose manual", (skin) => {
  const skins = new Skins({ fingerboard: fingerboard(), roadster: roadster() }, skin, PIVOT);
  for (const manual of [1, -1] as const) {
    for (const balance of [-0.5, 0, 0.5]) {
      const t = manualPose(manual, balance, skin, PIVOT[skin], 0.3);
      const pivot = skins.pivot();
      pivot.rotation.set(t.pitch, 0, 0);
      pivot.position.y = PIVOT[skin] + t.lift;
      skins.root.updateMatrixWorld(true);
      const low = new THREE.Box3().setFromObject(pivot).min.y;
      expect(low).toBeGreaterThan(-0.25); // not through the floor (the box round a turned wheel is loose)
      expect(low).toBeLessThan(0.1); // and not floating
    }
  }
});

test("the nearer balance is to falling the steeper and shakier it gets, and a manual eases in and out", () => {
  const calm = manualPose(1, 0, "roadster", 0.6, 0.3), tipping = manualPose(1, 0.9, "roadster", 0.6, 0.3);
  expect(calm.pitch).toBeCloseTo(-REST_TILT);
  expect(Math.abs(tipping.pitch)).toBeGreaterThan(Math.abs(calm.pitch));
  let peak = 0, peakCalm = 0;
  for (let t = 0; t < 1; t += 0.01) {
    peak = Math.max(peak, Math.abs(manualPose(1, 0.9, "roadster", 0.6, t).roll));
    peakCalm = Math.max(peakCalm, Math.abs(manualPose(1, 0.1, "roadster", 0.6, t).roll));
  }
  expect(peak).toBeGreaterThan(peakCalm * 5);
  const e = new TiltEase();
  expect(e.update(1, 1 / 60)).toBeGreaterThan(0);
  expect(e.ease).toBeLessThan(0.5); // not a snap
  for (let i = 0; i < 60; i++) e.update(0, 1 / 60);
  expect(e.ease).toBe(0);
});

test("on a slope the board's up is the ground's normal, whatever the heading", () => {
  const up = (gx: number, gz: number, yaw: number) => {
    const o = new THREE.Object3D(), lie = lieOnGround(gx, gz, yaw);
    o.rotation.set(lie.x, yaw, lie.z, "YXZ");
    o.updateMatrixWorld(true);
    const m = o.matrixWorld.elements;
    return new THREE.Vector3(m[4], m[5], m[6]);
  };
  for (const [gx, gz, yaw] of [[0.5, 0, 0.7], [0.3, -0.8, 2.1], [-1.5, 1.2, -1]]) {
    const n = new THREE.Vector3(-gx, 1, -gz).normalize();
    expect(up(gx, gz, yaw).distanceTo(n)).toBeLessThan(1e-9);
  }
});
