// Q Studio's gear in three.js, procedural: Q Amp's clear acrylic heads with tubes that glow with what each stage
// does, a clear 2x12 cab with its cones, metal pedals with a Drive knob and a footswitch, a guitar on its stand,
// and the wall rack. Each model is built at its STUDIO_GEAR size, its own frame as room.ts has it (bottom centre
// at the origin, front +z), so a jack drawn here is where room.ts aims.
import * as THREE from "three";
import type { Face, GearDef, Vec3 } from "./room.ts";
import { RACK } from "./room.ts";

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
const PEDAL_COLOR: Record<string, number> = { drive: 0x3a8f5c, fuzz: 0xc4612f, dist: 0xd8b13a };

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

export function gearModel(g: GearDef): GearModel {
  const group = new THREE.Group(), [w, h, d] = g.size;
  const m: GearModel = { group, knobs: new Map(), jacks: new Map(), tubes: [], cones: [] };
  if (g.kind === "amp") {
    const shell = new THREE.BoxGeometry(w, h, d);
    const glass = new THREE.Mesh(shell, acrylic());
    glass.position.y = h / 2;
    const lines = edges(shell);
    lines.position.y = h / 2;
    group.add(glass, lines, box(w * 0.96, 0.012, d * 0.9, mat(0x2b2e33, 0.6, 0.4), 0.006));
    const panel = box(w * 0.94, 0.07, 0.006, mat(0x1d1f23, 0.5, 0.5), 0.15);
    panel.position.z = d / 2 - 0.006;
    group.add(panel);
    for (let i = 0; i < 6; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 14), new THREE.MeshStandardMaterial({ color: 0x40301f, emissive: 0xff7a2e, emissiveIntensity: 0, transparent: true, opacity: 0.85 }));
      tube.position.set(-w / 2 + 0.08 + i * 0.07, 0.05, -0.03);
      group.add(tube);
      m.tubes.push(tube);
    }
  } else if (g.kind === "cab") {
    const shell = new THREE.BoxGeometry(w, h, d), glass = new THREE.Mesh(shell, acrylic()), lines = edges(shell);
    glass.position.y = lines.position.y = h / 2;
    group.add(glass, lines);
    for (const x of [-w / 4, w / 4]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.08, 28, 1, true), mat(0x2a2a2c, 0, 0.9));
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(x, h / 2, d / 2 - 0.08);
      group.add(cone);
      m.cones.push(cone);
      const magnet = onFace(0.05, 0.05, "back", [x, h / 2, d / 2 - 0.16], mat(0x8a8f96, 0.8, 0.3));
      group.add(magnet);
    }
  } else if (g.circuit === "bench") {
    // A board off the bench in the clear house box: acrylic over a green board, so you see what you drew.
    const shell = new THREE.BoxGeometry(w, h, d), glass = new THREE.Mesh(shell, acrylic()), lines = edges(shell);
    glass.position.y = lines.position.y = h / 2;
    group.add(glass, lines, box(w * 0.84, 0.0016, d * 0.8, mat(0x1f6b3a, 0.1, 0.7), 0.008));
  } else if (g.kind === "pedal") {
    group.add(box(w, h, d, mat(PEDAL_COLOR[g.circuit ?? ""] ?? 0x777777, 0.55, 0.35)));
    group.add(onFace(0.013, 0.012, "top", [0, h + 0.006, d / 2 - 0.05], mat(0xc9ccd1, 0.9, 0.2)));
  } else {
    // The guitar on its stand: a body, a neck, a headstock, and the stand's legs.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.045, 32), mat(0x7b1f24, 0.1, 0.35));
    body.rotation.x = Math.PI / 2;
    body.scale.set(1, 1, 1.25);
    body.position.y = 0.3;
    const neck = box(0.05, 0.5, 0.025, mat(0x8a5a32, 0, 0.7), 0.7);
    const head = box(0.08, 0.14, 0.02, mat(0x1d1f23, 0.1, 0.5), 1.0 - 0.07);
    group.add(body, neck, head);
    for (const a of [0.6, 2.6, 4.6]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 6), mat(0x222222, 0.7, 0.4));
      leg.position.set(Math.sin(a) * 0.1, 0.12, Math.cos(a) * 0.1 - 0.04);
      leg.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
      group.add(leg);
    }
  }
  for (const j of g.jacks) {
    const ring = onFace(0.011, 0.014, j.face, j.at, new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.25, emissive: 0xff6b4a, emissiveIntensity: 0 }));
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
    group.add(cap);
    m.knobs.set(k.name, { mesh: cap, face: k.face });
  }
  return m;
}

/** The wall rack: two uprights and a shelf at each of RACK's heights. */
export function rackModel(): THREE.Group {
  const g = new THREE.Group(), w = RACK.x1 - RACK.x0, d = RACK.z1 - RACK.z0, wood = mat(0x5b4632, 0, 0.8), steel = mat(0x30343a, 0.7, 0.4);
  for (const y of RACK.shelves) g.add(box(w, 0.03, d, wood, y - 0.015));
  for (const x of [-w / 2, w / 2]) {
    const post = box(0.04, RACK.shelves[RACK.shelves.length - 1] + 0.5, 0.04, steel);
    post.position.x = x;
    g.add(post);
  }
  g.position.set((RACK.x0 + RACK.x1) / 2, 0, (RACK.z0 + RACK.z1) / 2);
  return g;
}
