// `@world/kit`: what a world imports so it doesn't have to write the same three.js every time. The source is a string:
// world.ts puts it in the frame's import map as a data: URL, so it runs sealed like the world's own code. One call
// each for the scene and camera, ground, sky, weather, water, trees, cactus, rocks, lights, and where a visitor is
// walking (the page's `{ agent_page: true, player }` message). A world never draws the player.

export const KIT = `
import * as THREE from "https://esm.sh/three@0.170.0";
export { THREE };

/** The plot is SIZE units square, centred on 0: x west to east, z north to south, y up. */
export const SIZE = 100;
const frames = [];
let made = null, height = () => 0, wet = () => false, seed = 7, sun, fill, falling = null;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (a, b) => a + rnd() * (b - a);
const mat = (color, more) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...more });

/** The scene, a 2.5D camera (from above at an angle), the renderer, resizing and the loop. orbit: radians a second. */
export function world({ orbit = 0, distance = 140, angle = 38 } = {}) {
  if (made) return made;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 1, 900);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.style.cssText += ";margin:0;overflow:hidden";
  // Over the window whatever index.html already holds, and first, so its own fixed signs and buttons stay on top.
  renderer.domElement.style.cssText = "position:fixed;left:0;top:0;display:block";
  document.body.prepend(renderer.domElement);
  fill = new THREE.HemisphereLight("#dfe8ff", "#404030", 1.2);
  sun = new THREE.DirectionalLight("#fff4e0", 1.6);
  sun.position.set(40, 70, 25);
  scene.add(fill, sun);
  made = { THREE, scene, camera, renderer };
  let w = 0, h = 0, last = 0;
  const up = (angle * Math.PI) / 180;
  const loop = (ms) => {
    // The frame can be 0 wide on its first tick, so the size is read every frame.
    if (innerWidth !== w || innerHeight !== h) {
      w = innerWidth; h = innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h || 1;
      // A tall screen zooms out, so the plot stays in view.
      camera.zoom = Math.min(1, Math.max(0.4, camera.aspect * 0.8));
      camera.updateProjectionMatrix();
    }
    const t = ms / 1000, dt = Math.min(0.05, Math.max(0, t - last)), a = t * orbit + 0.5;
    last = t;
    camera.position.set(Math.sin(a) * Math.cos(up) * distance, Math.sin(up) * distance, Math.cos(a) * Math.cos(up) * distance);
    camera.lookAt(0, 0, 0);
    for (const f of frames) f(t, dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return made;
}

/** Run f(t, dt) before each frame is drawn (seconds). */
export const every = (f) => void frames.push(f);
const add = (o) => { world().scene.add(o); return o; };

/** The ground's height at x, z. */
export const heightAt = (x, z) => height(x, z);

const SHAPES = {
  flat: ["#8a8578", () => 0],
  dunes: ["#d9ad6a", (x, z) => 2.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) + 1.2 * Math.sin(z * 0.17)],
  hills: ["#5f8f4e", (x, z) => 4 * Math.sin(x * 0.07) * Math.cos(z * 0.06) + 1.5 * Math.sin((x + z) * 0.13)],
  grass: ["#4f9a45", () => 0],
};

/** type: "flat", "dunes", "hills" or "grass". */
export function ground({ type = "flat", color } = {}) {
  const [usual, shape] = SHAPES[type] ?? SHAPES.flat;
  height = shape;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, 80, 80).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = add(new THREE.Mesh(g, mat(color ?? usual)));
  if (type === "grass") scatter(900, new THREE.ConeGeometry(0.18, 0.9, 4).translate(0, 0.45, 0), mat(color ?? usual), {});
  return m;
}

// n copies of one shape on the ground, never in water. area: [x0, z0, x1, z1].
function scatter(n, geometry, material, { area = [-46, -46, 46, 46], size = [0.7, 1.4] }) {
  const mesh = new THREE.InstancedMesh(geometry, material, n), o = new THREE.Object3D();
  let put = 0;
  for (let i = 0; i < n * 4 && put < n; i++) {
    const x = between(area[0], area[2]), z = between(area[1], area[3]), y = height(x, z);
    const turn = rnd() * 6.3, big = between(size[0], size[1]);
    if (wet(x, z, y)) continue;
    o.position.set(x, y, z);
    o.rotation.y = turn;
    o.scale.setScalar(big);
    o.updateMatrix();
    mesh.setMatrixAt(put++, o.matrix);
  }
  mesh.count = put;
  return add(mesh);
}
// Two shapes that stand in the same places: a trunk and its crown.
const pair = (n, a, aColor, b, bColor, o) => {
  const was = seed;
  scatter(n, a, mat(aColor), o);
  seed = was;
  return scatter(n, b, mat(bColor), o);
};

/** A flat sheet of water at height y: the whole plot, or width x depth centred on x, z. */
export function water({ y = 0.1, x = 0, z = 0, width = SIZE, depth = SIZE, color = "#1b6f9f" } = {}) {
  wet = (px, pz, py) => py <= y && Math.abs(px - x) < width / 2 && Math.abs(pz - z) < depth / 2;
  const m = add(new THREE.Mesh(new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2), mat(color, { transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.3 })));
  m.position.set(x, y, z);
  every((t) => (m.position.y = y + Math.sin(t * 1.3) * 0.08));
  return m;
}

/** Trees, cactus and rocks, n of them, with { area, size, color }. Call after ground and water. */
export const trees = (n = 30, o = {}) => pair(n, new THREE.CylinderGeometry(0.2, 0.35, 2).translate(0, 1, 0), o.trunk ?? "#6b4a30",
  new THREE.ConeGeometry(1.6, 3.6, 7).translate(0, 3.4, 0), o.color ?? "#2e7d4f", o);
export const cactus = (n = 20, o = {}) => pair(n, new THREE.CapsuleGeometry(0.45, 2.6).translate(0, 1.7, 0), o.color ?? "#3f8f52",
  new THREE.CapsuleGeometry(0.28, 1.1).translate(0.85, 2.2, 0), o.color ?? "#3f8f52", o);
export const rocks = (n = 20, o = {}) => scatter(n, new THREE.DodecahedronGeometry(0.9), mat(o.color ?? "#77747c"), o);

/** The sun and the sky's fill light. at: [x, y, z] of the sun. */
export function lights({ sun: strength, fill: soft, color, at } = {}) {
  world();
  if (strength !== undefined) sun.intensity = strength;
  if (soft !== undefined) fill.intensity = soft;
  if (color) sun.color.set(color);
  if (at) sun.position.set(...at);
  return { sun, fill };
}
/** A lamp: a coloured glow at a place. */
export function lamp({ x = 0, y = 10, z = 0, color = "#ffb547", strength = 500 } = {}) {
  const l = add(new THREE.PointLight(color, strength, 60));
  l.position.set(x, y, z);
  return l;
}

const SKIES = { day: ["#9fd3ff", 1.8, 1.3, "#fff4e0"], dusk: ["#f08a6c", 1.2, 0.8, "#ffb070"], night: ["#070a1f", 0.7, 0.7, "#a8b8ff"] };

/** "day", "night" (stars and a moon) or "dusk". */
export function sky(type = "day") {
  const { scene } = world();
  const [back, strength, soft, color] = SKIES[type] ?? SKIES.day;
  scene.background = new THREE.Color(back);
  scene.fog = new THREE.Fog(back, 160, 420);
  lights({ sun: strength, fill: soft, color });
  const ball = (r, c, x, y, z) => add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: c, fog: false }))).position.set(x, y, z);
  if (type === "dusk") ball(14, "#ffd27a", -190, 30, -240);
  if (type !== "night") return;
  ball(9, "#f4f1dd", -150, 75, -230);
  const at = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * 6.3, b = between(-0.2, 1.4);
    at.push(Math.cos(a) * Math.cos(b) * 320, Math.sin(b) * 320, Math.sin(a) * Math.cos(b) * 320);
  }
  add(new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(at, 3)), new THREE.PointsMaterial({ color: "#dfe6ff", size: 1.4, fog: false })));
}

/** "rain", "snow", "fog" or "clear". Call after sky. */
export function weather(type = "clear") {
  const { scene } = world();
  if (falling) scene.remove(falling.points);
  falling = null;
  if (type === "fog") scene.fog = new THREE.Fog(scene.background?.isColor ? scene.background : "#aab4c4", 80, 220);
  else if (scene.fog) { scene.fog.near = 160; scene.fog.far = 420; }
  if (type !== "rain" && type !== "snow") return;
  const snow = type === "snow", n = snow ? 1800 : 3000, at = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) at.set([between(-60, 60), between(0, 55), between(-60, 60)], i * 3);
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(at, 3));
  falling = { at, speed: snow ? 6 : 42, drift: snow ? 2 : 0, points: add(new THREE.Points(g, new THREE.PointsMaterial({ color: snow ? "#ffffff" : "#a9c4ff", size: snow ? 0.6 : 0.3, transparent: true, opacity: 0.75 }))) };
}
every((t, dt) => {
  if (!falling) return;
  const { at, speed, drift, points } = falling;
  for (let i = 0; i < at.length; i += 3) {
    at[i] += Math.sin(t + i) * drift * dt;
    at[i + 1] -= speed * dt;
    if (at[i + 1] < 0) at[i + 1] += 55;
  }
  points.geometry.attributes.position.needsUpdate = true;
});

/** cb(player, at) as a visitor walks the plot: player is { x, z } from 0 to 1, at is that spot in world units.
 *  cb(null, null) when nobody is there. React to them (light a lamp, open a door); don't draw them. */
export function onPlayer(cb) {
  addEventListener("message", (e) => {
    if (e.source !== parent || e.data?.agent_page !== true) return;
    const p = e.data.player;
    if (p === null) return cb(null, null);
    if (typeof p?.x !== "number" || typeof p?.z !== "number") return;
    const x = (p.x - 0.5) * SIZE, z = (p.z - 0.5) * SIZE;
    cb({ x: p.x, z: p.z }, { x, y: height(x, z), z });
  });
}
`;
