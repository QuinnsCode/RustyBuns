// A rainy neon town by a river, two blocks by two.
import { world, ground, sky, weather, water, streets, building, trees, lamp, sign, creature } from "@world/kit";

world();
sky("night");
ground({ color: "#3a3f4a" });
weather("rain");
water({ x: 44, width: 12 });

const NEON = ["#ff3d8b", "#21e6ff", "#ffb547", "#a67bff"];
streets().forEach((b, i) => {
  building({ x: b.x - 8, z: b.z - 6, w: 14, d: 12, h: 12 + i * 5, color: "#2a2558", roof: "flat", roofColor: NEON[i] });
  building({ x: b.x + 9, z: b.z + 8, w: 10, d: 10, h: 8, color: "#3b3570", roof: "flat", roofColor: NEON[3 - i] });
});

trees(8, { area: [-46, 38, -20, 46] });
lamp({ x: -16, y: 12, z: 20, color: "#ff3d8b" });
sign("Rain town", { x: -6, z: 7 });
creature({ sprite: ["g.g..", "ggg.g", "ggggg", ".g.g."], palette: { g: "#9a97a5" }, flee: 12 });
