// The two lands a new person picks between (one tap, ProfilePage's picker): a hill village and a neon city, each a
// small world built with @world/kit, so it stands in 3D in Agent Galaxy and their AI can change it like any world. Each
// sets its own air (sky, mood, weather, chimney smoke, flying cars), which the galaxy takes as data. Plain strings:
// these are the files.

const index = (title: string, back: string) => `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<body style="margin:0;background:${back}">
<script type="module" src="world.js"></script>
`;

const hill = `// A hill village: round-doored homes dug into mounds, smoke, trees, flowers, a pond and lanterns.
import { world, ground, sky, weather, mood, grass, flowers, smoke, block, heightAt, THREE } from "@world/kit";

const { scene } = world({ distance: 170, angle: 22 });
sky("dusk");
weather("fireflies");
mood({ top: "#4f86c9", low: "#ffd9a0", fog: "#f1cfa0", bloom: 0.5 });
ground({ type: "hills", color: "#5d9238" });

const paint = (color, glow = 0) => new THREE.MeshStandardMaterial({ color, emissive: glow ? color : "#000000", emissiveIntensity: glow });
const put = (to, shape, color, x, y, z, glow) => {
  const m = new THREE.Mesh(shape, paint(color, glow));
  m.position.set(x, y, z);
  to.add(m);
  return m;
};
let seed = 5;
const rnd = (a, b) => a + ((seed = (seed * 16807) % 2147483647) / 2147483647) * (b - a);

// A home: a grassy mound with a round door, round windows and a chimney. turn: which way the door faces.
const HOMES = [[-31, -34, 0.45, "#c1492f", 16], [33, -50, -0.45, "#e0a52c", 12], [-60, 34, 1.2, "#2f8f77", 11], [60, 22, -1.2, "#3d6fa8", 13]];
for (const [x, z, turn, door, r] of HOMES) {
  const h = new THREE.Group();
  // Level with the ground at its own door, so the slope never covers it.
  h.position.set(x, heightAt(x + Math.sin(turn) * (r + 1), z + Math.cos(turn) * (r + 1)) + 0.2, z);
  h.rotation.y = turn;
  scene.add(h);
  put(h, new THREE.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), "#6c9c3e", 0, 0, 0).scale.set(1.25, 0.72, 1);
  // Just proud of the mound, so the grass never covers the door.
  const face = r * 1.01;
  put(h, new THREE.CylinderGeometry(r * 0.52, r * 0.52, 1.6, 28), "#ead7ac", 0, r * 0.2, face - 0.6).rotation.x = Math.PI / 2;
  put(h, new THREE.TorusGeometry(r * 0.27, r * 0.05, 8, 28), "#5b3a22", 0, r * 0.24, face + 0.25);
  put(h, new THREE.CircleGeometry(r * 0.26, 28), door, 0, r * 0.24, face + 0.3);
  put(h, new THREE.SphereGeometry(r * 0.03, 8, 6), "#ffd36a", 0, r * 0.24, face + 0.55, 1);
  for (const side of [-1, 1]) {
    put(h, new THREE.CircleGeometry(r * 0.1, 18), "#ffbf5c", side * r * 0.4, r * 0.3, face + 0.25, 1);
    put(h, new THREE.TorusGeometry(r * 0.11, r * 0.022, 6, 20), "#5b3a22", side * r * 0.4, r * 0.3, face + 0.3);
  }
  put(h, new THREE.CylinderGeometry(0.7, 0.9, 4.4, 8), "#9b5c43", -r * 0.55, r * 0.68, -r * 0.1);
  for (let i = 1; i < 6; i++) put(h, new THREE.CylinderGeometry(1.1, 1.1, 0.35, 8), "#cbbd9f", rnd(-0.7, 0.7), 1, face + i * 2.6);
  const c = Math.cos(turn), s = Math.sin(turn), cx = -r * 0.55, cz = -r * 0.1;
  const at = [x + cx * c + cz * s, z - cx * s + cz * c];
  smoke(at[0], h.position.y + r * 0.68 + 2.4 - heightAt(at[0], at[1]), at[1]);
  block(x, z, r * 2, r * 1.6);
}

// The pond and its lily pads.
const POND = { x: 30, z: 34, r: 17 };
const level = heightAt(POND.x, POND.z) + 1.4;
const water = put(scene, new THREE.CircleGeometry(POND.r, 40).rotateX(-Math.PI / 2), "#3c8fa8", POND.x, level, POND.z, 0.3);
water.material.transparent = true;
water.material.opacity = 0.92;
for (let i = 0; i < 14; i++) put(scene, new THREE.CircleGeometry(rnd(0.8, 1.6), 10, 0, 5.6).rotateX(-Math.PI / 2), "#57a043", POND.x + rnd(-11, 11), level + 0.1, POND.z + rnd(-11, 11));
block(POND.x, POND.z, POND.r * 1.4, POND.r * 1.4);

// Round leafy trees, away from the homes, the pond and the middle.
const clear = (x, z) => HOMES.every((h) => Math.hypot(x - h[0], z - h[1]) > h[4] * 1.8) && Math.hypot(x - POND.x, z - POND.z) > POND.r + 8 && (Math.abs(x) > 18 || z < -70);
const LEAVES = ["#3f7d33", "#5e9a35", "#7fae3a", "#d3922e"].map((c) => paint(c));
const BARK = paint("#6a4428"), BLOB = new THREE.IcosahedronGeometry(1, 1), TRUNK = new THREE.CylinderGeometry(0.35, 0.7, 4, 6);
for (let i = 0, n = 0; i < 400 && n < 40; i++) {
  const x = rnd(-90, 90), z = rnd(-90, 90);
  if (!clear(x, z)) continue;
  const s = rnd(0.9, 1.7), y = heightAt(x, z), trunk = new THREE.Mesh(TRUNK, BARK);
  trunk.position.set(x, y + 2 * s, z);
  trunk.scale.setScalar(s);
  scene.add(trunk);
  for (let k = 0; k < 4; k++) {
    const leaf = new THREE.Mesh(BLOB, LEAVES[n % 4]);
    leaf.position.set(x + rnd(-1.8, 1.8) * s, y + (4.6 + rnd(-0.6, 1.6)) * s, z + rnd(-1.8, 1.8) * s);
    leaf.scale.setScalar(rnd(1.6, 2.5) * s);
    scene.add(leaf);
  }
  n++;
}

// Lanterns along a winding path.
for (let i = 0; i < 12; i++) {
  const x = 8 + Math.sin(i * 0.8) * 6, z = 84 - i * 14.5, y = heightAt(x, z);
  put(scene, new THREE.CylinderGeometry(0.18, 0.24, 4, 6), "#4a3320", x, y + 2, z);
  put(scene, new THREE.SphereGeometry(0.7, 10, 8), "#ffae3d", x, y + 4.4, z, 2.6);
}

grass(2600, { color: "#82b341" });
flowers(600);
`;

const neon = `// A neon city: lit towers, signs, market stalls, a wet street, rain and cars that fly.
import { world, ground, sky, weather, mood, building, box, sign, flyers, smoke } from "@world/kit";

world({ distance: 190, angle: 24 });
sky("night");
weather("rain");
mood({ top: "#0b0824", low: "#5a1d6e", fog: "#2a1248", near: 80, far: 430, bloom: 0.65 });
ground({ color: "#252238" });

const NEON = ["#2cf6ff", "#ff2e97", "#ffb02e", "#a56bff"];
let seed = 9;
const rnd = (a, b) => a + ((seed = (seed * 16807) % 2147483647) / 2147483647) * (b - a);
const pick = () => NEON[Math.floor(rnd(0, 3.99))];

// Towers around an open middle, each with a lit rim and some with a light down one corner.
for (const x of [-84, -60, -36, 36, 60, 84]) for (const z of [-76, -46, -16, 16, 52]) {
  if (Math.abs(x) < 40 && z > 0) continue;
  const w = rnd(12, 18), d = rnd(12, 18), h = rnd(14, 34) + (z < -40 ? rnd(8, 34) : 0), px = x + rnd(-3, 3), pz = z + rnd(-3, 3);
  building({ x: px, z: pz, w, d, h, color: "#1d1a30", roof: "flat", roofColor: "#2c2846", windows: pick() });
  const edge = pick();
  box({ x: px, y: h + 0.6, z: pz, w: w + 0.8, h: 0.4, d: d + 0.8, color: edge, glow: 1.8 });
  if (rnd(0, 1) > 0.5) box({ x: px + w / 2 + 0.2, y: 0, z: pz + d / 2 + 0.2, w: 0.5, h, d: 0.5, color: edge, glow: 1.8 });
  if (h > 52) box({ x: px, y: h + 1, z: pz, w: 0.6, h: 10, d: 0.6, color: "#ff3b3b", glow: 2.5 });
}

// Big glowing signs.
const SIGNS = [["NOODLES", -28, 6, 0.5], ["HOTEL", 29, 26, -0.6], ["OPEN 24", -40, 36, 0.7], ["ARCADE", 38, -2, -0.5], ["TEA", -26, -62, 0.3], ["REPAIR", 24, -66, -0.3]];
SIGNS.forEach(([words, x, z, turn], i) => sign(words, { x, z, turn, size: 0.8, board: "#170d2b", ink: NEON[i % 4], glow: 2 }));

// Market stalls down both sides of the street, with lanterns.
for (let i = 0; i < 10; i++) {
  const side = i % 2 ? 1 : -1, x = side * 17, z = -56 + i * 13, c = NEON[i % 4];
  box({ x, z, w: 5, h: 2.4, d: 4, color: "#6d5a96", glow: 0.35 });
  box({ x, y: 2.4, z, w: 4.6, h: 0.3, d: 4.1, color: c, glow: 1.4 });
  box({ x, y: 5.4, z, w: 6.4, h: 0.4, d: 5.4, color: c, glow: 0.5 });
  for (const p of [-2.8, 2.8]) for (const q of [-2.3, 2.3]) box({ x: x + p, y: 0, z: z + q, w: 0.3, h: 5.4, d: 0.3, color: "#8a82a8" });
  box({ x: x - side * 3.2, y: 3.6, z: z + 2.4, w: 1, h: 1.3, d: 1, color: i % 3 ? "#ffb02e" : "#ff5a5a", glow: 2.4 });
  if (i % 3 === 0) smoke(x, 6, z);
}

// The street: wet, so it throws the lights back, with a strip of light down each side.
box({ y: 0.02, w: 26, h: 0.06, d: 176, color: "#15132a" });
for (const side of [-1, 1]) box({ x: side * 12.6, y: 0.05, w: 0.5, h: 0.12, d: 176, color: side < 0 ? "#2cf6ff" : "#ff2e97", glow: 1.8 });
for (let i = 0; i < 70; i++) {
  const c = Math.floor(rnd(0, 3.99)), x = rnd(-11, 11), z = rnd(-84, 84), long = rnd(5, 15);
  const m = box({ x, y: 0.09 + i * 0.0004, z, w: rnd(0.3, 1), h: 0.02, d: long, color: NEON[c], glow: 0.5 });
  m.material.transparent = true;
  m.material.opacity = 0.22;
}

flyers(9);
`;

export interface Start { readonly name: string; readonly files: Readonly<Record<string, string>> }

export const LANDS: readonly Start[] = [
  { name: "Hill village", files: { "index.html": index("Hill village", "#f1cfa0"), "world.js": hill } },
  { name: "Neon city", files: { "index.html": index("Neon city", "#0b0824"), "world.js": neon } },
];
