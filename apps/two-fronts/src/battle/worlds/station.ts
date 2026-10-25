// The deep-space station (the spaceport sector), for the eye only: a black starfield with a planet
// hanging outside, hull plating for a floor, bulkheads, cargo and consoles for the sim's blocks, a
// window wall down each side and lit gantries across. The deck is open to space (a containment
// field holds the air), so strikes and gunships still come down and across it.
import * as THREE from "three";
import type { instancer } from "../foliage.ts";
import { texture } from "../models.ts";
import { POST_RADIUS, type Battle, type Block } from "../sim.ts";

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const std = (color: number, roughness = 0.6, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.25, ...extra });
const glowing = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false });

// Hull plating: panels with seams and rivets, grey so a colour tints it.
export const deckMap = () => texture("station-deck", 128, 128, [1, 1], (c, r) => {
  c.fillStyle = grey(170); c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) { c.fillStyle = grey(130 + r() * 110, 0.25); c.fillRect(r() * 128, r() * 128, 1 + r() * 6, 1); }
  c.strokeStyle = grey(70, 0.9); c.lineWidth = 2; c.strokeRect(1, 1, 126, 126);
  c.strokeStyle = grey(110, 0.7); c.lineWidth = 1; c.beginPath(); c.moveTo(64, 0); c.lineTo(64, 128); c.moveTo(0, 64); c.lineTo(128, 64); c.stroke();
  c.fillStyle = grey(60);
  for (const x of [8, 56, 72, 120]) for (const y of [8, 56, 72, 120]) { c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill(); }
  c.fillStyle = grey(215, 0.5); for (let i = 0; i < 6; i++) c.fillRect(14 + i * 4, 90, 2, 22); // a grating patch
});
// Wall panels: seams, a vent and scuffs.
const panelMap = () => texture("station-panel", 128, 128, [1, 1], (c, r) => {
  c.fillStyle = grey(205); c.fillRect(0, 0, 128, 128);
  c.strokeStyle = grey(95, 0.9); c.lineWidth = 2; c.strokeRect(2, 2, 124, 124);
  c.beginPath(); c.moveTo(64, 0); c.lineTo(64, 128); c.stroke();
  c.fillStyle = grey(60); for (let i = 0; i < 5; i++) c.fillRect(14, 20 + i * 7, 36, 3);
  for (let i = 0; i < 90; i++) { c.fillStyle = grey(r() < 0.5 ? 90 : 240, 0.18); c.fillRect(r() * 128, r() * 128, 1 + r() * 10, 1 + r() * 2); }
});
// Hazard stripes, yellow and black.
const hazardMap = () => texture("station-hazard", 64, 64, [1, 1], (c) => {
  c.fillStyle = "#16181b"; c.fillRect(0, 0, 64, 64);
  c.fillStyle = "#e8b628";
  for (let i = -2; i < 6; i++) { c.beginPath(); c.moveTo(i * 16, 0); c.lineTo(i * 16 + 8, 0); c.lineTo(i * 16 + 72, 64); c.lineTo(i * 16 + 64, 64); c.fill(); }
});
// The planet outside: oceans, cloud and a few continents.
const planetMap = () => texture("station-planet", 512, 256, [1, 1], (c, r) => {
  const sea = c.createLinearGradient(0, 0, 0, 256);
  sea.addColorStop(0, "#9bb7cf"); sea.addColorStop(0.5, "#1f5f9a"); sea.addColorStop(1, "#a9c2d6");
  c.fillStyle = sea; c.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 26; i++) { c.fillStyle = r() < 0.5 ? "#6f8c4a" : "#b59a62"; c.beginPath(); c.ellipse(r() * 512, 50 + r() * 150, 14 + r() * 40, 8 + r() * 22, r() * 3, 0, 7); c.fill(); }
  for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(255,255,255,${0.12 + r() * 0.25})`; c.beginPath(); c.ellipse(r() * 512, r() * 256, 10 + r() * 40, 2 + r() * 6, (r() - 0.5) * 0.3, 0, 7); c.fill(); }
});

// The sky: stars on a sphere that follows the camera, and the planet, with a thin glow of air.
export function stationSky(scene: THREE.Scene, r: () => number) {
  const stars = new THREE.Group();
  for (const [count, size] of [[1700, 1.5], [220, 2.6]] as const) {
    const pos: number[] = [], cols: number[] = [], c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const y = r() * 2 - 1, a = r() * Math.PI * 2, rad = Math.sqrt(1 - y * y);
      pos.push(Math.cos(a) * rad * 850, y * 850, Math.sin(a) * rad * 850);
      c.setHSL(r() < 0.7 ? 0.6 : 0.08, 0.5 * r(), 0.55 + r() * 0.45);
      cols.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
    pts.renderOrder = -2;
    pts.frustumCulled = false;
    stars.add(pts);
  }
  scene.add(stars);
  const planet = new THREE.Group();
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), new THREE.MeshStandardMaterial({ map: planetMap(), roughness: 1, fog: false, emissive: 0x0a1a30, depthWrite: false })));
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(312, 48, 24), new THREE.MeshBasicMaterial({ color: 0x4aa0ff, fog: false, transparent: true, opacity: 0.22, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })));
  planet.children.forEach((m) => (m.renderOrder = -1));
  planet.rotation.set(0.3, 1, 0.1);
  scene.add(planet);
  return { sky: stars, giant: planet };
}

// A box whose texture tiles every `tile` units, whatever its size; sitting on y = 0.
function panelBox(w: number, h: number, d: number, tile = 4) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute, faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] as const;
  for (let i = 0; i < uv.count; i++) { const [a, c] = faces[Math.floor(i / 4)]!; uv.setXY(i, uv.getX(i) * a / tile, uv.getY(i) * c / tile); }
  return g;
}

interface Ctx {
  scene: THREE.Scene;
  b: Battle;
  r: () => number;
  inst: ReturnType<typeof instancer>["inst"];
  put: ReturnType<typeof instancer>["put"];
  done: ReturnType<typeof instancer>["done"];
  trail: { x: number; z: number }[];
  shiftAt(z: number): number;
}

// The deck's floor mesh, plated and a little way past the edge of the field; the sim's plain is flat.
export function deckFloor(b: Battle) {
  const size = b.half * 2 + 30, g = new THREE.PlaneGeometry(size, size, 96, 96).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 6, uv.getY(i) * size / 6);
  return g;
}
export const deckMaterial = () => std(0xffffff, 0.55, { vertexColors: true, map: deckMap(), metalness: 0.35 });

const gap = (k: Block, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - k.x) - k.w / 2), Math.max(0, Math.abs(z - k.z) - k.d / 2));

// Everything solid on the deck that isn't the floor: the blocks dressed as bulkheads, crates and
// consoles, the hull rim with its windows, the gantries and the floor markings. Returns the per-frame light pulse.
export function buildStation({ scene, b, r, inst, put, done, trail, shiftAt }: Ctx) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), k = new THREE.Vector3(), col = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const place = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => m.compose(p.set(x, y, z), q.setFromAxisAngle(UP, ry), k.set(sx, sy, sz));
  const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const hull = std(0x8792a0, 0.55, { map: panelMap() }), hazard = std(0xffffff, 0.7, { map: hazardMap() });
  const cargo = [0x9a5a3a, 0x3d6a8a, 0x8a8a52, 0x6f7c88].map((c) => std(c, 0.6, { map: panelMap() }));
  const consoleMat = std(0x2b323a, 0.5), trim = std(0x1d2228, 0.7);
  const unit = new THREE.BoxGeometry(1, 1, 1);

  // --- The blocks ---
  const tall = b.blocks.filter((o) => !o.kind && o.h >= 1.6), screens: Block[] = [];
  for (const o of b.blocks) {
    if (o.kind === "crate") solid(panelBox(o.w, o.h, o.d, 3), cargo[Math.floor(r() * cargo.length)]!, o.x, 0, o.z);
    else if (o.kind === "console") { solid(panelBox(o.w, o.h, o.d, 3), consoleMat, o.x, 0, o.z); screens.push(o); }
    else if (o.h < 1.6) solid(panelBox(o.w, o.h, o.d, 1.6), hazard, o.x, 0, o.z);
    else solid(panelBox(o.w, o.h, o.d), hull, o.x, 0, o.z);
  }
  // Light on the screens of the consoles, a strip along the top of every wall, and a lit frame at each doorway.
  const screen = inst(unit, glowing(0x6ad8ff), screens.length);
  for (const o of screens) put(screen, place(o.x, o.h + 0.03, o.z, o.w * 0.8, 0.06, o.d * 0.5));
  const strips = inst(unit, glowing(0xdff2ff), tall.length * 2), frames = inst(unit, glowing(0xffb040), tall.length * 4);
  for (const o of tall) {
    const along = o.w >= o.d, wall = along ? o.d < 3 : o.w < 3;
    for (const side of [-1, 1]) {
      if (along) put(strips, place(o.x, o.h - 0.5, o.z + side * (o.d / 2 + 0.03), o.w - 1, 0.18, 0.06));
      else put(strips, place(o.x + side * (o.w / 2 + 0.03), o.h - 0.5, o.z, 0.06, 0.18, o.d - 1));
    }
    if (wall) for (const end of [-1, 1]) for (const side of [-1, 1]) {
      const x = along ? o.x + end * (o.w / 2 - 0.1) : o.x + side * (o.w / 2 + 0.03), z = along ? o.z + side * (o.d / 2 + 0.03) : o.z + end * (o.d / 2 - 0.1);
      put(frames, place(x, o.h / 2, z, 0.3, o.h, 0.3));
    }
    if (o.h >= 7 && o.w >= 20) solid(unit, glowing(0x7fe0ff), o.x, o.h * 0.65, o.z + o.d / 2 + 0.05).scale.set(o.w * 0.8, 1.6, 0.1); // the command deck's windows
  }
  done(screen, strips, frames);

  // --- The hull rim: a plated margin past the field, a slab under it, a window wall down each side ---
  const edge = b.half + 14, long = edge * 2 + 4;
  solid(new THREE.BoxGeometry(long + 6, 4, long + 6), trim, 0, -2.1, 0).castShadow = false;
  for (const s of [-1, 1]) {
    solid(new THREE.BoxGeometry(1.4, 1.4, long), hull, s * edge, 0.7, 0);          // the sill
    solid(new THREE.BoxGeometry(1.6, 1.6, long), hull, s * edge, 12.5, 0);          // the lintel
    solid(new THREE.BoxGeometry(long, 1.1, 1.2), hull, 0, 0.55, s * edge); // a low rail across each end
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(long, 10.4), glowing(0x6ab0ff, 0.07));
    glass.rotation.y = Math.PI / 2;
    glass.position.set(s * edge, 6.9, 0);
    scene.add(glass);
  }
  const posts = inst(unit, hull, 80, true), glow = inst(unit, glowing(0x5ad0ff), 4), pillar = (x: number, z: number, h: number) => put(posts, place(x, h / 2, z, 1.6, h, 1.6));
  for (const s of [-1, 1]) for (let z = -edge; z <= edge + 0.1; z += 24) pillar(s * edge, z, 13);
  for (const s of [-1, 1]) { put(glow, place(s * edge, 1.45, 0, 0.3, 0.08, long)); put(glow, place(0, 1.15, s * edge, long, 0.08, 0.3)); }
  // Gantries across the deck, lit from below.
  const rows = [0, ...[66, 132, 198].filter((z) => z < b.half - 20).flatMap((z) => [z, -z])];
  const lamps = inst(unit, glowing(0xe6f4ff), rows.length);
  for (const z of rows) {
    solid(new THREE.BoxGeometry(long, 1.1, 1.4), hull, 0, 22, z);
    put(lamps, place(0, 21.35, z, long - 8, 0.14, 0.7));
    for (const s of [-1, 1]) pillar(s * edge, z, 22);
  }
  done(posts, glow, lamps);

  // --- The floor's markings: a hazard ring round every post, and the lane worn between them in amber dashes ---
  const ringGeo = new THREE.RingGeometry(POST_RADIUS + 0.3, POST_RADIUS + 1.5, 64).rotateX(-Math.PI / 2);
  const ruv = ringGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * 14, ruv.getY(i) * 14);
  const ringMat = new THREE.MeshBasicMaterial({ map: hazardMap(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  for (const post of b.posts) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(post.x, 0.03, post.z);
    scene.add(ring);
  }
  const dashes = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe0b030, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 400, false, false);
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]!, c = trail[i]!, len = Math.hypot(c.x - a.x, c.z - a.z), yaw = Math.atan2(-(c.z - a.z), c.x - a.x);
    for (let d = 3; d < len - 3; d += 7) {
      const t = d / len, x = a.x + (c.x - a.x) * t + shiftAt(a.z + (c.z - a.z) * t), z = a.z + (c.z - a.z) * t;
      if (b.blocks.some((o) => gap(o, x, z) < 2.5) || b.posts.some((o) => Math.hypot(o.x - x, o.z - z) < POST_RADIUS + 3)) continue;
      put(dashes, place(x, 0.03, z, 3.2, 1, 0.45, yaw));
    }
  }
  done(dashes);

  // Cold panel light over the lane and a coloured glow at the pads and the keep, kept to a few lights.
  const spots: [{ x: number; z: number }, number][] = [[b.posts[0]!, 0x40e0d0], [b.posts[1]!, 0xffa030], [b.posts[2]!, 0xffa030], [b.posts.at(-1)!, 0xbfe0ff]];
  const lights = spots.map(([post, color]) => {
    const light = new THREE.PointLight(color, 0, 70, 1.4);
    light.position.set(post.x, 11, post.z);
    scene.add(light);
    return light;
  });
  return (t: number) => lights.forEach((light, i) => (light.intensity = 320 * (0.85 + 0.15 * Math.sin(t * 1.3 + i))));
}
