// The jam room in three.js: floor, walls, the glass wall to the control room, and the gear at each spot (a keyboard
// on its stand, a drum kit, a bass amp, a vocal mic, the desk with its monitors, the couch). View only: what you
// can walk into is ./jam.ts `solids`, from the same numbers.
import * as THREE from "three";
import { PARTITION_T, type Spot, type StudioDef } from "./def.ts";
import { GEAR_AT, gearRect } from "./jam.ts";

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
function part(geo: THREE.BufferGeometry, m: THREE.Material, size: [number, number, number], at: [number, number, number], rotX = 0) {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(...size); o.position.set(...at); o.rotation.x = rotX;
  o.castShadow = o.receiveShadow = true;
  return o;
}

const BLACK = std(0x1d1f23), METAL = std(0x9aa0a8, { metalness: 0.7, roughness: 0.35 }), WOOD = std(0x6b4a2c), WHITE = std(0xcfcac0, { roughness: 0.9 });
const SHELL = std(0x8c2f39, { roughness: 0.4 }), CYMBAL = std(0xd8b04a, { metalness: 0.8, roughness: 0.3 }), FABRIC = std(0x3a4a6b, { roughness: 1 });

/** The gear standing at a spot, in the gear's own frame (its front, toward the seat, is +z; built at its footprint's middle). */
function gearModel(s: Spot): THREE.Group {
  const g = new THREE.Group(), { w, d } = GEAR_AT[s.kind];
  if (s.kind === "keys") {
    g.add(part(BOX, METAL, [0.04, 0.72, 0.04], [-w / 2 + 0.15, 0.36, 0]), part(BOX, METAL, [0.04, 0.72, 0.04], [w / 2 - 0.15, 0.36, 0]));
    g.add(part(BOX, BLACK, [w, 0.08, d * 0.8], [0, 0.76, 0]), part(BOX, WHITE, [w * 0.92, 0.02, d * 0.35], [0, 0.81, d * 0.18]));
    // the black keys over the white, two and three to an octave, five octaves
    const octave = (w * 0.92) / 5;
    for (let o = 0; o < 5; o++) for (const k of [1, 2, 4, 5, 6]) {
      const x = -w * 0.46 + o * octave + (k * octave) / 7;
      g.add(part(BOX, BLACK, [octave / 14, 0.02, d * 0.2], [x, 0.825, d * 0.11]));
    }
  } else if (s.kind === "drums") {
    g.add(part(CYL, SHELL, [0.55, 0.4, 0.55], [0, 0.28, -0.15], Math.PI / 2)); // the kick, lying on its side
    for (const [x, z, r, h] of [[0.38, 0.22, 0.32, 0.62], [-0.15, 0.05, 0.28, 0.72], [0.15, 0.05, 0.28, 0.72], [-0.5, -0.1, 0.4, 0.5]] as const)
      g.add(part(CYL, SHELL, [r, 0.16, r], [x, h, z]), part(BOX, METAL, [0.02, h, 0.02], [x, h / 2, z]));
    for (const [x, z, h] of [[-0.65, 0.2, 0.95], [0.6, -0.3, 1.2], [-0.35, -0.35, 1.25]] as const)
      g.add(part(CYL, CYMBAL, [0.42, 0.01, 0.42], [x, h, z]), part(BOX, METAL, [0.02, h, 0.02], [x, h / 2, z]));
  } else if (s.kind === "bass") {
    g.add(part(BOX, BLACK, [w, 0.75, d], [0, 0.375, 0]), part(BOX, std(0x4a4e55), [w * 0.82, 0.5, 0.01], [0, 0.32, d / 2 + 0.005]));
    // the bass on its stand beside the amp
    const neck = part(BOX, WOOD, [0.05, 0.6, 0.03], [w / 2 + 0.22, 0.85, 0.05]);
    g.add(part(BOX, std(0x2f6b8f, { roughness: 0.3 }), [0.3, 0.42, 0.06], [w / 2 + 0.22, 0.38, 0.05]), neck);
  } else if (s.kind === "vocal") {
    g.add(part(CYL, BLACK, [0.28, 0.02, 0.28], [0, 0.01, 0]), part(BOX, METAL, [0.02, 1.45, 0.02], [0, 0.72, 0]), part(CYL, METAL, [0.06, 0.16, 0.06], [0, 1.5, 0.05], 0.4));
  } else if (s.kind === "desk") {
    g.add(part(BOX, WOOD, [w, 0.06, d], [0, 0.74, 0]), part(BOX, BLACK, [w, 0.7, 0.05], [0, 0.37, -d / 2 + 0.03]));
    g.add(part(BOX, std(0x2e3439), [w * 0.6, 0.06, d * 0.6], [0, 0.8, 0.05]));
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) g.add(part(BOX, BLACK, [0.2, 0.32, 0.22], [x, 0.93, -0.12]));
    g.add(part(BOX, std(0x111316, { emissive: 0x1f4a6b, emissiveIntensity: 0.6 }), [0.7, 0.4, 0.04], [0, 1.05, -0.2]));
  } else if (s.kind === "couch") {
    g.add(part(BOX, FABRIC, [w, 0.42, d], [0, 0.21, 0]), part(BOX, FABRIC, [w, 0.45, 0.2], [0, 0.62, -d / 2 + 0.1]));
    for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) g.add(part(BOX, FABRIC, [0.2, 0.6, d], [x, 0.3, 0]));
  }
  return g;
}

/** A stool at a spot whose seat isn't part of its gear. */
const stool = () => { const g = new THREE.Group(); g.add(part(CYL, BLACK, [0.36, 0.06, 0.36], [0, 0.48, 0]), part(BOX, METAL, [0.04, 0.46, 0.04], [0, 0.23, 0])); return g; };

/** The room, built from its definition: what the scene adds once. */
export function roomModel(def: StudioDef): THREE.Group {
  const root = new THREE.Group(), [W, D] = def.size, H = def.height;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std(def.floor, { roughness: 0.85 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), std(def.walls, { roughness: 0.95, side: THREE.BackSide }));
  walls.position.y = H / 2 - 0.02;
  root.add(floor, walls);
  const wallMat = std(def.walls, { roughness: 0.95 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc6d8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.1 });
  for (const p of def.partitions) {
    const dx = p.to[0] - p.from[0], dz = p.to[1] - p.from[1], len = Math.hypot(dx, dz);
    const g = new THREE.Group();
    g.position.set((p.from[0] + p.to[0]) / 2, 0, (p.from[1] + p.to[1]) / 2);
    g.rotation.y = -Math.atan2(dz, dx);
    const slab = (y0: number, y1: number, m: THREE.Material) => g.add(part(BOX, m, [len, y1 - y0, PARTITION_T], [0, (y0 + y1) / 2, 0]));
    if (p.glass) { slab(0, p.glass.sill, wallMat); slab(p.glass.sill, p.glass.head, glass); slab(p.glass.head, H, wallMat); }
    else slab(0, H, wallMat);
    root.add(g);
  }
  for (const s of def.spots) {
    const r = gearRect(s), m = gearModel(s);
    m.position.set(r.cx, 0, r.cz);
    // its front (+z) toward the seat; the couch stands behind its seat, so its front faces the way you sit
    m.rotation.y = GEAR_AT[s.kind].ahead > 0 ? s.yaw : s.yaw + Math.PI;
    root.add(m);
    if (s.kind !== "couch") { const st = stool(); st.position.set(s.at[0], 0, s.at[1]); root.add(st); }
  }
  // a rug under the band
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), std(0x5a2a2e, { roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.004, 0.4);
  root.add(rug);
  return root;
}

/** The ring on the floor round the seat you'd sit in. */
export function seatRing(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 40), new THREE.MeshBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.8 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  return m;
}
