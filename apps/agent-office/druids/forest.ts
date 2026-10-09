// 🌲 The office, retold as the jungle where every race of Druids Curse gathers in council.
//
// rustybunsify.ts adds one call at the end of the office's per-frame update (after its sky and mood have set the
// lights), `globalThis.__rbOfficeTick?.(app, stage, dt, t)`. From there this recolours the room (palette.ts),
// lays moss on the floor and leaves overhead, grows the jungle up the walls (jungle.ts), scatters the game's
// stumps, flowers and mushrooms, lights a council fire in the biggest clearing, and lets fireflies loose. Nothing the office does is changed:
// colliders, desks and seats are all where they were, and it only ever adds or recolours.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, Group, Box3, Mesh,
  Object3D, PointLight, Points, PointsMaterial, RepeatWrapping, SRGBColorSpace, Vector3,
  type WebGLRenderer, type HemisphereLight, type AmbientLight, type DirectionalLight, type Material, type Scene, type Fog,
} from "three";
import { FOREST } from "./assets.ts";
import { decoders, gltf } from "./loader.ts";
import { forestColor } from "./palette.ts";
import { jungle, outerJungle } from "./jungle.ts";
import { council, turn, type Office } from "./council.ts";
import { firstPerson, type Viewer } from "./people.ts";
import { LOFT, ROAD, ROOM, STREET_Y, type Box } from "./room.ts";

interface App extends Viewer { office: Office; renderer: WebGLRenderer }
interface Stage { scene: Scene; hemi: HemisphereLight; ambient: AmbientLight; sun: DirectionalLight }

const MOSS = new Color("#6f8f3a"), CANOPY = new Color("#cfe6a0"), DUSK = new Color("#9bb08a");

/** Deterministic, so everyone in the office sees the same forest. */
function rng(seed: number) {
  return () => ((seed = Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32;
}

let built: Group | null = null;
let fireflies: Points | null = null;
let fire: PointLight | null = null;
let growing: { update(t: number): void }[] = [];
let sweepAt = 0;
const seen = new WeakSet<object>();

(globalThis as { __rbOfficeTick?: unknown }).__rbOfficeTick = (app: App, stage: Stage, dt: number, t: number) => {
  decoders(app.renderer);
  (globalThis as { __rbOffice?: App }).__rbOffice = app; // for poking at from the console
  // the office's mood has just set the lights for its time of day; lean them into the wood
  stage.hemi.color.lerp(CANOPY, 0.45);
  stage.hemi.groundColor.lerp(MOSS, 0.6);
  stage.ambient.color.lerp(DUSK, 0.35);
  (stage.scene.fog as Fog | null)?.color.lerp(DUSK, 0.4);

  if (built?.parent !== app.office.group) {
    built = new Group();
    built.name = "druids-forest";
    app.office.group.add(built);
    plant(built, app.office.colliders);
    council(built, app.office);
  }
  if (t > sweepAt) {
    // new desks, laptops and floors arrive while the office runs; recolour whatever's new now and then
    sweepAt = t + 2;
    recolour(app.office.group);
  }
  if (fire) fire.intensity = 14 + Math.sin(t * 11) * 2 + Math.sin(t * 3.7) * 3;
  if (fireflies) drift(fireflies, t);
  for (const g of growing) g.update(t);
  turn(dt);
  firstPerson(app, stage.scene);
};

// ---- colour ---------------------------------------------------------------------------------------------

const box = new Box3(), size = new Vector3(), centre = new Vector3();

function recolour(root: Object3D) {
  root.updateMatrixWorld();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || seen.has(m) || skipped(m)) return;
    seen.add(m);
    m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
    box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
    box.getSize(size);
    box.getCenter(centre);
    const inside = centre.x > ROOM.minX - 0.5 && centre.x < ROOM.maxX + 0.5 && centre.z > ROOM.minZ - 0.5 &&
      centre.z < ROOM.maxZ + 0.5 && centre.y > -0.5 && centre.y < ROOM.top + 0.6;
    if (!inside) return;
    const wall = size.y > 2.5 && Math.min(size.x, size.z) < 0.6;
    const plane = size.x > 30 && size.z > 20 && size.y < 0.1;
    for (const mat of [m.material].flat()) retell(mat as Material & { color?: Color; map?: unknown }, wall, plane && centre.y < 1, plane && centre.y > 5);
  });
}

function skipped(o: Object3D) {
  for (let p: Object3D | null = o; p; p = p.parent) if (p.userData.rbForest === "skip") return true;
  return false;
}

function retell(mat: Material & { color?: Color; map?: unknown; needsUpdate: boolean }, wall: boolean, floor: boolean, ceiling: boolean) {
  if (seen.has(mat) || !mat.color) return;
  seen.add(mat);
  if (floor || ceiling) {
    const tex = new CanvasTexture(floor ? mossCanvas() : canopyCanvas());
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(floor ? 9 : 6, floor ? 6.5 : 4.5);
    tex.colorSpace = SRGBColorSpace;
    (mat as { map: unknown }).map = tex;
    mat.color.set("#ffffff");
    mat.needsUpdate = true;
    return;
  }
  if (mat.map) return; // screens, signs, boards and posters stay readable
  if (mat.transparent) {
    mat.color.lerp(new Color("#bcd9a4"), 0.5); // the glass catches the green
    return;
  }
  mat.color.setHex(forestColor(mat.color.getHex(), wall ? "wall" : "thing"));
}

function mossCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!, r = rng(7);
  g.fillStyle = "#4f6b2c";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const tone = r();
    g.fillStyle = tone < 0.55 ? `hsl(${80 + r() * 30},${35 + r() * 25}%,${22 + r() * 18}%)`
      : tone < 0.8 ? `hsl(${30 + r() * 15},${30 + r() * 20}%,${18 + r() * 14}%)` // leaf litter
      : `hsl(${95 + r() * 20},45%,${38 + r() * 14}%)`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 2.5, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function canopyCanvas() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!, r = rng(11);
  g.fillStyle = "#e9f3c7"; // sky through the gaps
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `hsl(${85 + r() * 40},${30 + r() * 30}%,${16 + r() * 22}%)`;
    g.beginPath();
    g.ellipse(r() * 256, r() * 256, 4 + r() * 12, 2 + r() * 6, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// ---- the forest ------------------------------------------------------------------------------------------

const model = (path: string) => gltf(path).then((g) => g.scene);

/** A copy of a model, `height` tall, standing at (x, y, z). */
async function place(into: Group, path: string, x: number, y: number, z: number, height: number, turn: number) {
  try {
    const o = (await model(path)).clone();
    const b = new Box3().setFromObject(o), s = b.getSize(new Vector3());
    const k = height / (s.y || 1);
    o.scale.setScalar(k);
    o.position.set(x, y - b.min.y * k, z);
    o.rotation.y = turn;
    o.traverse((m) => {
      m.userData.rbForest = "skip";
      if (!(m as Mesh).isMesh) return;
      m.castShadow = m.receiveShadow = true;
      // the office inks every edge; on the game's dense meshes that's grey static, so leave them clean
      for (const mat of [(m as Mesh).material].flat()) mat.userData.outlineParameters = { visible: false };
    });
    into.add(o);
  } catch (e) {
    console.warn(`[druids] ${path} didn't load`, e);
  }
}

function plant(into: Group, colliders: Box[]) {
  const solid = colliders.filter((c) => c.top > 0.05 && c.bottom < 2.5 && (c.maxX - c.minX) * (c.maxZ - c.minZ) < 200);
  /** No collider within r of (x, z). */
  const clear = (x: number, z: number, r: number) =>
    !solid.some((c) => x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r);
  const inRoom = (x: number, z: number, m = 0) =>
    x > ROOM.minX + m && x < ROOM.maxX - m && z > ROOM.minZ + m && z < ROOM.maxZ - m;
  const underLoft = (x: number, z: number) => x > LOFT.minX - 0.5 && z > LOFT.minZ - 0.5;
  const r = rng(1337);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

  // the jungle up every wall and grass over the floor
  const inside = jungle(colliders);
  const outside = outerJungle(STREET_Y, (x, z) => !inRoom(x, z, -7) && !(z > ROAD.minZ && z < ROAD.maxZ) && clear(x, z, 1.5));
  into.add(inside, outside);
  growing = [inside, outside];

  // the game's own stumps, logs and stones against the walls, and its flowers and mushrooms on the floor
  for (let n = 0, tries = 0; n < 24 && tries < 2000; tries++) {
    const side = Math.floor(r() * 4), t = r();
    const x = side < 2 ? ROOM.minX + 1 + t * 34 : side === 2 ? ROOM.minX + 1.3 : ROOM.maxX - 1.3;
    const z = side >= 2 ? ROOM.minZ + 1 + t * 24 : side === 0 ? ROOM.minZ + 1.3 : ROOM.maxZ - 1.3;
    if (underLoft(x, z) || !clear(x, z, 0.5)) continue;
    place(into, pick(FOREST.edge), x, 0, z, 0.45 + r() * 0.4, r() * 6.3);
    n++;
  }
  for (let n = 0, tries = 0; n < 60 && tries < 3000; tries++) {
    const x = ROOM.minX + r() * (ROOM.maxX - ROOM.minX), z = ROOM.minZ + r() * (ROOM.maxZ - ROOM.minZ);
    if (!inRoom(x, z, 1) || !clear(x, z, 0.45)) continue;
    place(into, pick(FOREST.ground), x, 0, z, 0.25 + r() * 0.3, r() * 6.3);
    n++;
  }

  // the council fire, in the widest clearing
  let best = { x: 0, z: 0, d: 0 };
  for (let x = ROOM.minX + 2; x < ROOM.maxX - 2; x += 0.5)
    for (let z = ROOM.minZ + 2; z < ROOM.maxZ - 2; z += 0.5) {
      if (underLoft(x, z)) continue;
      let d = 0;
      while (d < 4 && clear(x, z, d + 0.25)) d += 0.25;
      if (d > best.d) best = { x, z, d };
    }
  if (best.d >= 1) {
    place(into, FOREST.hearth, best.x, 0, best.z, Math.min(1.6, best.d), 0);
    fire = new PointLight("#ff9a3c", 14, 10, 1.6);
    fire.position.set(best.x, 0.9, best.z);
    into.add(fire);
  }

  // the wood outside, on the street below, clear of the road
  for (let n = 0, tries = 0; n < 40 && tries < 4000; tries++) {
    const x = -70 + r() * 140, z = -55 + r() * 110;
    if (inRoom(x, z, -6) || (z > ROAD.minZ && z < ROAD.maxZ) || !clear(x, z, 1.5)) continue;
    place(into, pick(FOREST.wood), x, STREET_Y, z, 9 + r() * 7, r() * 6.3);
    n++;
  }
  place(into, FOREST.beacon, 0, STREET_Y, ROOM.minZ - 12, 9, 0);

  fireflies = swarm();
  into.add(fireflies);
}

// ---- fireflies -------------------------------------------------------------------------------------------

const FLIES = 160;
let home: Float32Array;

function swarm() {
  const r = rng(99);
  home = new Float32Array(FLIES * 4);
  for (let i = 0; i < FLIES; i++)
    home.set([ROOM.minX + r() * 36, 0.4 + r() * 3.4, ROOM.minZ + r() * 26, r() * 100], i * 4);
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(FLIES * 3), 3));
  const p = new Points(g, new PointsMaterial({
    color: "#e4ff8a", size: 0.07, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false,
  }));
  p.frustumCulled = false;
  p.userData.rbForest = "skip";
  return p;
}

function drift(p: Points, t: number) {
  const pos = p.geometry.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < FLIES; i++) {
    const [x, y, z, s] = home.subarray(i * 4, i * 4 + 4);
    pos.setXYZ(i, x + Math.sin(t * 0.3 + s) * 0.8, y + Math.sin(t * 0.7 + s * 2) * 0.25, z + Math.cos(t * 0.25 + s) * 0.8);
  }
  pos.needsUpdate = true;
  (p.material as PointsMaterial).opacity = 0.6 + Math.sin(t * 2) * 0.25;
}
