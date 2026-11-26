// Qollab Studio's gear in three.js, for the gear room and every studio's gear wall. The amps, the cab, the pedals, Q Split,
// Q Bucket and the guitar are the shared gear models (@rustybuns/models/gear, what Sound Guy Simulator rigs): the amp
// head and the cab in Q Amp's clear acrylic, with tubes that glow with what each stage does and cones that push, and
// each pedal a stompbox in its colour. The loop machines, a bench board's clear box, the desk, the wall rack, the
// pedal wall and the sound wall's case and modules (each panel labelled as its drill template is) are drawn here. Each model is built at its STUDIO_GEAR size, its own frame as room.ts has it (bottom
// centre at the origin, front +z), and the jack rings and knob caps go where room.ts aims.
import * as THREE from "three";
import { GEAR_SIZES, gear, gearLook, type GearId, type GearLook, stompbox } from "@rustybuns/models/gear";

const isModel = (id: string | undefined): id is GearId => !!id && Object.hasOwn(GEAR_SIZES, id);
import type { Face, GearDef, Vec3 } from "./room.ts";
import { PEDAL_WALL, RACK } from "./room.ts";
import { CASE } from "./frame.ts";
import { surface } from "../studio/look.ts";

/** Hardboard pegboard: a brown face with a hole every inch, as a map with its holes dark (none without a DOM). */
function pegboard(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#a9875f"; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "60,40,20" : "200,170,130"},0.08)`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 1); }
  g.fillStyle = "#1c140d";
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(16 + x * 32, 16 + y * 32, 4.5, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface GearModel {
  group: THREE.Group;
  /** Each knob's mesh by name, turned by `turnKnob`. */
  knobs: Map<string, { mesh: THREE.Object3D; face: Face }>;
  /** Each jack's ring by name, lit when you look at it. */
  jacks: Map<string, THREE.Mesh>;
  /** The amp's tubes, first stage first, and the cab's cones. */
  tubes: THREE.Mesh[];
  cones: THREE.Mesh[];
}

const NORMAL: Record<Face, Vec3> = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0] };
const acrylic = () => new THREE.MeshPhysicalMaterial({ color: 0xdfeaf2, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
const edges = (geo: THREE.BufferGeometry, color = 0xcfe3f0) => new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
const mat = (color: number, metal = 0.2, rough = 0.6) => new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
const PEDAL_COLOR: Record<string, number> = { drive: 0x3a8f5c, fuzz: 0xc4612f, dist: 0xd8b13a, comp: 0x3b6fb3 };
const MACHINE_COLOR: Record<string, number> = { tape: 0x8c6a45, spring: 0x45505c, bbd: 0x7d4d9e };

/** A shared model stretched to `size` (its bounds to the box room.ts handles), bottom centre at the origin, with its
 * `hide` slots' meshes left off (an amp's own knobs, where this amp puts its own). */
function shared(model: THREE.Group, [w, h, d]: Vec3, hide: string[] = []): THREE.Group {
  for (const c of [...model.children]) if (hide.some((slot) => c.name.endsWith(`-${slot}`))) model.remove(c);
  const b = new THREE.Box3().setFromObject(model), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  model.scale.set(w / s.x, h / s.y, d / s.z);
  model.position.set(-c.x * model.scale.x, -b.min.y * model.scale.y, -c.z * model.scale.z);
  const g = new THREE.Group();
  g.add(model);
  return g;
}

/** The shared look with Q Amp's clear acrylic for the shell and a see-through grille, so the tubes and cones show. */
function clear(): GearLook {
  const look = gearLook();
  look.tolex = acrylic();
  look.grille = new THREE.MeshStandardMaterial({ color: 0x2c2e31, metalness: 0.5, roughness: 0.6, transparent: true, opacity: 0.35, depthWrite: false });
  return look;
}

function box(w: number, h: number, d: number, m: THREE.Material, y = h / 2) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.y = y;
  return mesh;
}

/** A cylinder whose axis points out of `face`, centred at `at`. */
function onFace(radius: number, length: number, face: Face, at: Vec3, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 20), m);
  const n = NORMAL[face];
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n));
  mesh.position.set(at[0], at[1], at[2]);
  return mesh;
}

/** A knob turned to `v` (0 to 1): seven o'clock to five o'clock, as on Q Amp's panel. */
export function turnKnob(k: { mesh: THREE.Object3D; face: Face }, v: number) {
  const a = (-135 + v * 270) * (Math.PI / 180);
  k.mesh.rotation.set(0, 0, 0);
  k.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...NORMAL[k.face]));
  k.mesh.rotateY(-a);
}

/** Each module's panel, drawn once: brushed aluminium, its name across the top, each jack's and knob's label above it. */
const PANELS = new Map<string, THREE.Texture>();
function panelFace(g: GearDef): THREE.Texture {
  const had = PANELS.get(g.id);
  if (had) return had;
  const px = 4000, [w, h] = g.size, c = document.createElement("canvas");
  c.width = Math.round(w * px); c.height = Math.round(h * px);
  const x = c.getContext("2d");
  if (x) {
    const grad = x.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, "#c9ccd1"); grad.addColorStop(0.5, "#e4e6e9"); grad.addColorStop(1, "#c3c6cb");
    x.fillStyle = grad; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#1d1f23"; x.textAlign = "center";
    x.font = `600 ${Math.round(px * 0.0045)}px "Barlow Condensed", sans-serif`;
    x.fillText(g.name.toUpperCase(), c.width / 2, px * 0.012);
    x.font = `500 ${Math.round(px * 0.0026)}px "Barlow Condensed", sans-serif`;
    const at = (p: Vec3, up: number) => [(p[0] + w / 2) * px, (h - p[1] - up) * px] as const;
    for (const k of g.knobs) { const [cx, cy] = at(k.at, 0.0085); x.fillText(k.label.toUpperCase(), cx, cy); }
    for (const j of g.jacks) {
      const [cx, cy] = at(j.at, 0.0072);
      x.fillStyle = j.dir === "out" ? "#b8442f" : "#1d1f23";
      x.fillText((j.label ?? j.name).toUpperCase(), cx, cy);
    }
    x.fillStyle = "#1d1f23";
    for (const y of [0.003, h - 0.003]) for (const sx of [0.0075, ...(w > 0.045 ? [w - 0.0075] : [])]) { x.beginPath(); x.arc(sx * px, y * px, px * 0.0016, 0, Math.PI * 2); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  PANELS.set(g.id, t);
  return t;
}

export function gearModel(g: GearDef): GearModel {
  const group = new THREE.Group(), [w, h, d] = g.size;
  const m: GearModel = { group, knobs: new Map(), jacks: new Map(), tubes: [], cones: [] };
  if (g.kind === "module") {
    // A Eurorack module: its panel and, behind it, the green board its jacks and pots are soldered to.
    const face = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.002), new THREE.MeshStandardMaterial({ map: panelFace(g), metalness: 0.55, roughness: 0.38 }));
    face.position.set(0, h / 2, d / 2 - 0.001);
    const pcb = box(w * 0.88, h * 0.84, 0.0016, mat(0x1f6b3a, 0.1, 0.7), h / 2);
    pcb.position.z = d / 2 - 0.012;
    group.add(face, pcb);
  } else if (g.kind === "amp") {
    // the shared amp head (@rustybuns/models/gear) in Q Amp's clear shell, its own knobs left off for this amp's
    group.add(shared(gear("amp-head", { look: clear() }), g.size, ["knob"]));
    for (let i = 0; i < 6; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 14), new THREE.MeshStandardMaterial({ color: 0x40301f, emissive: 0xff7a2e, emissiveIntensity: 0, transparent: true, opacity: 0.85 }));
      tube.position.set(-w / 2 + 0.08 + i * 0.07, 0.14, -0.04);
      group.add(tube);
      m.tubes.push(tube);
    }
  } else if (g.kind === "cab") {
    // the shared 4x12's cabinet cut to this cab's size, clear, behind a see-through grille: the cones push with the output
    group.add(shared(gear("cab-4x12", { look: clear() }), g.size));
    for (const x of [-w / 4, w / 4]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.08, 28, 1, true), mat(0x2a2a2c, 0, 0.9));
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(x, h / 2, d / 2 - 0.08);
      group.add(cone);
      m.cones.push(cone);
      group.add(onFace(0.05, 0.05, "back", [x, h / 2, d / 2 - 0.16], mat(0x8a8f96, 0.8, 0.3)));
    }
  } else if (g.circuit === "bench") {
    // A board off the bench in the clear house box: acrylic over a green board, so you see what you drew.
    const shell = new THREE.BoxGeometry(w, h, d), glass = new THREE.Mesh(shell, acrylic()), lines = edges(shell);
    glass.position.y = lines.position.y = h / 2;
    group.add(glass, lines, box(w * 0.84, 0.0016, d * 0.8, mat(0x1f6b3a, 0.1, 0.7), 0.008));
  } else if (g.kind === "pedal" || g.kind === "split" || g.loop === "bbd") {
    // the shared stompbox at this box's size: a pedal in its colour, Q Split brushed steel, Q Bucket a purple box
    const look = gearLook();
    look.paint = g.kind === "split" ? mat(0x9aa1ab, 0.8, 0.3) : g.loop === "bbd" ? mat(MACHINE_COLOR.bbd, 0.4, 0.45) : mat(PEDAL_COLOR[g.circuit ?? ""] ?? 0x777777, 0.55, 0.35);
    group.add(stompbox(g.size, { look }));
  } else if (g.kind === "machine") {
    group.add(box(w, h, d, mat(MACHINE_COLOR[g.loop ?? "tape"], 0.4, 0.45)));
    if (g.loop === "tape") {
      // Two reels on the lid.
      for (const x of [-w / 4, w / 4]) group.add(onFace(0.05, 0.01, "top", [x, h + 0.005, -0.02], mat(0x2a2522, 0.3, 0.6)));
    } else if (g.loop === "spring") {
      // The tank's two springs along the lid.
      for (const z of [-0.025, 0.025]) group.add(onFace(0.006, w * 0.8, "right", [0, h + 0.004, z], mat(0xc9ccd1, 0.9, 0.3)));
    }
  } else if (g.kind === "desk") {
    // FM DAW's desk: a console top on two legs, a fader per track, the patch bay along the back of the top.
    group.add(box(w, 0.04, d, mat(0x1d1f23, 0.4, 0.5), h - 0.02));
    for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) { const leg = box(0.05, h - 0.04, d * 0.9, mat(0x30343a, 0.7, 0.4)); leg.position.x = x; group.add(leg); }
    const bay = box(w * 0.96, 0.012, 0.12, mat(0x2b2e33, 0.6, 0.4), h + 0.006);
    bay.position.z = -0.2;
    group.add(bay);
    for (let i = 0; i < 4; i++) {
      const x = -0.41 + i * 0.3, slot = box(0.006, 0.004, 0.16, mat(0x0c0d0f, 0, 0.9), h + 0.002), cap = box(0.03, 0.02, 0.012, mat(0xff6b4a, 0.2, 0.4), h + 0.01);
      slot.position.set(x, h + 0.002, 0.1);
      cap.position.set(x, h + 0.01, 0.1);
      group.add(slot, cap);
    }
  } else if (g.kind === "pa") {
    // the setup lessons' PA and amp rack: Sound Guy Simulator's own boxes (a condenser's body stands in for the vocal mic)
    const id = g.pa === "mic-dynamic" ? "mic-condenser" : g.pa;
    group.add(shared(gear(isModel(id) ? id : "top-12-powered"), g.size));
  } else {
    // the shared guitar, stood on its end
    group.add(shared(gear("guitar"), g.size));
  }
  // A module's 3.5 mm jacks and 9 mm pots are small beside a quarter-inch jack and a pedal's knob.
  const small = g.kind === "module";
  for (const j of g.jacks) {
    const ring = onFace(small ? 0.0042 : 0.011, small ? 0.006 : 0.014, j.face, j.at, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.25, emissive: 0xff6b4a, emissiveIntensity: 0 }));
    group.add(ring);
    m.jacks.set(j.name, ring);
  }
  for (const k of g.knobs) {
    const cap = new THREE.Group();
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.018, 18), mat(0x111214, 0.2, 0.5));
    knob.position.y = 0.009;
    const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.013), new THREE.MeshBasicMaterial({ color: 0xf4f1ea }));
    pointer.position.set(0, 0.019, 0.006);
    cap.add(knob, pointer);
    cap.position.set(k.at[0], k.at[1], k.at[2]);
    // A small board's pots sit close: their caps shrink to fit side by side.
    if (g.circuit === "bench") cap.scale.setScalar(Math.min(1, w / (g.knobs.length + 1) / 0.034));
    if (small) cap.scale.setScalar(0.42);
    group.add(cap);
    m.knobs.set(k.name, { mesh: cap, face: k.face });
  }
  return m;
}

/** The pedal wall: a pegboard on the left wall with a ledge at each of PEDAL_WALL's heights. */
export function pedalWallModel(): THREE.Group {
  const g = new THREE.Group(), d = PEDAL_WALL.x1 - PEDAL_WALL.x0, len = PEDAL_WALL.z1 - PEDAL_WALL.z0, top = PEDAL_WALL.shelves[PEDAL_WALL.shelves.length - 1];
  const tall = top + 0.3 - 0.7, map = pegboard();
  // a hole every 2.54 cm: four to a copy of the map
  map?.repeat.set(((len + 0.1) / 0.1016), tall / 0.1016);
  const board = box(0.012, tall, len + 0.1, new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.85 }), 0.7 + tall / 2);
  board.position.x = -d / 2 + 0.01;
  g.add(board);
  // a steel frame round the board, on two legs down to the floor
  const steel = surface("steel", "#3d4247");
  for (const z of [-(len + 0.1) / 2, (len + 0.1) / 2]) { const leg = box(0.04, top + 0.3, 0.04, steel); leg.position.set(-d / 2 + 0.02, 0, z); g.add(leg); }
  for (const y of [0.7, top + 0.3]) { const rail = box(0.04, 0.04, len + 0.14, steel, y); rail.position.x = -d / 2 + 0.02; g.add(rail); }
  for (const y of PEDAL_WALL.shelves) g.add(box(d, 0.025, len, surface("metal", "#9da2a8"), y - 0.0125));
  g.position.set((PEDAL_WALL.x0 + PEDAL_WALL.x1) / 2, 0, (PEDAL_WALL.z0 + PEDAL_WALL.z1) / 2);
  return g;
}

/**
 * The sound wall's case on its stand: a wooden case open at the front, a pair of rails (top and bottom) for each
 * row the modules screw into, a back panel, and four legs down to the floor.
 */
export function caseModel(): THREE.Group {
  const g = new THREE.Group(), w = CASE.x1 - CASE.x0, d = CASE.z1 - CASE.z0, bottom = CASE.rows[0] - 0.012, wood = mat(0x6b4a2e, 0, 0.75), steel = mat(0xb9bdc3, 0.85, 0.3);
  const tall = CASE.top - bottom, fz = CASE.front - (CASE.z0 + CASE.z1) / 2;
  for (const x of [-w / 2 + 0.006, w / 2 - 0.006]) { const cheek = box(0.012, tall, d, wood, bottom + tall / 2); cheek.position.x = x; g.add(cheek); }
  g.add(box(w, 0.012, d, wood, bottom - 0.006), box(w, 0.012, d, wood, CASE.top + 0.006));
  const back = box(w - 0.024, tall, 0.006, mat(0x1b1c1f, 0.2, 0.8), bottom + tall / 2);
  back.position.z = -d / 2 + 0.003;
  g.add(back);
  for (const r of CASE.rows) for (const y of [r + 0.003, r + 0.1285 - 0.003]) {
    const rail = box(w - 0.024, 0.009, 0.01, steel, y);
    rail.position.z = fz - 0.008;
    g.add(rail);
  }
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-d / 2 + 0.03, d / 2 - 0.03]) {
    const leg = box(0.025, bottom - 0.012, 0.025, mat(0x30343a, 0.7, 0.4));
    leg.position.set(x, 0, z);
    leg.position.y = (bottom - 0.012) / 2;
    g.add(leg);
  }
  g.position.set((CASE.x0 + CASE.x1) / 2, 0, (CASE.z0 + CASE.z1) / 2);
  return g;
}

/** The wall rack: two uprights and a shelf at each of RACK's heights. */
export function rackModel(): THREE.Group {
  const g = new THREE.Group(), w = RACK.x1 - RACK.x0, d = RACK.z1 - RACK.z0, wood = surface("wood", "#6a4f36"), steel = surface("steel", "#2e3236");
  for (const y of RACK.shelves) g.add(box(w, 0.03, d, wood, y - 0.015));
  // four angle-iron posts, braced across the back
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2 + 0.02, d / 2 - 0.02]) {
    const post = box(0.04, RACK.shelves[RACK.shelves.length - 1] + 0.5, 0.04, steel);
    post.position.set(x, 0, z);
    g.add(post);
  }
  for (const y of RACK.shelves) for (const z of [-d / 2 + 0.02, d / 2 - 0.02]) { const lip = box(w, 0.04, 0.03, steel, y - 0.05); lip.position.z = z; g.add(lip); }
  g.position.set((RACK.x0 + RACK.x1) / 2, 0, (RACK.z0 + RACK.z1) / 2);
  return g;
}
