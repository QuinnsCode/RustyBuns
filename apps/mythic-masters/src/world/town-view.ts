// A town (towns.ts) drawn: its three rooms inside, and its row of fronts on the open ground. The inside is its own
// small scene, lit by its own lamps, shown while you are in it and dropped when you walk out (view.ts). Walls face in,
// so a camera behind one still sees into the room, like a doll's house.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BOARD, CEILING, DEEP, DOORWAYS, FRONT, PROPS, ROOMS, type Prop, type Room, type Town } from "./towns.ts";

/** Each room's look: floor, walls, its light and its sign. */
const LOOK: Record<Room["id"], { floor: number; wall: number; light: number; power: number; sign: string; front: number; neon: string }> = {
  gas: { floor: 0x9a9a92, wall: 0xd8d4c4, light: 0xeef6ff, power: 30, sign: "GAS", front: 0xe4e0d4, neon: "#ff5a3a" },
  diner: { floor: 0x2a2a2a, wall: 0xb8463a, light: 0xffd8a0, power: 34, sign: "DINER", front: 0xc8c8cc, neon: "#ff6aa8" },
  motel: { floor: 0x5a4a3a, wall: 0x4a7a78, light: 0xffc890, power: 24, sign: "MOTEL", front: 0x6a9a96, neon: "#5ae0d0" },
};
const PROP_COLOR: Record<string, number> = { counter: 0xd8d0c0, booth: 0x9a2a2a, shelf: 0x6a7a8a, cooler: 0xb8d8e8, till: 0x3a3a3a, desk: 0x6a4a2a, couch: 0x5a6a3a };
const PERSON: Record<string, number> = { cook: 0xf0f0e8, clerk: 0x2a5aa8, manager: 0x6a3a6a, witness: 0x8a6a3a };

/** A word in lit letters on a dark board, as a texture: the rooms' signs. */
function signTexture(word: string, color: string): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const x = c.getContext("2d");
  if (!x) return null;
  x.fillStyle = "#141018"; x.fillRect(0, 0, 256, 64);
  x.font = "bold 44px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = color; x.shadowBlur = 14; x.fillStyle = color; x.fillText(word, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const signs = new Map<string, THREE.Material>();
const signMat = (id: Room["id"]) => {
  let m = signs.get(id);
  if (!m) { const l = LOOK[id], t = signTexture(l.sign, l.neon); m = new THREE.MeshBasicMaterial(t ? { map: t } : { color: 0x141018 }); signs.set(id, m); }
  return m;
};

/** A wall from (x0, z0) to (x1, z1), `h` tall, facing the side its normal `n` points to (into the room). */
function wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, n: [number, number]) {
  const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.PlaneGeometry(len, y1 - y0);
  g.rotateY(Math.atan2(n[0], n[1]));
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** A wall along x at z with gaps (each [from, to] in x, `top` the gap's height), facing `n`. */
function wallWithGaps(x0: number, x1: number, z: number, gaps: [number, number, number][], n: 1 | -1) {
  const parts: THREE.BufferGeometry[] = [];
  let at = x0;
  for (const [a, b, top] of gaps) { if (a > at) parts.push(wall(at, z, a, z, 0, CEILING, [0, n])); parts.push(wall(a, z, b, z, top, CEILING, [0, n])); at = b; }
  if (x1 > at) parts.push(wall(at, z, x1, z, 0, CEILING, [0, n]));
  return parts;
}
/** The same along z at x. */
function sideWithGaps(x: number, z0: number, z1: number, gaps: [number, number, number][], n: 1 | -1) {
  const parts: THREE.BufferGeometry[] = [];
  let at = z0;
  for (const [a, b, top] of gaps) { if (a > at) parts.push(wall(x, at, x, a, 0, CEILING, [n, 0])); parts.push(wall(x, a, x, b, top, CEILING, [n, 0])); at = b; }
  if (z1 > at) parts.push(wall(x, at, x, z1, 0, CEILING, [n, 0]));
  return parts;
}
const box = (p: Prop) => new THREE.BoxGeometry(p.x1 - p.x0, p.h, p.z1 - p.z0).translate((p.x0 + p.x1) / 2, p.h / 2, (p.z0 + p.z1) / 2);

/** The inside of town `t`, in its own local metres (the front door at the origin, the street toward +z), and the tick
 * that hums its lights. */
export function buildTown(t: Town): { group: THREE.Group; tick: (time: number) => void; dispose: () => void } {
  const group = new THREE.Group(), lamps: THREE.PointLight[] = [];
  group.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2420, 0.6));
  for (const r of ROOMS) {
    const l = LOOK[r.id], mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(-Math.PI / 2).translate((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2), mat(l.floor));
    floor.receiveShadow = true;
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0).rotateX(Math.PI / 2).translate((r.x0 + r.x1) / 2, CEILING, (r.z0 + r.z1) / 2), mat(0xe8e4d8));
    // walls: the back, the front (the diner's with its door, all of them with a window), and the two sides with their doorways
    const door: [number, number, number][] = r.id === "diner" ? [[-4.6, -2.2, 2.6], [FRONT.x0, FRONT.x1, 2.3], [2.2, 4.6, 2.6]] : [[r.x0 + 2, r.x1 - 2, 2.6]];
    const through = (x: number): [number, number, number][] => DOORWAYS.filter((d) => d.x === x).map((d) => [d.z0, d.z1, 2.3]);
    const walls = mergeGeometries([
      wall(r.x0, -DEEP, r.x1, -DEEP, 0, CEILING, [0, 1]),
      ...wallWithGaps(r.x0, r.x1, 0, door, -1),
      ...sideWithGaps(r.x0, -DEEP, 0, through(r.x0), 1),
      ...sideWithGaps(r.x1, -DEEP, 0, through(r.x1), -1),
    ]);
    // windows' sills: a low wall under each front gap
    const sills = door.filter(([a, b]) => b - a > 2).map(([a, b]) => wall(a, 0, b, 0, 0, 0.9, [0, -1]));
    group.add(floor, ceiling, new THREE.Mesh(walls ?? new THREE.BufferGeometry(), mat(l.wall)));
    if (sills.length) group.add(new THREE.Mesh(mergeGeometries(sills) ?? new THREE.BufferGeometry(), mat(l.wall)));
    // the night outside the windows
    const night = new THREE.Mesh(new THREE.PlaneGeometry(r.x1 - r.x0, CEILING).translate((r.x0 + r.x1) / 2, CEILING / 2, 0.6).rotateY(0), new THREE.MeshBasicMaterial({ color: 0x0c1220, side: THREE.BackSide }));
    group.add(night);
    // its sign, over the inside of the front wall's window, read from within
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6).rotateY(Math.PI).translate((r.x0 + r.x1) / 2 + (r.id === "diner" ? 3.4 : 0), 2.85, -0.05), signMat(r.id));
    group.add(sign);
    const lamp = new THREE.PointLight(l.light, l.power, 16, 1.4);
    lamp.position.set((r.x0 + r.x1) / 2, CEILING - 0.3, -DEEP / 2);
    group.add(lamp); lamps.push(lamp);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.25), new THREE.MeshBasicMaterial({ color: l.light }));
    tube.position.copy(lamp.position).setY(CEILING - 0.04);
    group.add(tube);
  }
  // the furniture
  const byKind = new Map<string, THREE.BufferGeometry[]>();
  for (const p of PROPS) byKind.set(p.what, [...(byKind.get(p.what) ?? []), box(p)]);
  for (const [what, gs] of byKind) {
    const m = new THREE.Mesh(mergeGeometries(gs) ?? gs[0]!, new THREE.MeshStandardMaterial({ color: PROP_COLOR[what] ?? 0x888888, roughness: 0.7, emissive: what === "cooler" ? 0x3a5a6a : 0 }));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  // the board on the diner's back wall: cork in a frame, with the reports pinned on it
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 0.08), new THREE.MeshStandardMaterial({ color: 0xc89b5e, roughness: 1 }));
  board.position.set(BOARD.x, 1.6, BOARD.z + 0.05);
  const papers = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.42, 0.55), new THREE.MeshStandardMaterial({ color: 0xf2eee0, roughness: 1 }), 5);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < papers.count; i++) papers.setMatrixAt(i, m4.compose(new THREE.Vector3(BOARD.x - 0.8 + i * 0.4, 1.6 + ((i * 37) % 5 - 2) * 0.1, BOARD.z + 0.1), q.setFromEuler(e.set(0, 0, ((i * 53) % 7 - 3) * 0.05)), new THREE.Vector3(1, 1, 1)));
  group.add(board, papers);
  // the people: a body and a head, in their work colours
  for (const p of t.people) {
    const color = PERSON[p.id] ?? 0x888888, figure = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 4, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    body.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 }));
    head.position.y = 1.55;
    figure.add(body, head);
    figure.position.set(p.at.x, 0, p.at.z);
    for (const o of [body, head]) o.castShadow = true;
    group.add(figure);
  }
  return {
    group,
    // the strip lights hum: a flicker you only half see
    tick: (time) => { lamps.forEach((l, i) => { l.intensity = LOOK[ROOMS[i]!.id].power * (0.96 + 0.04 * Math.sin(time * 40 + i * 7) * Math.sin(time * 3.3 + i)); }); },
    dispose: () => group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (![...signs.values()].includes(m)) m.dispose(); } }),
  };
}

/** The row of fronts on the open ground, one geometry per look, in the town's local metres (poi-view.ts lays one of each
 * per town, turned to face its street): the three buildings on a footing that runs down into the ground, the diner's
 * door, the gas station's canopy over a pump, and a sign over each. */
export function townFronts(): { geo: THREE.BufferGeometry; color: number; basic?: boolean; mat?: THREE.Material }[] {
  const FOOT = 2.5; // the walls run down this far, so a town on a slope never floats
  const block = (r: Room, h: number) => new THREE.BoxGeometry(r.x1 - r.x0, h + FOOT, r.z1 - r.z0).translate((r.x0 + r.x1) / 2, (h - FOOT) / 2, (r.z0 + r.z1) / 2);
  const [gas, diner, motel] = ROOMS as [Room, Room, Room];
  const canopy = mergeGeometries([
    new THREE.BoxGeometry(8, 0.4, 6).translate(-11, 4.6, 4),
    new THREE.BoxGeometry(0.3, 4.6, 0.3).translate(-14, 2.3, 4), new THREE.BoxGeometry(0.3, 4.6, 0.3).translate(-8, 2.3, 4),
    new THREE.BoxGeometry(0.7, 1.5, 0.5).translate(-11, 0.75, 4), // the pump
  ]);
  const plate = (x: number, y: number) => new THREE.PlaneGeometry(3.2, 0.8).translate(x, y, 0.06);
  return [
    { geo: block(gas, 3.6), color: LOOK.gas.front },
    { geo: block(diner, 4.0), color: LOOK.diner.front },
    { geo: block(motel, 3.4), color: LOOK.motel.front },
    { geo: new THREE.BoxGeometry(1.8, 2.3, 0.12).translate(0, 1.15, 0.02), color: 0x2a1a14 }, // the door
    { geo: mergeGeometries([new THREE.BoxGeometry(9, 1.6, 0.1).translate(0, 1.7, 0.03).translate(-11, 0, 0), new THREE.BoxGeometry(2.4, 1.6, 0.1).translate(-3.4, 1.7, 0.03), new THREE.BoxGeometry(2.4, 1.6, 0.1).translate(3.4, 1.7, 0.03), new THREE.BoxGeometry(6, 1.6, 0.1).translate(11, 1.7, 0.03)]) ?? new THREE.BoxGeometry(), color: 0xffd890, basic: true }, // lit windows
    { geo: canopy ?? new THREE.BoxGeometry(), color: 0xe8e4dc },
    { geo: plate(-11, 3.0), color: 0, mat: signMat("gas") },
    { geo: plate(0, 3.4), color: 0, mat: signMat("diner") },
    { geo: plate(11, 2.9), color: 0, mat: signMat("motel") },
  ];
}
