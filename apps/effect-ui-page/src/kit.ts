// `@world/kit`: what a world imports so it doesn't have to write the same three.js every time. The source is a string:
// world.ts puts it in the frame's import map as a data: URL, so it runs sealed like the world's own code. One call
// each for the scene and camera, ground, sky, weather, water, trees, cactus, rocks, lights, and where a visitor is
// walking (the page's `{ agent_page: true, player }` message). A world never draws the player.
// The building blocks (box, voxels, sprite, building, streets, path, sign, creature, near, block) are one call each,
// so a world an AI imagines is about 30 lines. Each is ordinary meshes in the kit's scene, sized by SIZE (never a
// fixed plot size), so whatever hands the scene's shapes on carries them too. Things drawn as text (voxels, sprites,
// a sign's letters) are cubes, one mesh a colour. `block` keeps a 32 by 32 grid of where nobody can stand and posts it
// to the page (`{ agent_page_world: true, kind: "solid", grid }`); buildings and tall boxes mark their own.

import { DAY, PLOT } from "./land.ts";

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
/** Grass tufts and flowers, n of them, with { area, size, color }. */
export const grass = (n = 2000, o = {}) => scatter(n, new THREE.ConeGeometry(0.22, 1.1, 4).translate(0, 0.45, 0), mat(o.color ?? "#74a83c"), o);
export function flowers(n = 300, { colors = ["#ffd24a", "#ff7fa8", "#fff4e0", "#b58cff", "#ff8a3d"], ...o } = {}) {
  for (const c of colors) scatter(Math.ceil(n / colors.length), new THREE.IcosahedronGeometry(0.38).translate(0, 0.8, 0), mat(c, { emissive: c, emissiveIntensity: 0.3 }), o);
}

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
// The air Agent Galaxy gives your land for each sky (land.ts's Mood): what a visitor stands in there.
const AIR = {
  day: ${JSON.stringify(DAY)},
  dusk: { top: "#4f86c9", low: "#ffd9a0", fog: "#f1cfa0", near: 130, far: 560, sun: "#ffcf90", power: 2.1, sky: "#bcd8ff", dirt: "#6b5a36", fill: 0.9, bloom: 0.45, weather: "clear" },
  night: { top: "#0b0824", low: "#4a1f6b", fog: "#24164a", near: 90, far: 480, sun: "#a48cff", power: 1, sky: "#8d6fe0", dirt: "#2a1640", fill: 1.1, bloom: 0.85, weather: "clear" },
};
let air = null, dark = null;
const chimneys = [];
let flying = false;
const hex = (v, or) => (typeof v === "string" ? "#" + new THREE.Color(v).getHexString() : or);
const within = (v, lo, hi, or) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : or);
const brightness = (v) => { const c = new THREE.Color(v); return c.r + c.g + c.b; };

/** "day", "night" (stars and a moon) or "dusk". */
export function sky(type = "day") {
  const { scene } = world();
  const [back, strength, soft, color] = SKIES[type] ?? SKIES.day;
  scene.background = new THREE.Color(back);
  scene.fog = new THREE.Fog(back, 320, 840);
  lights({ sun: strength, fill: soft, color });
  air = { ...(AIR[type] ?? AIR.day), weather: air?.weather ?? "clear" };
  dark = type === "night" || type === "dusk";
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

const FALLS = {
  rain: { n: 8000, speed: 42, drift: 0, color: "#a9c4ff", size: 0.3 },
  snow: { n: 5000, speed: 6, drift: 2, color: "#ffffff", size: 0.6 },
  fireflies: { n: 240, speed: 0, drift: 3, color: "#ffe28a", size: 1.1 },
};
/** "rain", "snow", "fireflies", "fog" or "clear". Call after sky. */
export function weather(type = "clear") {
  const { scene } = world();
  if (falling) scene.remove(falling.points);
  falling = null;
  if (type === "fog") scene.fog = new THREE.Fog(scene.background?.isColor ? scene.background : air?.low ?? "#aab4c4", 160, 440);
  else if (scene.fog) { scene.fog.near = 320; scene.fog.far = 840; }
  air = { ...(air ?? AIR.day), weather: FALLS[type] ? type : "clear" };
  if (type === "fog") Object.assign(air, { near: 50, far: 260 });
  const f = FALLS[type];
  if (!f) return;
  const at = new Float32Array(f.n * 3), high = f.speed ? 55 : 10;
  for (let i = 0; i < f.n; i++) at.set([between(-98, 98), between(0.5, high), between(-98, 98)], i * 3);
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(at, 3));
  falling = { at, ...f, points: add(new THREE.Points(g, new THREE.PointsMaterial({ color: f.color, size: f.size, transparent: true, opacity: 0.8 }))) };
}
every((t, dt) => {
  if (!falling) return;
  const { at, speed, drift, points } = falling;
  for (let i = 0; i < at.length; i += 3) {
    at[i] += Math.sin(t + i) * drift * dt;
    at[i + 1] -= speed * dt;
    if (!speed) at[i + 2] += Math.cos(t * 0.7 + i) * drift * dt;
    else if (at[i + 1] < 0) at[i + 1] += 55;
  }
  points.geometry.attributes.position.needsUpdate = true;
});

/** Your land's own air, here and in Agent Galaxy: { top, low (the sky, up and at the horizon), fog, near, far, sun,
 *  power, fill, bloom }. Call after sky and weather. */
export function mood(o = {}) {
  const { scene } = world(), was = air ?? AIR.day;
  air = { ...was };
  for (const k of ["top", "low", "fog", "sun", "sky", "dirt"]) air[k] = hex(o[k], was[k]);
  for (const [k, lo, hi] of [["near", 40, 800], ["far", 200, 1500], ["power", 0, 4], ["fill", 0, 3], ["bloom", 0, 1.2]]) air[k] = within(o[k], lo, hi, was[k]);
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const g = c.getContext("2d"), down = g.createLinearGradient(0, 0, 0, 256);
  down.addColorStop(0, air.top); down.addColorStop(1, air.low);
  g.fillStyle = down; g.fillRect(0, 0, 2, 256);
  scene.background = new THREE.CanvasTexture(c);
  scene.background.colorSpace = THREE.SRGBColorSpace;
  scene.fog = new THREE.Fog(air.fog, 320, 840);
  lights({ sun: air.power * 0.8, fill: air.fill, color: air.sun });
  dark = brightness(air.top) < 0.5 || (dark === true && brightness(air.top) < 1);
}

// Moving things stay home (land.ts carries still shapes): Agent Galaxy draws its own smoke and cars from the mood.
const live = (o) => { o.traverse((c) => (c.userData.live = true)); return add(o); };
/** Chimney smoke rising from x, y, z (y above the ground there). */
export function smoke(x = 0, y = 10, z = 0) {
  const at = { x: within(x, -SIZE / 2, SIZE / 2, 0), y: within(height(x, z) + y, 0, 120, 10), z: within(z, -SIZE / 2, SIZE / 2, 0) };
  if (chimneys.length >= 12) return;
  chimneys.push(at);
  const puff = new THREE.MeshStandardMaterial({ color: "#f3ead9", transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 6; i++) {
    const m = live(new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 1), puff));
    every((t) => {
      const k = (i / 6 + t * 0.12) % 1;
      m.position.set(at.x + k * 3, at.y + k * 9, at.z);
      m.scale.setScalar(0.6 + k * 1.8);
    });
  }
}
/** n little flying cars crossing over the plot. */
export function flyers(n = 6) {
  flying = true;
  for (let i = 0; i < Math.min(12, n); i++) {
    const car = new THREE.Group(), part = (w, h, d, color, at) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, { emissive: color, emissiveIntensity: 0.8 })); m.position.x = at; car.add(m); };
    part(5, 1.2, 2.2, "#5a4f8a", 0); part(0.4, 0.5, 1.8, "#dff6ff", 2.6); part(4, 0.2, 0.3, "#ff3b5c", -4);
    live(car);
    const way = i % 2 ? 1 : -1, speed = between(10, 22), from = between(0, 180), z = -70 + (i * 37) % 140;
    every((t) => {
      car.position.set(((((from + t * speed) % 180) + 180) % 180 - 90) * way, 36 + (i % 3) * 12, z);
      car.rotation.y = way > 0 ? 0 : Math.PI;
    });
  }
}

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

// ---------- building blocks: each one call, ordinary meshes in the kit's scene ----------

const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const onGround = (x, z, y) => (typeof y === "number" ? y : height(x, z));
// One letter (or digit) a cube or a pixel; "." and " " are empty.
const colours = (palette) => Object.fromEntries(Object.entries(palette ?? {}).filter(([k]) => k.length === 1 && k !== "." && k !== " "));
// Cubes of one colour as one mesh in group g: each spot is [x, y, z, w, h, d], standing on y.
function cubes(g, color, spots, material = mat(color)) {
  if (!spots.length) return;
  const m = new THREE.InstancedMesh(BOX, material, spots.length), o = new THREE.Object3D();
  spots.forEach(([x, y, z, w, h, d], n) => { o.position.set(x, y, z); o.scale.set(w, h, d); o.updateMatrix(); m.setMatrixAt(n, o.matrix); });
  g.add(m);
}

const N = 32, CELL = SIZE / N, solid = new Uint8Array(N * N);
const cellOf = (v) => Math.max(0, Math.min(N - 1, Math.floor((v + SIZE / 2) / CELL)));
const blocked = (x, z) => Math.abs(x) >= SIZE / 2 || Math.abs(z) >= SIZE / 2 || solid[cellOf(z) * N + cellOf(x)] === 1;
let solidDue = 0;
/** Nobody walks into the w by d rectangle around x, z (a 32 by 32 grid, posted to the page). Buildings and tall boxes do this themselves. */
export function block(x, z, w = CELL, d = CELL) {
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cx = -SIZE / 2 + (i + 0.5) * CELL, cz = -SIZE / 2 + (j + 0.5) * CELL;
    if (Math.abs(cx - x) <= w / 2 && Math.abs(cz - z) <= d / 2) solid[j * N + i] = 1;
  }
  solid[cellOf(z) * N + cellOf(x)] = 1;
  solidDue ||= setTimeout(() => {
    solidDue = 0;
    // The middle of each edge stays open, so nobody can wall a neighbour out.
    for (let i = 12; i < 20; i++) for (const j of [0, 1, N - 2, N - 1]) { solid[j * N + i] = 0; solid[i * N + j] = 0; }
    try { parent.postMessage({ agent_page_world: true, kind: "solid", grid: Array.from(solid).join("") }, "*"); } catch {}
  }, 30);
}

// glow: 0 for none, 1 to 3 for a light that blooms in the dark.
const lit = (color, glow) => (glow ? mat(color, { emissive: color, emissiveIntensity: glow }) : mat(color));

/** A box standing at x, z (on the ground unless y is given). Blocks the way when 2 or more tall. */
export function box({ x = 0, y, z = 0, w = 4, h = 4, d = 4, color = "#b08d63", glow = 0 } = {}) {
  const m = add(new THREE.Mesh(BOX, lit(color, glow)));
  m.scale.set(w, h, d);
  m.position.set(x, onGround(x, z, y), z);
  if (h >= 2 && typeof y !== "number") block(x, z, w, d);
  return m;
}

/** A thing drawn as text: layers from the bottom up, each rows north to south, one letter a cube west to east, coloured by palette. */
export function voxels(layers, palette, { x = 0, y, z = 0, size = 1, block: stops = true, glow = 0 } = {}) {
  const g = new THREE.Group(), pal = colours(palette), at = {};
  const rows = Math.max(1, ...layers.map((l) => l.length)), cols = Math.max(1, ...layers.flatMap((l) => l.map((r) => r.length)));
  layers.forEach((layer, k) => layer.forEach((row, j) => [...row].forEach((ch, i) => {
    if (pal[ch]) (at[ch] ??= []).push([(i - (cols - 1) / 2) * size, k * size, (j - (rows - 1) / 2) * size, size, size, size]);
  })));
  for (const [ch, spots] of Object.entries(at)) cubes(g, pal[ch], spots, lit(pal[ch], glow));
  g.position.set(x, onGround(x, z, y), z);
  if (stops && layers.length * size >= 2 && typeof y !== "number") block(x, z, cols * size, rows * size);
  return add(g);
}

/** A pixel picture standing up, turning to face the camera: text rows, one letter a pixel. Two sets of rows animate. */
export function sprite(rows, palette, { x = 0, y, z = 0, size = 0.5, fps = 3 } = {}) {
  const sets = (Array.isArray(rows[0]) ? rows : [rows]).slice(0, 2), pal = colours(palette), g = new THREE.Group();
  const shown = sets.map((set) => {
    const f = new THREE.Group(), at = {}, cols = Math.max(1, ...set.map((r) => r.length));
    set.forEach((row, j) => [...row].forEach((ch, i) => {
      if (pal[ch]) (at[ch] ??= []).push([(i - (cols - 1) / 2) * size, (set.length - 1 - j) * size, 0, size, size, size * 0.4]);
    }));
    for (const [ch, spots] of Object.entries(at)) cubes(f, pal[ch], spots);
    g.add(f);
    return f;
  });
  shown.forEach((f, n) => (f.visible = n === 0));
  g.position.set(x, onGround(x, z, y), z);
  every((t) => {
    const c = world().camera.position;
    g.rotation.y = Math.atan2(c.x - g.position.x, c.z - g.position.z);
    shown.forEach((f, n) => (f.visible = n === Math.floor(t * fps) % shown.length));
  });
  return add(g);
}

const BUILT = ["#e9d9b4", "#c96f4a", "#5b8fb0", "#d9b44a", "#9fb59a", "#b98fb0"];
const LIT = mat("#9fb4c8", { emissive: "#ffcf6a", emissiveIntensity: 0 }), UNLIT = mat("#5c6878");
/** A building on the ground: windows that light up under a night or dusk sky, roof "peak" or "flat". Blocks its footprint. */
export function building({ x = 0, z = 0, w = 12, d = 10, h = 10, color, windows = true, roof = "peak", roofColor = "#8c3b2e" } = {}) {
  const g = new THREE.Group(), body = new THREE.Mesh(BOX, mat(color ?? BUILT[Math.floor(rnd() * BUILT.length)]));
  body.scale.set(w, h, d);
  const top = roof === "flat" ? new THREE.Mesh(BOX, mat(roofColor))
    : new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), mat(roofColor));
  if (roof === "flat") top.scale.set(w + 0.6, 0.6, d + 0.6); else top.scale.set(w * 1.1, Math.min(w, d) * 0.55, d * 1.1);
  top.position.y = h;
  g.add(body, top);
  if (windows) {
    // A pane on each side, a floor every 3.5 units, seven in ten lit.
    const on = [], off = [];
    for (let y = 2; y + 1.6 <= h - 0.5; y += 3.5) {
      for (let n = Math.max(1, Math.floor((w - 1) / 3)), c = 0; c < n; c++) for (const s of [1, -1]) (rnd() < 0.7 ? on : off).push([-w / 2 + (c + 0.5) * (w / n), y, (s * d) / 2, 1.3, 1.6, 0.2]);
      for (let n = Math.max(1, Math.floor((d - 1) / 3)), c = 0; c < n; c++) for (const s of [1, -1]) (rnd() < 0.7 ? on : off).push([(s * w) / 2, y, -d / 2 + (c + 0.5) * (d / n), 0.2, 1.6, 1.3]);
    }
    // windows may be a colour: this building's own light.
    cubes(g, null, on, typeof windows === "string" ? glazed(windows) : LIT);
    cubes(g, null, off, UNLIT);
  }
  g.position.set(x, height(x, z), z);
  block(x, z, w, d);
  return add(g);
}
const tinted = new Map();
const glazed = (color) => {
  if (!tinted.has(color)) tinted.set(color, mat("#9fb4c8", { emissive: color, emissiveIntensity: 0 }));
  return tinted.get(color);
};
// Windows glow when the sky is dark: as sky() or mood() said, else whatever the background was set to.
function windowsOn() {
  const b = made?.scene.background;
  const on = dark ?? Boolean(b?.isColor && b.r + b.g + b.b < 1.2);
  LIT.emissiveIntensity = on ? 1.3 : 0;
  // A building's own colour is bright already: less, so it stays that colour.
  for (const m of tinted.values()) m.emissiveIntensity = on ? 0.75 : 0;
}
every(windowsOn);

const slab = (x, z, w, d, color, t = 0.12, turn = 0) => {
  const m = add(new THREE.Mesh(BOX, mat(color)));
  m.scale.set(w, t, d);
  m.position.set(x, height(x, z), z);
  m.rotation.y = turn;
  return m;
};
/** A crossroads through the middle that stops short of the edges (nothing sits between neighbours): two blocks by two.
 *  Returns the four blocks as { x, z, w, d } to build on. For flat ground. */
export function streets({ width = SIZE / 10, color = "#4a4c56", line = "#e8d58a" } = {}) {
  const run = SIZE * 0.88, half = width / 2, dash = SIZE / 40;
  slab(0, 0, width, run, color); slab(0, 0, run, width, color);
  for (let t = -run / 2 + dash; t < run / 2 - dash; t += dash * 2.4) if (Math.abs(t) > half + dash) { slab(t, 0, dash, 0.5, line, 0.16); slab(0, t, 0.5, dash, line, 0.16); }
  const side = (SIZE / 2 + half) / 2, w = SIZE / 2 - half - SIZE * 0.06;
  return [-1, 1].flatMap((i) => [-1, 1].map((j) => ({ x: i * side, z: j * side, w, d: w })));
}
/** A path through points [[x, z], ...], { width, color }. */
export function path(points, { width = 3, color = "#c8b48a" } = {}) {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    slab((ax + bx) / 2, (az + bz) / 2, Math.hypot(bx - ax, bz - az) + width, width, color, 0.1, -Math.atan2(bz - az, bx - ax));
  }
}

// 3 by 5 pixel letters: each is its character, then 15 bits from the top row down.
const FONT = Object.fromEntries(("A010101111101101 B110101110101110 C011100100100011 D110101101101110 E111100110100111 F111100110100100 G011100101101011 " +
  "H101101111101101 I111010010010111 J001001001101010 K101101110101101 L100100100100111 M101111111101101 N110101101101101 O010101101101010 " +
  "P110101110100100 Q010101101110011 R110101110101101 S011100010001110 T111010010010010 U101101101101111 V101101101101010 W101101111111101 " +
  "X101101010101101 Y101101010010010 Z111001010100111 0111101101101111 1010110010010111 2110001010100111 3110001010001110 4101101111001001 " +
  "5111100110001110 6011100111101111 7111001010010010 8111101111101111 9111101111001110 .000000000000010 ,000000000010100 !010010010000010 " +
  "?110001010000010 '010010000000000 -000000111000000 :000010000010000 /001001010100100").split(" ").map((s) => [s[0], s.slice(1)]));

/** A wooden sign with pixel letters (A to Z, 0 to 9, . , ! ? ' - : /, "\\n" a new line, 60 at most), facing south unless turned (radians). */
export function sign(text, { x = 0, z = 0, size = 0.45, turn = 0, board = "#8a5a33", ink = "#fff4e0", glow = 0 } = {}) {
  const lines = String(text).slice(0, 60).toUpperCase().split("\\n").slice(0, 4).map((l) => l.slice(0, 24));
  const cols = Math.max(1, ...lines.map((l) => l.length)), W = (cols * 4 + 3) * size, B = (lines.length * 6 + 3) * size, leg = 6 * size;
  const g = new THREE.Group(), letters = [];
  cubes(g, "#4b2e18", [[-W / 2 + 2.5 * size, 0, 0, 2 * size, leg, 2 * size], [W / 2 - 2.5 * size, 0, 0, 2 * size, leg, 2 * size]]);
  cubes(g, board, [[0, leg, 0, W, B, size]]);
  // Each lit pixel on both faces, the back one mirrored, so it reads from either side.
  lines.forEach((line, l) => [...line].forEach((ch, i) => {
    const bits = FONT[ch];
    if (bits) for (let b = 0; b < 15; b++) if (bits[b] === "1") {
      const px = -W / 2 + (2 + i * 4 + (b % 3) + 0.5) * size, py = leg + B - (2 + l * 6 + Math.floor(b / 3) + 1) * size;
      letters.push([px, py, size * 0.55, size, size, size * 0.2], [-px, py, -size * 0.55, size, size, size * 0.2]);
    }
  }));
  cubes(g, ink, letters, lit(ink, glow));
  g.position.set(x, height(x, z), z);
  g.rotation.y = turn;
  return add(g);
}

// Where the visitor is on this plot, in world units, or null: for creatures and near().
let viewer = null;
addEventListener("message", (e) => {
  if (e.source !== parent || e.data?.agent_page !== true || !("player" in e.data)) return;
  const p = e.data.player;
  viewer = typeof p?.x === "number" && typeof p?.z === "number" ? { x: (p.x - 0.5) * SIZE, z: (p.z - 0.5) * SIZE } : null;
});

/** Something alive on the ground: { sprite: rows, palette } or { voxels: layers, palette }, in area [x0, z0, x1, z1].
 *  wander: roams; flee: runs from the visitor this close; follow: comes to the visitor this close. */
export function creature({ sprite: rows, voxels: layers, palette, size, x, z, area = [-0.4 * SIZE, -0.4 * SIZE, 0.4 * SIZE, 0.4 * SIZE], speed = 6, wander = true, flee = 0, follow = 0 } = {}) {
  let s = Math.floor(rnd() * 2147483646) + 1;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = () => [area[0] + r() * (area[2] - area[0]), area[1] + r() * (area[3] - area[1])];
  const [x0, z0] = typeof x === "number" && typeof z === "number" ? [x, z] : pick();
  const body = layers ? voxels(layers, palette, { x: x0, z: z0, size: size ?? 0.6, block: false }) : sprite(rows ?? ["#"], palette ?? { "#": "#ffffff" }, { x: x0, z: z0, size: size ?? 0.5 });
  const me = { x: x0, z: z0 };
  let to = pick(), rest = 0;
  every((t, dt) => {
    const d = viewer ? Math.hypot(viewer.x - me.x, viewer.z - me.z) : Infinity;
    let gx = to[0] - me.x, gz = to[1] - me.z, v = speed;
    if (flee && d < flee) { gx = me.x - viewer.x; gz = me.z - viewer.z; v = speed * 1.8; }
    else if (follow && d < follow) { if (d < 4) return; gx = viewer.x - me.x; gz = viewer.z - me.z; }
    else if (!wander) return;
    else if (Math.hypot(gx, gz) < 1) { if ((rest -= dt) > 0) return; rest = 0.5 + r() * 2; to = pick(); return; }
    const l = Math.hypot(gx, gz) || 1, nx = me.x + (gx / l) * v * dt, nz = me.z + (gz / l) * v * dt;
    if (blocked(nx, nz) || nx < area[0] - 8 || nx > area[2] + 8 || nz < area[1] - 8 || nz > area[3] + 8) { to = pick(); return; }
    me.x = nx; me.z = nz;
    body.position.set(nx, height(nx, nz) + Math.abs(Math.sin(t * 12)) * 0.3, nz);
    if (layers) body.rotation.y = Math.atan2(gx, gz);
  });
  return body;
}

/** onEnter() when the visitor walks within radius of x, z; onLeave() when they walk away. */
export function near(x, z, radius, onEnter, onLeave) {
  let inside = false;
  every(() => {
    const now = viewer !== null && Math.hypot(viewer.x - x, viewer.z - z) <= radius;
    if (now !== inside) { inside = now; (now ? onEnter : onLeave)?.(); }
  });
}

// Agent Galaxy asks for the land as shapes (land.ts): corners, faces, colours, glow and where copies stand, with the
// land's mood. Data only, nothing of this world's code goes with it. Stars, falling rain, the sun and moon, moving
// smoke and cars stay home: the galaxy draws its own from the mood. Shapes of one colour are merged into one (s), so a
// busy land stays a few dozen draws; a mesh as wide as the plot (its ground) stays itself.
const MERGE = 20000;
function land() {
  made.scene.updateMatrixWorld(true);
  windowsOn();
  const parts = [], merged = new Map(), to = (n) => (v) => Math.round(v * n) / n;
  made.scene.traverseVisible((o) => {
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const at = o.isMesh && !o.userData.live && o.geometry.attributes.position;
    if (!at || !m?.color || m.fog === false || at.count > MERGE) return;
    const e = m.emissive, glows = m.isMeshBasicMaterial ? 1.2 : e && m.emissiveIntensity >= 0.3 && e.r + e.g + e.b > 0 ? Math.min(4, m.emissiveIntensity) : 0;
    const look = { c: "#" + (glows && e ? e : m.color).getHexString(), o: m.transparent ? m.opacity : undefined, e: glows || undefined };
    const index = o.geometry.index?.array, count = o.isInstancedMesh ? o.count : 1, one = new THREE.Matrix4(), v = new THREE.Vector3();
    const own = () => {
      const p = [];
      for (let i = 0; i < at.count; i++) { v.fromBufferAttribute(at, i).applyMatrix4(o.matrixWorld); p.push(v.x, v.y, v.z); }
      parts.push({ p: p.map(to(100)), i: index ? Array.from(index) : undefined, ...look });
    };
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const box = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const wide = !o.isInstancedMesh && Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) >= SIZE * 0.45;
    const key = look.c + look.o + look.e, corners = index ? index.length : at.count;
    // Copies of one shape in one look (every lit window) join into one part, 3000 copies at most.
    if (o.isInstancedMesh) {
      for (let n = 0; n < count; n++) {
        let into = merged.get(key + o.geometry.uuid);
        if (!into || into.m.length >= 48000) {
          const p = [];
          for (let i = 0; i < at.count; i++) p.push(...[at.getX(i), at.getY(i), at.getZ(i)].map(to(100)));
          into = { p, i: index ? Array.from(index) : undefined, ...look, m: [] };
          merged.set(key + o.geometry.uuid, into);
          parts.push(into);
        }
        o.getMatrixAt(n, one);
        into.m.push(...one.premultiply(o.matrixWorld).elements.map(to(1000)));
      }
      return;
    }
    if (wide) return own();
    {
      one.copy(o.matrixWorld);
      let into = merged.get(key);
      if (!into || into.p.length / 3 + at.count > MERGE || into.i.length + corners > 100000) {
        into = { p: [], i: [], ...look, s: true };
        merged.set(key, into);
        parts.push(into);
      }
      const base = into.p.length / 3;
      for (let i = 0; i < at.count; i++) { v.fromBufferAttribute(at, i).applyMatrix4(one); into.p.push(...[v.x, v.y, v.z].map(to(100))); }
      for (let i = 0; i < corners; i++) into.i.push(base + (index ? index[i] : i));
    }
  });
  return { parts: parts.slice(0, 300), mood: air ? { ...air, smoke: chimneys, cars: flying } : undefined };
}
addEventListener("message", (e) => {
  if (e.source !== parent || e.data?.agent_page !== true || e.data.ask !== "land" || !made) return;
  parent.postMessage({ agent_page_world: true, kind: "land", land: land() }, "*");
});
`;
