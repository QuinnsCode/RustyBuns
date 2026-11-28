// A rainy neon town by a river, two blocks by two.
import { SIZE, world, ground, sky, weather, water, streets, building, sign, creature } from "@world/kit";

world();
sky("night");
ground({ color: "#3a3f4a" });
weather("rain");
water({ x: SIZE * 0.44, width: SIZE * 0.12 });

const NEON = ["#ff3d8b", "#21e6ff", "#ffb547", "#a67bff"];
streets().forEach((b, i) => {
  building({ x: b.x - b.w / 4, z: b.z - b.d / 4, w: 24, d: 20, h: 20 + i * 8, color: "#2a2558", roof: "flat", roofColor: NEON[i] });
  building({ x: b.x + b.w / 4, z: b.z + b.d / 4, w: 16, d: 16, h: 12, color: "#3b3570", roof: "flat", roofColor: NEON[3 - i] });
});

sign("Rain town", { x: -12, z: 14 });
creature({ sprite: ["g.g..", "ggg.g", "ggggg", ".g.g."], palette: { g: "#9a97a5" }, flee: 12 });
