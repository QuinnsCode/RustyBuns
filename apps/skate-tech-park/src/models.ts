// The giant fingerboard and the rocket roadster, from three.js primitives: nothing to load or
// license. The roadster is packages/models; its ten nozzles are where the exhaust comes from.
// `dressBoard` and `dressRoadster` then swap in the ones modelled in Blender (blender/fingerboard.py, scripts/roadster.ts).
// Both face +z and stand on y = 0, so either one can be the skin over the same transform.
import { roadster as shared } from "@rustybuns/models";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOARD } from "./level.ts";
import { DEFAULT_PARTS, pickPart, type Parts } from "./parts.ts";

const mat = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export type Thruster = { group: "rear" | "lift" | "spinL" | "spinR"; mount: THREE.Object3D };

/** The shared roadster; `render/plumes.ts` draws the exhaust out of each nozzle's mount. */
export function roadster() {
  const car = shared();
  car.group.userData = { model: "roadster", thrusters: car.nozzles as Thruster[], plate: car.plate };
  return car.group;
}

/** Deck length and width, in metres: a fingerboard is about 3.5 times as long as it is wide. */
export const DECK = { length: BOARD.halfLen * 2, width: 1.25 };

const TOP = 0.52, THICK = 0.1, CONCAVE = 0.04, FLAT = 1.45, RISE = 0.34, NOSE = 0.6; // deck: top height, ply, dish, where the kick starts, how high it goes, end radius
const lift = (z: number) => (Math.abs(z) <= FLAT ? 0 : RISE * Math.min(1, (Math.abs(z) - FLAT) / (DECK.length / 2 - FLAT)) ** 1.6);
/** Half the deck's width at z: full along the middle, a round nose and tail. */
const halfWidth = (z: number) => {
  const d = (Math.abs(z) - (DECK.length / 2 - NOSE)) / NOSE;
  return (DECK.width / 2) * (d <= 0 ? 1 : Math.sqrt(Math.max(0, 1 - d * d)));
};

/** A dished, kicked sheet of the deck between two z, `drop` below the top, narrowed by `inset`, facing up or down. */
function sheet(z0: number, z1: number, rows: number, drop: number, inset: number, facing: 1 | -1) {
  const cols = 8, pos: number[] = [], idx: number[] = [];
  const at = (z: number, u: number) => [u * Math.max(0, halfWidth(z) - inset), TOP - drop + lift(z) + CONCAVE * u * u, z] as const;
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) pos.push(...at(z0 + ((z1 - z0) * i) / rows, (j / cols) * 2 - 1));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * (cols + 1) + j, b = a + cols + 1;
    idx.push(...(facing > 0 ? [a, b, a + 1, a + 1, b, b + 1] : [a, a + 1, b, a + 1, b + 1, b]));
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
}

/** Where the nose is, on the grip: an orange cap over the nose end and two chevrons pointing along +z, printed like an old-school
 * board's graphic. The deck is the same at both ends and there is no rider to tell nose from tail, so a board rolling backwards
 * (fakie) reads as the chevrons pointing back at where it's going. Sits just above the grip and follows the dish and kick. */
function noseMark() {
  const half = DECK.length / 2, cap = sheet(half - 0.75, half - 0.06, 4, -0.034, 0.1, 1);
  const pos: number[] = [], idx: number[] = [], SEG = 4;
  const at = (x: number, z: number) => [x, TOP + 0.034 + lift(z) + CONCAVE * (x / (DECK.width / 2)) ** 2, z] as const;
  for (const z0 of [0.65, 1.15]) for (const side of [-1, 1]) { // each chevron: two arms from the tip back to the edges
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, x = side * 0.5 * u, z = z0 - 0.4 * u; // the tip is at the middle, z0
      pos.push(...at(x, z), ...at(x, z - 0.15)); // 0.15 thick
    }
    for (let i = 0; i < SEG; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const arms = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
  return mergeGeometries([cap, arms])!;
}

/** The ply edge: a strip round the outline from the top face down to the underside. */
function edge(rows: number) {
  const pos: number[] = [], idx: number[] = [], half = DECK.length / 2;
  const ring: [number, number][] = []; // (z, side) once down one side and back up the other
  for (let i = 0; i <= rows; i++) ring.push([-half + (DECK.length * i) / rows, 1]);
  for (let i = rows; i >= 0; i--) ring.push([-half + (DECK.length * i) / rows, -1]);
  for (const [z, side] of ring) for (const drop of [0, THICK]) pos.push(side * halfWidth(z), TOP - drop + lift(z) + CONCAVE, z);
  for (let k = 0; k < ring.length - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)).setIndex(idx);
}

/** A truck, at z along the deck: riser, baseplate, kingpin, hanger, axle and nuts (steel), and the bushing (urethane). */
function truck(z: number) {
  const toward = z > 0 ? -1 : 1; // the kingpin leans in toward the middle of the board
  const steel: THREE.BufferGeometry[] = [], rubber: THREE.BufferGeometry[] = [];
  const put = (list: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, dz = 0) => list.push(g.translate(x, y, z + dz));
  put(rubber, new THREE.BoxGeometry(0.52, 0.03, 0.42), 0, 0.405); // riser pad
  put(steel, new THREE.BoxGeometry(0.5, 0.035, 0.4), 0, 0.372); // baseplate
  put(steel, new THREE.BoxGeometry(0.7, 0.1, 0.17), 0, 0.21); // hanger
  put(steel, new THREE.CylinderGeometry(0.028, 0.028, 1.24, 10).rotateZ(Math.PI / 2), 0, 0.19); // axle
  put(steel, new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8).rotateX(toward * 0.5), 0, 0.3, toward * 0.03); // kingpin
  put(rubber, new THREE.CylinderGeometry(0.08, 0.07, 0.07, 14), 0, 0.28, toward * 0.02); // bushing
  for (const x of [-1, 1]) put(steel, new THREE.CylinderGeometry(0.04, 0.04, 0.03, 8).rotateZ(Math.PI / 2), x * 0.625, 0.19); // axle nuts
  return { steel: mergeGeometries(steel)!, rubber: mergeGeometries(rubber)! };
}

/** A wheel's urethane (rounded lips, a hole for the core) and its core, both about an axle along x. */
const WHEEL = { r: 0.19, h: 0.11, x: 0.5 };
const tyre = () => new THREE.LatheGeometry([[0.1, -1], [WHEEL.r - 0.04, -1], [WHEEL.r - 0.012, -0.88], [WHEEL.r, -0.64], [WHEEL.r, 0.64], [WHEEL.r - 0.012, 0.88], [WHEEL.r - 0.04, 1], [0.1, 1]].map(([r, y]) => new THREE.Vector2(r!, y! * WHEEL.h)), 24).rotateZ(Math.PI / 2);
const core = () => new THREE.CylinderGeometry(0.105, 0.105, WHEEL.h * 2 + 0.014, 16).rotateZ(Math.PI / 2);

/**
 * One huge fingerboard, no rider, built like a real one: a pressed deck with a dished middle, kicked nose and
 * tail and a rounded outline, ply edge, grip on top; trucks with baseplate, kingpin and bushing; urethane wheels
 * on cores. `userData.paint(parts)` recolours it from the parts picker without rebuilding.
 */
export function fingerboard(parts: Parts = DEFAULT_PARTS) {
  const g = new THREE.Group(), half = DECK.length / 2;
  const mats = {
    deck: mat(0xffffff, 0.55), accent: mat(0xffffff, 0.6), edge: mat(0xd8b88a, 0.7), grip: mat(0xffffff, 0.95), mark: mat(0xff7a1a, 0.9),
    steel: mat(0xffffff, 0.3, 0.9), bushing: mat(0xffffff, 0.8), tyre: mat(0xffffff, 0.45), core: mat(0xffffff, 0.5),
  };
  const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, shadow = true) => {
    geo.computeVertexNormals();
    const o = new THREE.Mesh(geo, m);
    o.castShadow = shadow;
    o.receiveShadow = true;
    return o;
  };
  const nose = mesh(noseMark(), mats.mark, false);
  const flipper = new THREE.Group(); // what a kickflip turns: the deck and everything bolted to it
  const trucks = [truck(-0.95), truck(0.95)];
  const wheels = [-1, 1].flatMap((end) => [-1, 1].map((side) => ({ x: side * WHEEL.x, z: end * 0.95 })));
  const put = (geo: () => THREE.BufferGeometry) => mergeGeometries(wheels.map((w) => geo().translate(w.x, WHEEL.r, w.z)))!;
  flipper.add(
    mesh(sheet(-half, half, 60, THICK, 0, -1), mats.deck),
    mesh(sheet(-0.45, 0.45, 6, THICK + 0.004, 0.06, -1), mats.accent, false),
    mesh(edge(60), mats.edge),
    mesh(sheet(-half, half, 60, -0.025, 0.03, 1), mats.grip),
    nose,
    mesh(mergeGeometries(trucks.map((t) => t.steel))!, mats.steel),
    mesh(mergeGeometries(trucks.map((t) => t.rubber))!, mats.bushing),
    mesh(put(tyre), mats.tyre),
    mesh(put(core), mats.core, false),
  );
  for (const m of flipper.children as THREE.Mesh[]) (m.material as THREE.Material).side = THREE.DoubleSide;
  const paint = (p: Parts) => {
    const d = pickPart("deck", p.deck), t = pickPart("trucks", p.trucks), w = pickPart("wheels", p.wheels);
    mats.deck.color.setHex(d.color);
    mats.accent.color.setHex(d.accent);
    mats.grip.color.setHex(pickPart("grip", p.grip).color);
    mats.steel.color.setHex(t.color);
    Object.assign(mats.steel, { metalness: t.metal, roughness: t.rough });
    mats.bushing.color.setHex(t.bushing);
    mats.tyre.color.setHex(w.color);
    mats.core.color.setHex(w.core);
  };
  paint(parts);
  g.add(flipper);
  g.userData = { model: "fingerboard", flipper, paint, mats, nose };
  return g;
}

/** The modelled board's polygon budgets (triangles), from blender/fingerboard.py. */
export const BOARD_BUDGETS = ["hi", "mid", "low"] as const;
export type BoardBudget = (typeof BOARD_BUDGETS)[number];

/** A GLB's meshes, each with its transform baked into its geometry. */
async function glbMeshes(glb: ArrayBuffer | string) {
  const loader = new GLTFLoader();
  const gltf = typeof glb === "string" ? await loader.loadAsync(glb) : await loader.parseAsync(glb, "");
  const meshes: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const out = new THREE.Mesh(m.geometry.applyMatrix4(m.matrixWorld), m.material);
    out.castShadow = out.receiveShadow = true;
    meshes.push(out);
  });
  return meshes;
}

/**
 * Swap the built board's meshes for the Blender model, a glTF whose materials are named after the picker's
 * slots, so they take the board's own materials and `paint` keeps working. The built meshes stay if it fails.
 */
export async function dressBoard(board: THREE.Group, glb: ArrayBuffer | string) {
  const meshes = await glbMeshes(glb);
  const { flipper, mats, nose } = board.userData as { flipper: THREE.Group; mats: Record<string, THREE.Material>; nose: THREE.Object3D };
  if (!meshes.length) return false;
  flipper.clear();
  flipper.add(nose); // the modelled grip has no nose from tail either
  for (const m of meshes) {
    m.material = mats[(m.material as THREE.Material).name] ?? m.material;
    flipper.add(m);
  }
  return true;
}

/** The modelled roadster's polygon budgets, from scripts/roadster.ts. */
export const ROADSTER_BUDGETS = ["hi", "mid", "low"] as const;
export type RoadsterBudget = (typeof ROADSTER_BUDGETS)[number];

/**
 * Swap the shared roadster's body, glass, lights and wheels for the Blender model, keeping its nozzle bells
 * (the plumes come out of their mounts) and its hinged plate. The shared body stays if it fails.
 */
export async function dressRoadster(car: THREE.Group, glb: ArrayBuffer | string) {
  const meshes = await glbMeshes(glb);
  if (!meshes.length) return false;
  const { thrusters, plate } = car.userData as { thrusters: Thruster[]; plate: THREE.Object3D };
  const keep = new Set<THREE.Object3D>([plate, ...thrusters.map((t) => t.mount.parent!)]);
  for (const o of [...car.children]) if (!keep.has(o)) car.remove(o);
  car.add(...meshes);
  return true;
}
