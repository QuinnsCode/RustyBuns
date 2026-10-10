// 🧙 The council's furniture: every agent desk becomes a Druid Panel, the elevator becomes the game's scene-travel
// portal, the game's loot is strewn about like a gamer's den, and the Council Chambers and a village stand outside.
// Everything the office does still works: the laptops stay where they were (on top of the panels now), the
// elevator still opens and rides. The one collider it touches is each desk's, cut down to its panel (fitDesks).
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Object3D, Vector3, type Material } from "three";
import { COUNCIL } from "./assets.ts";
import { gltf } from "./loader.ts";
import { ROOM, STREET_Y, fitDesks, type Box } from "./room.ts";

interface Desk {
  def: { id: string; x: number; z: number; rotY: number };
  group: Object3D;
  laptopAnchor: Object3D;
  seatAnchor: Object3D;
  stage: Object3D;
  vacancy: Object3D;
  vacancyY: number;
  chair: Object3D;
}
export interface Office {
  group: Group;
  colliders: Box[];
  desks: Map<string, Desk>;
  elevator: { group: Object3D; colliders: Box[] };
}

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** A copy of a model, sized so its longest side (or its height) is `size`, sitting on y = 0 in its parent. */
async function copy(path: string, size: number, by: "height" | "longest" = "longest") {
  const o = (await gltf(path)).scene.clone();
  const s = new Box3().setFromObject(o).getSize(new Vector3());
  o.scale.setScalar(size / ((by === "height" ? s.y : Math.max(s.x, s.y, s.z)) || 1));
  const b = new Box3().setFromObject(o);
  o.position.y = -b.min.y;
  const holder = new Group();
  holder.add(o);
  holder.traverse((m) => {
    m.userData.rbForest = "skip";
    if (!(m as Mesh).isMesh) return;
    m.castShadow = m.receiveShadow = true;
    for (const mat of [(m as Mesh).material].flat() as Material[]) mat.userData.outlineParameters = { visible: false };
  });
  return holder;
}

/** A Druid Panel sits over a pod of two back-to-back desks (2.2 m square), 10% smaller so it doesn't crowd the
 *  room, and the desks' colliders are cut down to match; its top is where the laptops sit, a bit under twice the office's desk height, for
 *  agents twice the office's size. */
const PANEL = { width: 1.98, top: 1.4 };
/** Where each loaded panel stands, for fitDesks. */
const footprints: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
let swirl: Object3D | null = null;
const axis = new Vector3(0, 0, 1);

/** Which way a flat disc faces: its average normal, in world space (or its own space). */
function discNormal(m: Mesh, world = true) {
  const nrm = m.geometry.getAttribute("normal"), v = new Vector3(), sum = new Vector3();
  for (let i = 0; i < nrm.count; i++) sum.add(v.fromBufferAttribute(nrm, i));
  sum.normalize();
  if (world) { m.updateWorldMatrix(true, false); sum.transformDirection(m.matrixWorld); sum.y = 0; sum.normalize(); }
  return sum;
}

export function council(into: Group, office: Office) {
  const r = rng(2024);
  const loot = COUNCIL.loot;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  // agent desks (and the board agents' kiosks) → Druid Panels: one panel per pod of two back-to-back desks, as big
  // as the pod, and each laptop up on top of it
  const pods = new Set<string>();
  footprints.length = 0;
  for (const d of office.desks.values()) {
    if (!/^(desk|station)-/.test(d.def.id)) continue;
    const keep = new Set([d.laptopAnchor, d.seatAnchor, d.stage, d.vacancy]);
    for (const c of d.group.children) if (!keep.has(c)) c.visible = false;
    d.laptopAnchor.position.y = PANEL.top;
    // the office bobs the vacancy plus at desk height + 0.55, which is inside the panel: lift it over the top
    d.vacancyY = PANEL.top + 0.55;

    // the pod's middle: half a desk away from where this desk's agent stands
    const centre = d.group.localToWorld(new Vector3(0, 0, -Math.sign(d.seatAnchor.position.z || 1) * 0.55));
    const key = `${centre.x.toFixed(1)},${centre.z.toFixed(1)}`;
    if (!pods.has(key)) {
      pods.add(key);
      copy(COUNCIL.panel, PANEL.width).then((p) => {
        p.scale.y *= PANEL.top / (new Box3().setFromObject(p).getSize(new Vector3()).y || 1);
        p.position.set(centre.x, 0, centre.z);
        p.rotation.y = d.def.rotY;
        into.add(p);
        const b = new Box3().setFromObject(p);
        footprints.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
        fitDesks(office.colliders, footprints, PANEL.top);
      }).catch((e) => console.warn("[druids] the Druid Panel didn't load", e));
    }

    // and some loot on it, either side of the laptop
    for (let n = 0; n < 1 + Math.floor(r() * 3); n++) {
      const side = r() < 0.5 ? -1 : 1;
      copy(pick(loot.small), 0.2 + r() * 0.16).then((o) => {
        o.position.set(d.laptopAnchor.position.x + side * (0.36 + r() * 0.27), PANEL.top, d.laptopAnchor.position.z + (r() - 0.5) * 0.4);
        o.rotation.y = r() * 6.28;
        d.group.add(o);
      });
    }
    if (r() < 0.35) copy(COUNCIL.staff, 2, "longest").then((o) => {
      // leaning on the panel's corner
      o.position.set(d.laptopAnchor.position.x + PANEL.width / 2 - 0.05, 0, d.laptopAnchor.position.z + 0.2);
      o.rotation.set(0.2, r() * 6.28, 0.15);
      d.group.add(o);
    });
  }

  // the elevator → the portal: the arch in front of its doors, the swirl facing the room
  const shaft = office.elevator.colliders;
  if (shaft.length) {
    // the doors are in the middle of the shaft's front, whether they're open or shut right now
    const x = (Math.min(...shaft.map((c) => c.minX)) + Math.max(...shaft.map((c) => c.maxX))) / 2;
    const z = Math.max(...shaft.map((c) => c.maxZ));
    copy(COUNCIL.portal, 3.1, "height").then((p) => {
      const disc = p.getObjectByName("swirl") as Mesh | undefined;
      if (disc) {
        // turn the arch so the swirl faces into the room (+z), then stand it with its back to the elevator
        const n = discNormal(disc);
        p.rotation.y = Math.atan2(n.x, n.z) * -1;
        const src = disc.material as MeshStandardMaterial;
        const glow = src.clone();
        glow.emissive = new Color(0xffffff);
        glow.emissiveMap = src.map;
        glow.emissiveIntensity = 0.6;
        disc.material = glow;
        swirl = disc;
        axis.copy(discNormal(disc, false));
      }
      p.updateMatrixWorld(true);
      const b = new Box3().setFromObject(p);
      p.position.set(x - (b.min.x + b.max.x) / 2, 0, z + 0.05 - b.min.z);
      into.add(p);
    }).catch((e) => console.warn("[druids] the portal didn't load", e));
  }

  // loot everywhere: on the floor, in heaps, like nobody's tidied since the raid
  const solid = office.colliders.filter((c) => c.top > 0.05 && c.bottom < 2.5 && (c.maxX - c.minX) * (c.maxZ - c.minZ) < 200);
  const clear = (x: number, z: number, rad: number) =>
    !solid.some((c) => x > c.minX - rad && x < c.maxX + rad && z > c.minZ - rad && z < c.maxZ + rad);
  for (let n = 0, tries = 0; n < 110 && tries < 4000; tries++) {
    const x = ROOM.minX + 1 + r() * 34, z = ROOM.minZ + 1 + r() * 24;
    if (!clear(x, z, 0.3)) continue;
    const big = r() < 0.2;
    copy(big ? pick(loot.big) : pick(loot.small), big ? 0.7 + r() * 0.5 : 0.2 + r() * 0.2).then((o) => {
      o.position.set(x, 0, z);
      o.rotation.set((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4);
      into.add(o);
    });
    n++;
  }

  // outside: the Council Chambers past the west windows, and a village across the road
  copy(COUNCIL.chambers, 22, "longest").then((o) => { o.position.set(ROOM.minX - 26, STREET_Y, -2); o.rotation.y = Math.PI / 2; into.add(o); });
  for (let i = 0; i < 6; i++)
    copy(COUNCIL.hut, 7 + r() * 3, "longest").then((o) => { o.position.set(-24 + i * 9 + r() * 3, STREET_Y, 38 + r() * 8); o.rotation.y = r() * 6.28; into.add(o); });
}

/** Now and then: the back office's desks, once their row is built, get cut down to their panels too. */
export function refit(office: Office) {
  fitDesks(office.colliders, footprints, PANEL.top);
}

/** Every frame: the swirl turns. */
export function turn(dt: number) {
  swirl?.rotateOnAxis(axis, -dt * 0.65);
}
