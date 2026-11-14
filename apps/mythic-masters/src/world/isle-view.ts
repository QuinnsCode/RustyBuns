// The boat to a pack's island drawn (ferry.ts, #4405): the port town's pier, boat and houses on the continent, and the
// island itself, its own small scene shown while you are on it (view.ts swaps it in for the continent, as a town's rooms).
// The island is a pack's World (world.ts buildIsland): its whole ground in one coarse mesh, a fine patch round you, the
// sea and the boat back at its slip. Its places (poi.json) are poi-view.ts's, as the continent's are (view.ts, #4406).
import * as THREE from "three";
import { heightAt, type World } from "./world.ts";
import type { Slip } from "./ferry.ts";

const WOOD = 0x6a4e34, HULL = 0x2c3a4a, SAIL = 0xe8e2d0, SNOW = new THREE.Color(0xeef2f6), ROCK = new THREE.Color(0x6e6a66);
const SAND = new THREE.Color(0xb8ab8a), MOSS = new THREE.Color(0x56664a), SEA = 0x2a4a5e;
const FAR_STEP = 100, NEAR_N = 129, NEAR_STEP = 4, NEAR_SNAP = 128;

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

/** A boat: a hull, a cabin and a mast with its sail furled, its bow along +z. */
function boat(): THREE.Group {
  const g = new THREE.Group(), hull = box(3.2, 1.4, 9, mat(HULL)), cabin = box(2.2, 1.6, 2.6, mat(SAIL)), mast = box(0.2, 7, 0.2, mat(WOOD));
  hull.position.y = 0.3; cabin.position.set(0, 1.8, -1.6); mast.position.set(0, 4, 1.4);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3, 4), mat(HULL));
  bow.rotation.x = Math.PI / 2; bow.rotation.y = Math.PI / 4; bow.scale.set(1, 1, 0.45); bow.position.set(0, 0.3, 5.9);
  g.add(hull, cabin, mast, bow);
  return g;
}

/** A pier along the slip's dock, its deck from `y0` at the land end to `y1` at the boat, on posts down to the sea floor. */
function pier(s: Slip, y0: number, y1: number): THREE.Group {
  const g = new THREE.Group(), [a, b] = s.dock, len = Math.hypot(b.x - a.x, b.z - a.z), wood = mat(WOOD);
  const deck = box(3.6, 0.3, len, wood), yaw = Math.atan2(b.x - a.x, b.z - a.z);
  deck.position.set((a.x + b.x) / 2, (y0 + y1) / 2, (a.z + b.z) / 2);
  deck.rotation.set(0, yaw, 0, "YXZ"); deck.rotateX(-Math.atan2(y1 - y0, len));
  g.add(deck);
  for (let d = 0; d <= len; d += 8) for (const side of [-1.6, 1.6]) {
    const t = d / len, y = y0 + (y1 - y0) * t, post = box(0.3, y + 3, 0.3, wood);
    post.position.set(a.x + (b.x - a.x) * t + Math.cos(yaw) * side, (y - 3) / 2, a.z + (b.z - a.z) * t - Math.sin(yaw) * side);
    g.add(post);
  }
  const b2 = boat();
  b2.position.set(s.boat.x, 0, s.boat.z); b2.rotation.y = Math.atan2(s.out.x, s.out.z);
  g.add(b2);
  return g;
}

/** A small house with a pitched roof and a lit window. */
function house(colour: number): THREE.Group {
  const g = new THREE.Group(), walls = box(6, 4, 5, mat(colour)), roof = new THREE.Mesh(new THREE.ConeGeometry(4.8, 2.6, 4), mat(0x3a2e2a));
  walls.position.y = 2; roof.position.y = 5.3; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.8);
  const lamp = box(1, 1, 0.1, new THREE.MeshBasicMaterial({ color: 0xffd890 }));
  lamp.position.set(0, 2.2, 2.52);
  g.add(walls, roof, lamp);
  return g;
}

/** The port town on the continent: the pier and its boat, and a row of houses back from the slip. `place` sets them on
 *  the ground as it is drawn now (it rises as the region's fine ground comes in). */
export function portView(s: Slip) {
  const group = new THREE.Group(), side = { x: -s.out.z, z: s.out.x };
  let built: THREE.Group | null = null, at = NaN;
  const houses = [-22, -10, 12, 24].map((d, i) => {
    const h = house([0x9a5a44, 0xc8bca0, 0x5a7a8a, 0xb89a5a][i]!), back = 34 + (i % 2) * 8;
    h.userData.at = { x: s.x - s.out.x * back + side.x * d, z: s.z - s.out.z * back + side.z * d };
    h.rotation.y = Math.atan2(s.out.x, s.out.z);
    group.add(h);
    return h;
  });
  return {
    group,
    place(groundY: (x: number, z: number) => number) {
      const y0 = Math.max(0.6, groundY(s.dock[0].x, s.dock[0].z) + 0.4);
      for (const h of houses) { const p = h.userData.at as { x: number; z: number }; h.position.set(p.x, Math.max(0.4, groundY(p.x, p.z)), p.z); }
      if (Math.abs(y0 - at) < 0.2) return;
      if (built) { group.remove(built); dispose(built); }
      built = pier(s, y0, 0.9); at = y0;
      group.add(built);
    },
    dispose() { dispose(group); group.removeFromParent(); },
  };
}

/** The island's ground colour at a height and steepness: sand on the shore, snow over the rest, rock on the steeps. */
function colourAt(y: number, steep: number, out: THREE.Color) {
  if (y < 1.2) return out.copy(SAND);
  out.copy(steep > 0.5 ? ROCK : y < 2.2 ? MOSS : SNOW);
  return out;
}

function groundGeometry(w: World, x0: number, z0: number, nx: number, nz: number, step: number) {
  const g = new THREE.PlaneGeometry((nx - 1) * step, (nz - 1) * step, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = x0 + (i % nx) * step, z = z0 + Math.floor(i / nx) * step, y = heightAt(w, x, z);
    const steep = Math.hypot(heightAt(w, x + 3, z) - y, heightAt(w, x, z + 3) - y) / 3;
    pos.setXYZ(i, x, y, z);
    colourAt(y, steep, c).toArray(col, i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** The island drawn from its World: call `tick(x, z)` each frame with where you stand, so the fine patch follows you. */
export function isleView(w: World, s: Slip) {
  const group = new THREE.Group(), ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const far = new THREE.Mesh(groundGeometry(w, 0, 0, Math.floor(w.width / FAR_STEP) + 1, Math.floor(w.depth / FAR_STEP) + 1, FAR_STEP), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  far.position.y = -0.4;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(w.width * 4, w.depth * 4), mat(SEA, { roughness: 0.3, transparent: true, opacity: 0.85 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(w.width / 2, 0, w.depth / 2);
  let near: THREE.Mesh | null = null, nearAt = { x: NaN, z: NaN };
  group.add(far, sea, pier(s, Math.max(0.6, heightAt(w, s.dock[0].x, s.dock[0].z) + 0.4), 0.9));
  return {
    group,
    tick(x: number, z: number) {
      const nx = Math.round(x / NEAR_SNAP) * NEAR_SNAP, nz = Math.round(z / NEAR_SNAP) * NEAR_SNAP;
      if (nx === nearAt.x && nz === nearAt.z) return;
      nearAt = { x: nx, z: nz };
      const half = ((NEAR_N - 1) * NEAR_STEP) / 2, g = groundGeometry(w, nx - half, nz - half, NEAR_N, NEAR_N, NEAR_STEP);
      if (near) { near.geometry.dispose(); near.geometry = g; } else { near = new THREE.Mesh(g, ground); group.add(near); }
    },
    dispose() { dispose(group); group.removeFromParent(); },
  };
}

function dispose(o: THREE.Object3D) {
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    m.geometry.dispose();
    for (const x of [m.material].flat()) x.dispose();
  });
}
