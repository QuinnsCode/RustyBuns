// The Blender plants and where they grow: every plant the page draws is in the model, standing on the ground,
// a bush fills the spot you crouch in, and the desert zones grow saguaros and little cacti you can't walk through.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BUSHES, CACTI, SAGUAROS, flora, useFloraModel } from "../src/ui/flora.ts";
import { loadZoneData, zoneById } from "../src/zones/zone.ts";
import { step, type Body } from "../src/hunt/sim.ts";

test("every plant is in the model, feet on the ground, bushes the size of the spot you crouch in", async () => {
  const bytes = await Bun.file(new URL("../public/models/flora.glb", import.meta.url)).arrayBuffer();
  useFloraModel((await new GLTFLoader().parseAsync(bytes, "")).scene);
  for (const name of [...BUSHES, ...SAGUAROS, ...CACTI]) {
    const geo = flora()!.get(name)!;
    expect(geo.attributes.color).toBeDefined();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(Math.abs(box.min.y)).toBeLessThan(0.05);
    if (BUSHES.includes(name as never)) {
      // zone.bushAt hides you within 1.1 sizes of the middle; the bush should cover about that
      expect(Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)).toBeGreaterThan(0.9);
      expect(Math.max(box.max.x, -box.min.x, box.max.z, -box.min.z)).toBeLessThan(1.5);
      expect(box.max.y).toBeGreaterThan(1.1); // tall enough to hide a crouching camper
    }
  }
});

test("the desert grows saguaros and cacti, and a camper walking at one stops", async () => {
  await loadZoneData("saguaro");
  const z = zoneById("saguaro");
  const saguaros = z.props.filter((p) => p.kind === "saguaro"), cacti = z.props.filter((p) => p.kind === "cactus");
  expect(saguaros.length).toBeGreaterThan(30);
  expect(cacti.length).toBeGreaterThan(30);
  expect(z.props.some((p) => p.kind === "pine")).toBe(false);
  // Walk north into a saguaro on flat ground: you end up beside it, not through it.
  const s = saguaros.find((p) => z.slope(p.x, p.y - 3) < 0.2 && z.near(p.x, p.y - 3, 4).every((q) => q === p))!;
  const b: Body = { x: s.x, y: s.y - 3, yaw: 0, stamina: 1, crouch: false, run: false };
  for (let i = 0; i < 120; i++) step(z, b, "camper", { fwd: 1, right: 0, run: false, crouch: false }, 1 / 60);
  expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeGreaterThan(s.r);
});
