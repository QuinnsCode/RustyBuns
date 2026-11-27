// A rainy neon city by a river, slowly orbiting.
import { world, ground, sky, weather, water, trees, rocks, lamp, THREE } from "@world/kit";

const { scene } = world({ orbit: 0.05 });
sky("night");
ground({ color: "#14122e" });
water({ x: 22, width: 12 });
weather("rain");

const NEON = ["#ff3d8b", "#21e6ff", "#ffb547", "#a67bff", "#3dffa8"];
const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const block = (material, x, y, z, w, h) => {
  const m = new THREE.Mesh(box, material);
  m.position.set(x, y, z);
  m.scale.set(w, h, w);
  scene.add(m);
};
for (let x = -36; x <= 12; x += 8) for (let z = -36; z <= 36; z += 8) {
  const tall = 4 + Math.abs(Math.sin(x * 7 + z * 3)) * 18;
  block(new THREE.MeshStandardMaterial({ color: "#2a2558" }), x, 0, z, 5, tall);
  block(new THREE.MeshBasicMaterial({ color: NEON[Math.abs((x + z * 3) / 8) % 5] }), x, tall, z, 5.2, 0.25);
}

trees(24, { area: [31, -45, 47, 45] });
rocks(10, { area: [29, -45, 33, 45], size: [0.5, 1.2] });
lamp({ x: -16, y: 12, z: 20, color: "#ff3d8b" });
lamp({ x: 4, y: 12, z: -20, color: "#21e6ff" });
