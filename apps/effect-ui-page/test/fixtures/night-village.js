// A night village with a pond.
import { world, ground, sky, water, building, path, trees, lamp } from "@world/kit";

const TALL = 10;

world();
sky("night");
ground({ type: "grass" });
water({ x: 34, z: 26, width: 44, depth: 30 });

const HOUSES = [[-45, -32, "#b5523b"], [-14, -40, "#c9a227"], [22, -34, "#4f7cac"], [-48, 22, "#7a9e5f"], [-16, 34, "#8d5b8a"]];
for (const [x, z, color] of HOUSES) building({ x, z, w: 16, d: 12, h: TALL, color, roof: "peak" });

path([[-70, -4], [60, -4]]);
trees(30);
lamp({ x: -14, y: 12, z: 2, color: "#ffb547" });
