// What stands outside a regional arena's ring and says where you are: a set piece per playable region (a ruined
// farmhouse in the Pine Barrens, a boarded mine in the hollows, a lighthouse on the Great Lakes), the region's own
// horizon (mesas, ridges, a flat lake line), its light and air (the desert's gold noon, the rainforest's grey
// drizzle), and something small that moves (fireflies on the bayou, fog drifting through the cedars). And one running
// joke a region: the Bureau's black van parked badly, a trail camera somebody left, a sign that has given up.
//
// The fight camera looks across the ring toward +x (the lake), so the set piece stands out there, past the lake,
// with smaller pieces round the sides. Nothing comes inside the ring or between the camera and the fighters.
// Everything is made here from boxes, cylinders and a few canvas textures; no models to load.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

/** A region's air and light: where the sun is and its colour, the fog's reach, the sky fill's strength. */
export interface Mood { sun: [number, number, number]; sunColour: number; sunPower: number; fog: [number, number]; fill: number; haze?: number }
/** The horizon's shape: rolling hills, sharp ridges, flat-topped mesas, a flat line (a lake, a prairie) or a wall of trees. */
export type Horizon = "hills" | "ridges" | "mesas" | "flat" | "treeline";

export interface RegionSet { horizon: Horizon; mood: Mood; build: (g: THREE.Group, R: number) => ((t: number) => void) | void }

const mat = (color: number, rough = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, ...extra });
function box(g: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, rz = 0, rx = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
function cyl(g: THREE.Object3D, r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 10, rz = 0, ry = 0) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, seg), m);
  o.position.set(x, y, z); o.rotation.set(0, ry, rz); o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
/** A pitched roof: a prism `w` wide (its ridge along x), `d` deep, `h` high, its underside at y. */
function roof(g: THREE.Object3D, w: number, d: number, h: number, m: THREE.Material, x: number, y: number, z: number, ry = 0, sag = 0) {
  const s = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(sag, h)]);
  const geo = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2); geo.rotateY(Math.PI / 2);
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; g.add(o);
  return o;
}
/** Boards: a canvas of weathered planks in `colour`, for walls, docks and barns. */
const plankCache = new Map<string, THREE.CanvasTexture>();
function planks(colour: string, vertical = false, seed = 3): THREE.CanvasTexture {
  const key = `${colour}${vertical}${seed}`;
  const hit = plankCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas"), x = c.getContext("2d")!, rnd = mulberry32(seed);
  c.width = c.height = 128;
  x.fillStyle = colour; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 8; i++) {
    const v = 0.75 + rnd() * 0.4;
    x.fillStyle = `rgba(${v > 1 ? 255 : 0},${v > 1 ? 255 : 0},${v > 1 ? 255 : 0},${Math.abs(1 - v) * 0.5})`;
    vertical ? x.fillRect(i * 16, 0, 16, 128) : x.fillRect(0, i * 16, 128, 16);
    x.fillStyle = "rgba(0,0,0,0.45)";
    vertical ? x.fillRect(i * 16, 0, 1.5, 128) : x.fillRect(0, i * 16, 128, 1.5);
    for (let k = 0; k < 6; k++) { x.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`; const a = rnd() * 128, b = i * 16 + rnd() * 16; vertical ? x.fillRect(b, a, 0.8, 10 + rnd() * 30) : x.fillRect(a, b, 10 + rnd() * 30, 0.8); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  plankCache.set(key, t);
  return t;
}
/** Words painted on a board: a sign, a van's door. */
function lettering(lines: string[], bg: string, fg: string, w = 256, h = 128): THREE.CanvasTexture {
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  c.width = w; c.height = h;
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
  const size = Math.floor(h / (lines.length + 0.8));
  x.font = `700 ${size}px "DM Sans", system-ui, sans-serif`;
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05, w * 0.92));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const walls = (colour: string, seed = 3, vertical = true, repeat = 2) => { const t = planks(colour, vertical, seed).clone(); t.repeat.set(repeat, repeat); t.needsUpdate = true; return mat(0xffffff, 0.95, { map: t }); };

// --- the running jokes -------------------------------------------------------------------------------------------
/** The Bureau's van: black, tinted, an aerial too many, parked with two wheels on something. */
function van(g: THREE.Object3D, x: number, z: number, ry: number, tilt = 0.06) {
  const v = new THREE.Group(), body = mat(0x16181c, 0.35, { metalness: 0.4 }), glass = mat(0x0a0c10, 0.1, { metalness: 0.6 }), tyre = mat(0x111111, 0.9);
  box(v, 4.6, 1.7, 1.9, body, 0, 1.25, 0);
  box(v, 1.1, 0.9, 1.86, glass, 1.75, 1.75, 0);
  box(v, 2.6, 0.55, 1.95, glass, -0.6, 1.75, 0);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ map: lettering(["NOTHING TO SEE"], "#16181c", "#9aa0a8", 512, 128), transparent: true }));
  door.position.set(-0.4, 1.05, 0.99); v.add(door);
  for (const [wx, wz] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]] as const) cyl(v, 0.42, 0.42, 0.3, tyre, wx, 0.42, wz, 12, 0, 0).rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) cyl(v, 0.015, 0.008, 1.2 + i * 0.4, mat(0x888888, 0.4), -1.2 - i * 0.35, 2.7 + i * 0.2, 0.4, 4);
  box(v, 0.5, 0.35, 0.5, mat(0xd0d4d8, 0.5), -0.3, 2.25, 0); // a dish, or a coffee maker
  v.position.set(x, 0, z); v.rotation.set(0, ry, tilt);
  g.add(v);
}
/** A trail camera strapped to a post, its red light on. */
function trailCam(g: THREE.Object3D, x: number, z: number) {
  cyl(g, 0.08, 0.07, 1.4, mat(0x5a4a38), x, 0.7, z, 6);
  box(g, 0.22, 0.3, 0.16, mat(0x4a5038, 0.8), x - 0.12, 1.15, z);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  led.position.set(x - 0.24, 1.22, z); g.add(led);
}
/** A sign on two posts. */
function sign(g: THREE.Object3D, lines: string[], x: number, z: number, ry: number, bg = "#e8e0c8", fg = "#2a2420", lean = 0.08) {
  const s = new THREE.Group();
  cyl(s, 0.06, 0.06, 1.6, mat(0x6a5a44), -0.7, 0.8, 0, 6);
  cyl(s, 0.06, 0.06, 1.6, mat(0x6a5a44), 0.7, 0.8, 0, 6);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 0.05), [mat(0x8a7a60), mat(0x8a7a60), mat(0x8a7a60), mat(0x8a7a60), mat(0xffffff, 0.8, { map: lettering(lines, bg, fg) }), mat(0x8a7a60)]);
  board.position.y = 1.35; board.castShadow = true; s.add(board);
  s.position.set(x, 0, z); s.rotation.set(0, ry, lean);
  g.add(s);
}

// --- the set pieces ------------------------------------------------------------------------------------------------
/** A ruined farmhouse: a stone chimney standing alone, two walls left, a roof slid half off. */
function farmhouse(g: THREE.Object3D, x: number, z: number, ry: number) {
  const h = new THREE.Group(), wood = walls("#6a5a48", 5), stone = mat(0x7a7068, 0.95);
  box(h, 0.25, 3.2, 6, wood, -2.5, 1.6, 0);
  box(h, 5, 2.2, 0.25, wood, 0, 1.1, -3);
  box(h, 2.2, 1.2, 0.25, wood, -1.4, 0.6, 3, 0, 0.1);
  box(h, 1.2, 6.2, 1.2, stone, 2.6, 3.1, -2.4);
  box(h, 0.8, 0.6, 0.8, stone, 2.6, 6.5, -2.4);
  const r = roof(h, 5.4, 6.6, 2.2, walls("#3a3430", 7, false, 3), -0.4, 2.2, 0.4, 0.15, -0.6);
  r.rotation.z = -0.32; r.position.y = 1.5;
  for (let i = 0; i < 4; i++) box(h, 1.6, 0.08, 0.25, wood, 1 - i * 0.4, 0.05, 1.5 + i * 0.3, i * 0.7);
  h.position.set(x, 0, z); h.rotation.y = ry; g.add(h);
}
/** Cedar water: a bog pool the colour of strong tea, sedge round it. */
function bogPool(g: THREE.Object3D, x: number, z: number, r: number) {
  const pool = new THREE.Mesh(new THREE.CircleGeometry(r, 28), mat(0x3a2410, 0.08, { metalness: 0.1, transparent: true, opacity: 0.92 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(x, -0.3, z); pool.scale.y = 0.65; g.add(pool);
  const rim = new THREE.Mesh(new THREE.RingGeometry(r * 0.98, r * 1.25, 28), mat(0x6a5a2a, 1));
  rim.rotation.x = -Math.PI / 2; rim.position.set(x, -0.31, z); rim.scale.y = 0.65; g.add(rim);
}
/** A mine mouth in a hillside: timbers, boards nailed across, a cart on a stub of rail. */
function mine(g: THREE.Object3D, x: number, z: number, ry: number) {
  const m = new THREE.Group(), timber = mat(0x4a3a2a, 0.95), dark = mat(0x050505, 1), rock = mat(0x5a5a50, 1, { flatShading: true });
  const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1), rock);
  hill.scale.set(1, 0.7, 1.3); hill.position.set(5, -0.5, 0); hill.receiveShadow = true; m.add(hill);
  box(m, 0.2, 3.2, 3.2, dark, -3.2, 1.5, 0);
  box(m, 0.5, 3.4, 0.5, timber, -3.5, 1.7, 1.7);
  box(m, 0.5, 3.4, 0.5, timber, -3.5, 1.7, -1.7);
  box(m, 0.6, 0.5, 4.2, timber, -3.5, 3.5, 0);
  for (let i = 0; i < 4; i++) box(m, 0.1, 0.3, 3.6, walls("#7a6650", i), -3.65, 0.8 + i * 0.65, 0, 0, 0, (i % 2 ? 0.12 : -0.1));
  for (const s of [-0.5, 0.5]) box(m, 7, 0.08, 0.08, mat(0x5a4030, 0.5, { metalness: 0.5 }), -7, 0.05, s);
  for (let i = 0; i < 9; i++) box(m, 0.25, 0.08, 1.4, timber, -4 - i * 0.8, 0.02, 0);
  box(m, 1.6, 0.9, 1.1, mat(0x5a3a28, 0.6, { metalness: 0.5 }), -8.5, 0.75, 0, 0, 0.5);
  sign(m, ["DANGER", "KEEP OUT"], -4.6, 2.6, Math.PI / 2, "#e8d040", "#1a1a1a", 0.04);
  m.position.set(x, 0, z); m.rotation.y = ry; g.add(m);
}
/** A lumber camp: a cabin with a stovepipe, logs stacked on cribbing, a sawbuck with a crosscut saw. */
function lumberCamp(g: THREE.Object3D, x: number, z: number, ry: number) {
  const c = new THREE.Group(), bark = mat(0x5a4632, 0.95), cut = mat(0xc8a878, 0.8);
  for (let i = 0; i < 7; i++) { const y = 0.25 + i * 0.42; for (const s of [-1, 1]) cyl(c, 0.22, 0.22, 5.2, bark, 0, y, s * 2, 8, Math.PI / 2, 0); cyl(c, 0.21, 0.21, 4.4, bark, s0(i), y + 0.21, 0, 8, Math.PI / 2, Math.PI / 2); }
  function s0(i: number) { return i % 2 ? 2.4 : -2.4; }
  roof(c, 5.6, 5.4, 1.8, walls("#4a4038", 9, false, 3), 0, 3.2, 0, 0);
  cyl(c, 0.12, 0.12, 2, mat(0x2a2a2a, 0.5, { metalness: 0.6 }), 1.4, 4.6, 0.8, 8);
  // the log pile: ends showing
  for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
    cyl(c, 0.3, 0.3, 4, bark, -6, 0.3 + row * 0.52, -2 + i * 0.62 + row * 0.31, 9, Math.PI / 2, Math.PI / 2);
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.28, 9), cut); end.position.set(-6 + 2.01, 0.3 + row * 0.52, -2 + i * 0.62 + row * 0.31); end.rotation.y = Math.PI / 2; c.add(end);
  }
  box(c, 0.1, 1.1, 0.1, bark, -3, 0.5, 3.5, 0, 0.5); box(c, 0.1, 1.1, 0.1, bark, -3, 0.5, 3.5, 0, -0.5);
  box(c, 1.6, 0.12, 0.02, mat(0xb0b4b8, 0.3, { metalness: 0.8 }), -3, 1.1, 3.5, 0.3);
  c.position.set(x, 0, z); c.rotation.y = ry; g.add(c);
}
/** A nurse log: a fallen giant furred in moss, saplings and ferns growing from its back. */
function nurseLog(g: THREE.Object3D, x: number, z: number, ry: number) {
  const n = new THREE.Group(), moss = mat(0x4a6a2a, 1), wood = mat(0x6a4030, 0.95), cut = mat(0x9a6a48, 0.9);
  const log = cyl(n, 1.5, 1.3, 22, wood, 0, 1.1, 0, 14, Math.PI / 2, 0);
  log.rotation.set(0, 0, Math.PI / 2);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.36, 1.56, 22, 14, 1, true, -Math.PI * 0.55, Math.PI * 1.1), moss);
  top.rotation.set(0, 0, Math.PI / 2); top.position.set(0, 1.12, 0); n.add(top);
  const end = new THREE.Mesh(new THREE.CircleGeometry(1.48, 14), cut); end.position.set(-11.01, 1.1, 0); end.rotation.y = -Math.PI / 2; n.add(end);
  // the root plate, up on end
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 0.8, 12), mat(0x4a3a2a, 1, { flatShading: true }));
  plate.rotation.z = Math.PI / 2; plate.position.set(11.3, 2.6, 0); n.add(plate);
  for (let i = 0; i < 5; i++) cyl(n, 0.08, 0.02, 2.2 + i * 0.5, mat(0x4a3a2a), -8 + i * 3.6, 2.2 + i * 0.25, 0.2, 5);
  n.position.set(x, -0.2, z); n.rotation.y = ry; g.add(n);
}
/** A lighthouse on a shingle spit: white tower, red lantern room, a gallery rail, and an upturned rowboat. */
function lighthouse(g: THREE.Object3D, x: number, z: number) {
  const l = new THREE.Group(), white = mat(0xeeeae0, 0.7), red = mat(0xa82a22, 0.6);
  cyl(l, 2.6, 2.6, 0.8, mat(0x7a7468, 1), 0, 0.4, 0, 16);
  cyl(l, 1.6, 1.05, 12, white, 0, 6.8, 0, 16);
  cyl(l, 1.2, 1.2, 0.3, mat(0x2a2a2a, 0.5), 0, 12.9, 0, 16);
  const lamp = cyl(l, 0.8, 0.8, 1.4, new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xffe080, emissiveIntensity: 1.2, roughness: 0.2 }), 0, 13.7, 0, 12);
  lamp.castShadow = false;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.2, 12), red); cap.position.set(0, 15, 0); l.add(cap);
  for (let i = 0; i < 4; i++) cyl(l, 1.2 + i * 0.03, 1.2 + i * 0.03, 0.02, red, 0, 2.5 + i * 3, 0, 16);
  box(l, 3.4, 0.7, 1.3, mat(0x3a5a6a, 0.7), 5, 0.35, 2.5, 0.4);
  for (let i = 0; i < 40; i++) { const r = mulberry32(i)(); const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25 + r * 0.4, 0), mat(0x8a8478, 1, { flatShading: true })); s.position.set(Math.cos(i * 2.4) * (3 + r * 4), 0, Math.sin(i * 2.4) * (3 + r * 4)); s.scale.y = 0.5; l.add(s); }
  l.position.set(x, -0.3, z); g.add(l);
}
/** Mesas: flat-topped buttes with banded red rock, standing off on the horizon. */
function mesas(g: THREE.Object3D, R: number) {
  const bands = (seed: number) => { const c = document.createElement("canvas"), x = c.getContext("2d")!, rnd = mulberry32(seed); c.width = 4; c.height = 64; for (let i = 0; i < 64; i++) { const v = 0.75 + rnd() * 0.35; x.fillStyle = `rgb(${Math.min(255, 196 * v)},${Math.min(255, 110 * v)},${Math.min(255, 70 * v)})`; x.fillRect(0, i, 4, 1); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const rnd = mulberry32(31);
  for (let i = 0; i < 6; i++) {
    const a = -0.9 + i * 0.36 + rnd() * 0.2, d = R + 30 + rnd() * 18, h = 8 + rnd() * 10, w = 6 + rnd() * 9;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.8, w, h, 7), mat(0xffffff, 1, { map: bands(i), flatShading: true }));
    m.position.set(Math.cos(a) * d, h / 2 - 1, Math.sin(a) * d); m.scale.z = 0.6 + rnd() * 0.5; m.rotation.y = rnd() * 3; g.add(m);
  }
}
/** An adobe ruin: thick melted walls, a doorway, vigas poking out. */
function adobe(g: THREE.Object3D, x: number, z: number, ry: number) {
  const a = new THREE.Group(), mud = mat(0xb87a4a, 1), viga = mat(0x5a4030, 0.9);
  box(a, 6, 2.8, 0.7, mud, 0, 1.4, -2.5);
  box(a, 0.7, 2.4, 5, mud, -3, 1.2, 0);
  box(a, 2.2, 2.6, 0.7, mud, 1.9, 1.3, 2.5);
  box(a, 1.6, 1.4, 0.7, mud, -1.8, 0.7, 2.5);
  for (let i = 0; i < 5; i++) cyl(a, 0.12, 0.12, 1.4, viga, -2.2 + i * 1.1, 2.55, -2.5, 6, Math.PI / 2, 0).rotation.x = Math.PI / 2;
  const ladder = new THREE.Group();
  box(ladder, 0.08, 3.4, 0.08, viga, -0.3, 1.7, 0); box(ladder, 0.08, 3.4, 0.08, viga, 0.3, 1.7, 0);
  for (let i = 0; i < 6; i++) box(ladder, 0.7, 0.06, 0.06, viga, 0, 0.4 + i * 0.5, 0);
  ladder.position.set(1, 0, -1.9); ladder.rotation.x = -0.3; a.add(ladder);
  a.position.set(x, 0, z); a.rotation.y = ry; g.add(a);
}
/** A shack on stilts over the water, a tin roof, a porch and a pirogue tied under it. */
function stiltShack(g: THREE.Object3D, x: number, z: number, ry: number) {
  const s = new THREE.Group(), post = mat(0x3a3028, 0.95), tin = mat(0x8a8a84, 0.45, { metalness: 0.6 });
  for (const [px, pz] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2], [-2.5, 3.6], [2.5, 3.6]] as const) cyl(s, 0.14, 0.14, 2.6, post, px, 0.8, pz, 6);
  box(s, 5.4, 0.15, 6, walls("#5a4a3a", 4, false, 3), 0, 2.1, 0.8);
  box(s, 5, 2.4, 4, walls("#6a6a5a", 11, true, 2), 0, 3.3, -0.2);
  roof(s, 5.6, 5.2, 1.2, tin, 0, 4.5, -0.2, 0, 0.3);
  box(s, 0.9, 1.6, 0.05, mat(0x1a1a18), 0.8, 2.95, 1.82);
  box(s, 0.8, 0.7, 0.05, mat(0x2a3438, 0.2), -1.4, 3.5, 1.82);
  const boat = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 3.2, 4, 8), mat(0x4a3a2a, 0.8));
  boat.rotation.z = Math.PI / 2; boat.scale.set(1, 1, 0.5); boat.position.set(0, -0.05, 4.8); s.add(boat);
  s.position.set(x, -0.3, z); s.rotation.y = ry; g.add(s);
}
/** A limestone bluff: pale ledges stepping up, a cedar clinging to the top. */
function bluff(g: THREE.Object3D, x: number, z: number, ry: number) {
  const b = new THREE.Group(), rnd = mulberry32(8);
  for (let i = 0; i < 6; i++) {
    const w = 18 - i * 2.2, ledge = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6 + rnd() * 0.8, 6 - i * 0.5, 4, 1, 2), mat(i % 2 ? 0xc8c0a8 : 0xb8b098, 1, { flatShading: true }));
    const p = ledge.geometry.attributes.position!;
    for (let k = 0; k < p.count; k++) p.setX(k, p.getX(k) + (rnd() - 0.5) * 0.6), p.setZ(k, p.getZ(k) + (rnd() - 0.5) * 0.5);
    ledge.geometry.computeVertexNormals();
    ledge.position.set((rnd() - 0.5) * 1.5, 0.8 + i * 1.7, -i * 0.6); ledge.castShadow = ledge.receiveShadow = true; b.add(ledge);
  }
  b.position.set(x, -0.4, z); b.rotation.y = ry; g.add(b);
}
/** A barn sagging in the middle: red boards gone brown, a hayloft door hanging by one hinge. */
function barn(g: THREE.Object3D, x: number, z: number, ry: number) {
  const b = new THREE.Group();
  box(b, 8, 4.5, 6, walls("#7a3a2a", 13, true, 3), 0, 2.25, 0);
  const r = roof(b, 8.6, 6.8, 3, walls("#4a4440", 14, false, 4), 0, 4.5, 0, 0, 0.2);
  r.scale.y = 0.92;
  box(b, 2.4, 3, 0.1, walls("#5a2a20", 15, true, 1), 0, 1.5, 3.02);
  box(b, 1.1, 1.2, 0.08, walls("#5a2a20", 16, true, 1), 0.7, 5.2, 3.2, 0.5, 0.25);
  b.position.set(x, 0, z); b.rotation.set(0, ry, 0.03); g.add(b);
}

// --- small things that move ---------------------------------------------------------------------------------------
/** Fireflies: points that blink and wander over a patch of ground. */
function fireflies(g: THREE.Object3D, n: number, cx: number, cz: number, spread: number): (t: number) => void {
  const pos = new Float32Array(n * 3), base: number[] = [], rnd = mulberry32(5);
  for (let i = 0; i < n; i++) base.push(cx + (rnd() - 0.5) * spread, 0.6 + rnd() * 2.4, cz + (rnd() - 0.5) * spread, rnd() * 10);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xd8ff70, size: 0.22, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, m); pts.frustumCulled = false; g.add(pts);
  return (t) => {
    for (let i = 0; i < n; i++) {
      const [x, y, z, p] = [base[i * 4]!, base[i * 4 + 1]!, base[i * 4 + 2]!, base[i * 4 + 3]!], on = Math.sin(t * 1.7 + p * 3) > 0.2;
      pos.set([x + Math.sin(t * 0.3 + p) * 1.2, on ? y + Math.sin(t * 0.7 + p) * 0.4 : -50, z + Math.cos(t * 0.25 + p) * 1.2], i * 3);
    }
    geo.attributes.position!.needsUpdate = true;
  };
}
/** Fog banks: big soft sheets drifting slowly across behind the ring. */
function fogBanks(g: THREE.Object3D, colour: number, R: number, n = 7, opacity = 0.28): (t: number) => void {
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  c.width = c.height = 128;
  const grad = x.createRadialGradient(64, 64, 4, 64, 64, 64); grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = grad; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c), sheets: THREE.Sprite[] = [], rnd = mulberry32(19);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: colour, transparent: true, opacity, depthWrite: false, fog: true }));
    s.scale.set(26 + rnd() * 16, 7 + rnd() * 4, 1);
    s.userData = { a: rnd() * Math.PI * 2, d: R + 8 + rnd() * 18, y: 1.5 + rnd() * 3, v: 0.006 + rnd() * 0.01 };
    sheets.push(s); g.add(s);
  }
  return (t) => { for (const s of sheets) { const u = s.userData as { a: number; d: number; y: number; v: number }, a = u.a + t * u.v; s.position.set(Math.cos(a) * u.d, u.y, Math.sin(a) * u.d); } };
}

// --- the eight playable regions -----------------------------------------------------------------------------------
const deg = Math.PI / 180;
/** Polar to x, z round the ring: `a` degrees from the far side (+x), `d` metres out. */
const at = (a: number, d: number): [number, number] => [Math.cos(a * deg) * d, Math.sin(a * deg) * d];

export const SETS: Record<string, RegionSet> = {
  "pine-barrens": {
    horizon: "treeline", mood: { sun: [-14, 18, 16], sunColour: 0xffe2b8, sunPower: 2.3, fog: [28, 95], fill: 0.8, haze: 0.3 },
    build(g, R) {
      farmhouse(g, ...at(18, R + 14), -1.2);
      bogPool(g, ...at(-30, R + 8), 5);
      sign(g, ["LEEDS POINT", "NO HUNTING", "(OF ANY KIND)"], ...at(-60, R + 4), 1.1);
      trailCam(g, ...at(48, R + 3));
      return fogBanks(g, 0xd8dcd4, R, 5, 0.2);
    },
  },
  "appalachian-hollows": {
    horizon: "ridges", mood: { sun: [-10, 16, 14], sunColour: 0xffe8c8, sunPower: 2, fog: [24, 85], fill: 0.85, haze: 0.45 },
    build(g, R) {
      mine(g, ...at(8, R + 16), Math.PI);
      sign(g, ["MOTHMAN", "SIGHTINGS", "REPORT TO NOBODY"], ...at(-50, R + 4), 1.0);
      van(g, ...at(55, R + 9), -0.6, 0.05);
      return fogBanks(g, 0xc8d0d4, R, 9, 0.32);
    },
  },
  "great-north-woods": {
    horizon: "treeline", mood: { sun: [-12, 20, 12], sunColour: 0xfff0d8, sunPower: 2.4, fog: [30, 100], fill: 0.8 },
    build(g, R) {
      lumberCamp(g, ...at(10, R + 15), Math.PI * 0.95);
      sign(g, ["HODAG", "CROSSING"], ...at(-45, R + 4), 0.9, "#e8d040", "#1a1a1a");
      trailCam(g, ...at(50, R + 3));
    },
  },
  "pacific-northwest-rainforest": {
    horizon: "treeline", mood: { sun: [-6, 22, 8], sunColour: 0xdce4e8, sunPower: 1.5, fog: [16, 70], fill: 1.05, haze: 0.6 },
    build(g, R) {
      nurseLog(g, ...at(14, R + 12), 1.3);
      trailCam(g, ...at(-40, R + 3));
      sign(g, ["PLEASE DO NOT", "FEED THE", "SASQUATCH"], ...at(48, R + 4), -0.9, "#4a6a3a", "#f0ecd8");
      return fogBanks(g, 0xc8d2d0, R, 11, 0.38);
    },
  },
  "great-lakes-and-lake-champlain": {
    horizon: "flat", mood: { sun: [-16, 20, -8], sunColour: 0xfff4e4, sunPower: 2.5, fog: [40, 140], fill: 0.85 },
    build(g, R) {
      lighthouse(g, ...at(22, R + 18));
      sign(g, ["CHAMP", "VIEWING AREA", "(CLOSED)"], ...at(-50, R + 4), 1.0, "#2a4a6a", "#f0ecd8");
      van(g, ...at(-25, R + 16), 0.8, -0.04);
    },
  },
  "southwest-desert": {
    horizon: "mesas", mood: { sun: [-8, 30, 6], sunColour: 0xffe0a8, sunPower: 3, fog: [50, 160], fill: 0.7, haze: 0.2 },
    build(g, R) {
      mesas(g, R);
      adobe(g, ...at(-14, R + 13), 0.5);
      sign(g, ["NEXT GAS", "112 MI", "GOOD LUCK"], ...at(40, R + 5), -0.7, "#e8e0c8", "#6a2a1a");
      van(g, ...at(62, R + 10), -1.1, 0.07);
    },
  },
  "bayou-and-everglades": {
    horizon: "treeline", mood: { sun: [-14, 9, 10], sunColour: 0xffc890, sunPower: 2, fog: [18, 75], fill: 0.95, haze: 0.5 },
    build(g, R) {
      stiltShack(g, ...at(16, R + 14), -1.4);
      sign(g, ["SWAMP TOURS", "SURVIVORS GET", "A T-SHIRT"], ...at(-48, R + 4), 1.0, "#d8c890", "#3a2a1a");
      const flies = fireflies(g, 70, ...at(0, R + 8), 30), fog = fogBanks(g, 0xb8c0a0, R, 7, 0.26);
      return (t) => { flies(t); fog(t); };
    },
  },
  "ozarks-and-the-southern-plains": {
    horizon: "hills", mood: { sun: [-14, 16, 14], sunColour: 0xffe4b8, sunPower: 2.4, fog: [34, 120], fill: 0.8, haze: 0.25 },
    build(g, R) {
      bluff(g, ...at(-6, R + 26), Math.PI / 2);
      barn(g, ...at(32, R + 14), -1.9);
      sign(g, ["HOWLER", "HUNTING", "SEASON: NEVER"], ...at(-50, R + 4), 1.0);
      trailCam(g, ...at(55, R + 3));
    },
  },
};
