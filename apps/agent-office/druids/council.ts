// 🧙 The council's furniture: every agent desk becomes a Druid Panel, the game's loot is strewn about like a
// gamer's den, and the Council Chambers and a village stand outside. The elevator stays the office's own.
// Everything the office does still works: the laptops ride on the panels (each tilted with its slab), the
// elevator still opens and rides. The one collider it touches is each desk's, cut down to its lectern (fitDesks).
import { Box3, Group, Mesh, Object3D, Raycaster, Vector3, type Material } from "three";
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

/** A Druid Panel is a lectern: a tilted slab on a pillar, low edge towards whoever reads it. Every agent gets its
 *  own, turned to face them, with the back-to-back pair's lecterns standing in their pod; its top is about twice the
 *  office's desk height, for agents twice the office's size. The laptop lies on the slab like a book on a lectern,
 *  tilted with it and half sunk into the wood. */
const PANEL = { width: 1.2, top: 1.4, z: -0.05, sink: 0.06 };
const down = new Vector3(0, -1, 0), ray = new Raycaster();
/** Where each loaded lectern stands, for fitDesks: the desk's collider is cut down to it. */
const footprints: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];

/** How high the panel's top is under (x, z) in `space`: the median of five rays `spread` apart, so a carved notch
 *  under one corner doesn't drop what sits there (the panel's full height if they all miss). */
function on(panel: Object3D, space: Object3D, x: number, z: number, spread = 0) {
  panel.updateMatrixWorld(true);
  const ys = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dz]) => {
    ray.set(space.localToWorld(new Vector3(x + dx! * spread, 10, z + dz! * spread)), down);
    const hit = ray.intersectObject(panel, true)[0];
    return hit ? space.worldToLocal(hit.point).y : PANEL.top;
  }).sort((a, b) => a - b);
  return ys[2]!;
}

export function council(into: Group, office: Office) {
  const r = rng(2024);
  const loot = COUNCIL.loot;
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;

  // agent desks (and the board agents' kiosks) → Druid Panels, a lectern each, and each laptop on its slab
  footprints.length = 0;
  for (const d of office.desks.values()) {
    if (!/^(desk|station)-/.test(d.def.id)) continue;
    const keep = new Set([d.laptopAnchor, d.seatAnchor, d.stage, d.vacancy]);
    for (const c of d.group.children) if (!keep.has(c)) c.visible = false;
    // the office bobs the vacancy plus at desk height + 0.55, which is inside the panel: lift it over the top
    d.vacancyY = PANEL.top + 0.55;

    // the agent stands on this side of the desk; the slab's low edge (the model's +z) faces them
    const toward = Math.sign(d.seatAnchor.position.z || 1);
    const laptop = d.laptopAnchor;
    laptop.position.set(laptop.position.x, PANEL.top, toward * PANEL.z);
    const spots = Array.from({ length: 1 + Math.floor(r() * 3) }, () =>
      ({ path: pick(loot.small), size: 0.2 + r() * 0.16, x: (r() < 0.5 ? -1 : 1) * (0.32 + r() * 0.2), z: toward * (PANEL.z + (r() - 0.5) * 0.3), turn: r() * 6.28 }));
    copy(COUNCIL.panel, PANEL.width).then(async (p) => {
      p.scale.y *= PANEL.top / (new Box3().setFromObject(p).getSize(new Vector3()).y || 1);
      p.position.set(0, 0, toward * PANEL.z);
      p.rotation.y = toward > 0 ? 0 : Math.PI;
      d.group.add(p);
      p.updateWorldMatrix(true, true);
      const b = new Box3().setFromObject(p);
      footprints.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
      fitDesks(office.colliders, footprints, PANEL.top);

      // lie the laptop along the slab: its pitch from the slab's height a little behind and in front of it
      const { x, z } = laptop.position, step = 0.12;
      const back = on(p, d.group, x, z - toward * step, 0.08), front = on(p, d.group, x, z + toward * step, 0.08);
      laptop.rotation.x = toward * Math.atan2(back - front, 2 * step);
      laptop.position.y = (back + front) / 2 - PANEL.sink;

      // and some loot either side of it, wherever the panel is under them
      for (const s of spots) {
        const o = await copy(s.path, s.size);
        o.position.set(laptop.position.x + s.x, on(p, d.group, laptop.position.x + s.x, s.z), s.z);
        o.rotation.y = s.turn;
        d.group.add(o);
      }
    }).catch((e) => console.warn("[druids] the Druid Panel didn't load", e));
    if (r() < 0.35) copy(COUNCIL.staff, 2, "longest").then((o) => {
      // leaning on the panel's corner
      o.position.set(d.laptopAnchor.position.x + PANEL.width / 2 - 0.05, 0, d.laptopAnchor.position.z + 0.2);
      o.rotation.set(0.2, r() * 6.28, 0.15);
      d.group.add(o);
    });
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

/** Now and then: the back office's desks, once their row is built, get cut down to their lecterns too. */
export function refit(office: Office) {
  fitDesks(office.colliders, footprints, PANEL.top);
}
