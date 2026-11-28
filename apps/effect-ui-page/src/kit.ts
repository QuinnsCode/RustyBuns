// `@world/kit`: what a world imports so it doesn't have to write the same three.js every time. The source is a string:
// world.ts puts it in the frame's import map as a data: URL, so it runs sealed like the world's own code. One call
// each for the scene and camera, ground, sky, weather, water, trees, cactus, rocks, lights, and where a visitor is
// walking (the page's `{ agent_page: true, player }` message). A world never draws the player.

import { PLOT } from "./land.ts";

export const KIT = `
import * as THREE from "https://esm.sh/three@0.170.0";
export { THREE };

/** The plot is SIZE units square, centred on 0: x west to east, z north to south, y up. */
export const SIZE = ${PLOT};
// Hills come down to level at the property line, so one plot's ground meets the next with no step.
const level = (x, z) => Math.max(0, Math.min(1, (SIZE / 2 - Math.max(Math.abs(x), Math.abs(z))) / 24));
const frames = [];
let made = null, height = () => 0, wet = () => false, seed = 7, sun, fill, falling = null;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const between = (a, b) => a + rnd() * (b - a);
const mat = (color, more) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...more });

/** The scene, a 2.5D camera (from above at an angle), the renderer, resizing and the loop. orbit: radians a second. */
export function world({ orbit = 0, distance = 280, angle = 38 } = {}) {
  if (made) return made;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 1, 1800);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.style.cssText += ";margin:0;overflow:hidden";
  // Over the window whatever index.html already holds, and first, so its own fixed signs and buttons stay on top.
  renderer.domElement.style.cssText = "position:fixed;left:0;top:0;display:block";
  document.body.prepend(renderer.domElement);
  fill = new THREE.HemisphereLight("#dfe8ff", "#404030", 1.2);
  sun = new THREE.DirectionalLight("#fff4e0", 1.6);
  sun.position.set(80, 140, 50);
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
  height = (x, z) => shape(x, z) * level(x, z);
  const g = new THREE.PlaneGeometry(SIZE, SIZE, 100, 100).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const m = add(new THREE.Mesh(g, mat(color ?? usual)));
  if (type === "grass") scatter(2800, new THREE.ConeGeometry(0.18, 0.9, 4).translate(0, 0.45, 0), mat(color ?? usual), {});
  return m;
}

// n copies of one shape on the ground, never in water. area: [x0, z0, x1, z1].
function scatter(n, geometry, material, { area = [-94, -94, 94, 94], size = [0.7, 1.4] }) {
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
  scene.fog = new THREE.Fog(back, 320, 840);
  lights({ sun: strength, fill: soft, color });
  const ball = (r, c, x, y, z) => add(new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), new THREE.MeshBasicMaterial({ color: c, fog: false }))).position.set(x, y, z);
  if (type === "dusk") ball(28, "#ffd27a", -380, 60, -480);
  if (type !== "night") return;
  ball(18, "#f4f1dd", -300, 150, -460);
  const at = [];
  for (let i = 0; i < 900; i++) {
    const a = rnd() * 6.3, b = between(-0.2, 1.4);
    at.push(Math.cos(a) * Math.cos(b) * 640, Math.sin(b) * 640, Math.sin(a) * Math.cos(b) * 640);
  }
  add(new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(at, 3)), new THREE.PointsMaterial({ color: "#dfe6ff", size: 2.8, fog: false })));
}

/** "rain", "snow", "fog" or "clear". Call after sky. */
export function weather(type = "clear") {
  const { scene } = world();
  if (falling) scene.remove(falling.points);
  falling = null;
  if (type === "fog") scene.fog = new THREE.Fog(scene.background?.isColor ? scene.background : "#aab4c4", 160, 440);
  else if (scene.fog) { scene.fog.near = 320; scene.fog.far = 840; }
  if (type !== "rain" && type !== "snow") return;
  const snow = type === "snow", n = snow ? 5000 : 8000, at = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) at.set([between(-110, 110), between(0, 55), between(-110, 110)], i * 3);
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

// Agent Galaxy asks for the land as shapes (land.ts): corners, faces, colours and where copies stand. Data only,
// nothing of this world's code goes with it. Skies, stars, rain and the sun and moon stay home.
addEventListener("message", (e) => {
  if (e.source !== parent || e.data?.agent_page !== true || e.data.ask !== "land" || !made) return;
  const parts = [], to = (n) => (v) => Math.round(v * n) / n;
  made.scene.updateMatrixWorld(true);
  made.scene.traverseVisible((o) => {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const at = o.isMesh && o.geometry.attributes.position;
    if (!at || !m?.color || m.fog === false || at.count > 20000 || parts.length >= 300) return;
    const p = [], v = new THREE.Vector3();
    for (let i = 0; i < at.count; i++) {
      v.fromBufferAttribute(at, i);
      if (!o.isInstancedMesh) v.applyMatrix4(o.matrixWorld);
      p.push(v.x, v.y, v.z);
    }
    let copies;
    if (o.isInstancedMesh) {
      const one = new THREE.Matrix4();
      copies = [];
      for (let i = 0; i < Math.min(o.count, 3000); i++) {
        o.getMatrixAt(i, one);
        copies.push(...one.premultiply(o.matrixWorld).elements.map(to(1000)));
      }
    }
    parts.push({ p: p.map(to(100)), i: o.geometry.index ? Array.from(o.geometry.index.array) : undefined, c: "#" + m.color.getHexString(), o: m.transparent ? m.opacity : undefined, m: copies });
  });
  parent.postMessage({ agent_page_world: true, kind: "land", land: { parts } }, "*");
});
`;
