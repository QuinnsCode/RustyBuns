// The world a new room starts with: a night desert built with @world/kit (low dunes under a moon and stars, a few
// cactus and rocks, one campfire), so a new person's land stands in 3D in Agent Galaxy. In two small files, so the
// agent's first look shows working code to change or throw away. Plain strings: these are the files.

const index = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My world</title>
<body style="margin:0;background:#070a1f">
<script type="module" src="world.js"></script>
`;

const world = `// A night desert around a campfire. Change anything, or start over.
import { world, ground, sky, cactus, rocks, lamp, every, heightAt, SIZE, THREE } from "@world/kit";

const { scene } = world({ distance: SIZE * 0.65, angle: 6 });
sky("night");
ground({ type: "dunes", color: "#c69a68" });
cactus(18, { size: [2, 3.5] });
rocks(14, { size: [1, 3] });

// The campfire: two logs, a flame and its glow.
const x = SIZE * 0.07, z = SIZE * 0.2, y = heightAt(x, z);
const add = (shape, color, up, turn = 0) => {
  const m = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
  m.position.set(x, y + up, z);
  m.rotation.y = turn;
  scene.add(m);
  return m;
};
for (const turn of [0.6, -0.9]) add(new THREE.BoxGeometry(7, 0.9, 1.1), "#4a2c1c", 0.5, turn);
const flame = add(new THREE.ConeGeometry(1.8, 5, 7), "#ff8a2a", 3);
const glow = lamp({ x, y: y + 6, z, color: "#ff9a3d" });
every((t) => {
  const flicker = Math.sin(t * 7) * 0.5 + Math.sin(t * 13) * 0.3;
  flame.scale.y = 1 + flicker * 0.15;
  glow.intensity = 900 + flicker * 200;
});
`;

export const STARTER_FILES: Readonly<Record<string, string>> = { "index.html": index, "world.js": world };
