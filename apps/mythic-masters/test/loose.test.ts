import { expect, test } from "bun:test";
import * as THREE from "three";
import { LooseLag, looseParts, reachOf } from "../src/loose.ts";

test("the cards and quills are loose, the body and the hard bits are not", () => {
  // a furred beast: its own fur is the body; the mane cards swing, a spike at half reach, an eye and a claw stay put
  const parts = [{ name: "fur", count: 6000 }, { name: "mane", count: 900 }, { name: "spike", count: 300 }, { name: "eye", count: 80 }, { name: "claw", count: 120 }];
  expect(looseParts(parts)).toEqual([0, 1, 0.5, 0, 0]);
});

test("a card's root sits still and its tip reaches out", () => {
  const body = [0, 0, 0, 0, 1, 0, 0, 2, 0];
  const reach = reachOf([0, 1, 0, 0.5, 1, 0], body, 2, 1);
  expect(reach[0]).toBe(0);
  expect(reach[1]).toBeCloseTo(0.25);
});

test("a lunge leaves the cards behind and a stop throws them on, then they settle", () => {
  const lag = new LooseLag(1, "bruiser"), inv = new THREE.Matrix4(), dt = 1 / 60;
  let x = 0, t = 0;
  const step = () => { t += dt; lag.step(dt, (_, out) => out.set(x, 0, 0), inv, 2, t); return lag.texture.image.data![0]!; };
  step();
  for (let i = 0; i < 10; i++) { x += 0.15; step(); }   // dash forward along +x at 9 m/s
  const dashing = step();
  expect(dashing).toBeLessThan(-0.01);                  // trailing behind
  let most = 0;
  for (let i = 0; i < 30; i++) most = Math.max(most, step());   // the body stops dead
  expect(most).toBeGreaterThan(0.01);                   // flung past the bone
  for (let i = 0; i < 240; i++) step();
  expect(Math.abs(step())).toBeLessThan(1e-3);          // and settled
});
