// Where the plants grow: the desert zones grow saguaros and little cacti you can't walk through.
import { expect, test } from "bun:test";
import { loadZoneData, zoneById } from "../src/zones/zone.ts";
import { step, type Body } from "../src/hunt/sim.ts";

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
