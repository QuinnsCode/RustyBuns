// The heads from src/sim/heads.ts, drawn: toy-like and our own, a handful of primitives each
// in the paper palette (ink, paper, orange, a grey), for the figure's neck slot
// (heads.ts's buildHead shrinks them to it). Each faces -z, the way the figure does, and stands on y = 0.

import * as THREE from "three";

const INK = 0x1f1f1f, ORANGE = 0xe8590c, PAPER = 0xffffff, GREY = 0xbdbdbd, DARK = 0x3a3a3a;
const mats = new Map<number, THREE.MeshStandardMaterial>();
const mat = (color: number) => {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: color === INK ? 0.25 : 0.55 })));
  return m;
};

function part(g: THREE.Group, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rot?: [number, number, number], scale?: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  if (rot) m.rotation.set(...rot);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  g.add(m);
  return m;
}
const ball = (r: number) => new THREE.SphereGeometry(r, 20, 14);
const eyes = (g: THREE.Group, y: number, z: number, gap = 0.13, r = 0.055, color = INK) => {
  part(g, ball(r), color, -gap, y, z);
  part(g, ball(r), color, gap, y, z);
};

const BUILD: Record<string, (g: THREE.Group) => void> = {
  bun(g) {
    // A round steamed bun, pleated to a pinch on top, with a sleepy face.
    part(g, ball(0.42), PAPER, 0, 0.32, 0, undefined, [1, 0.78, 1]);
    for (let i = 0; i < 6; i++) part(g, new THREE.ConeGeometry(0.05, 0.22, 6), GREY, Math.cos(i) * 0.06, 0.62, Math.sin(i) * 0.06, [Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5]);
    eyes(g, 0.36, -0.38, 0.14, 0.04);
    part(g, ball(0.06), ORANGE, -0.25, 0.28, -0.32, undefined, [1, 0.6, 0.4]);
    part(g, ball(0.06), ORANGE, 0.25, 0.28, -0.32, undefined, [1, 0.6, 0.4]);
  },
  crab(g) {
    // A wide orange shell, eyes up on stalks, two claws raised.
    part(g, ball(0.4), ORANGE, 0, 0.22, 0, undefined, [1.25, 0.55, 0.9]);
    for (const s of [-1, 1]) {
      part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.22), INK, s * 0.12, 0.48, -0.2);
      part(g, ball(0.07), PAPER, s * 0.12, 0.6, -0.2);
      part(g, ball(0.035), INK, s * 0.12, 0.6, -0.26);
      part(g, ball(0.14), ORANGE, s * 0.6, 0.42, -0.1, undefined, [0.8, 1.1, 0.6]);
      part(g, new THREE.ConeGeometry(0.06, 0.18, 8), ORANGE, s * 0.6, 0.6, -0.1, [0, 0, s * 0.4]);
    }
  },
  penguin(g) {
    // An ink egg with a paper face and an orange beak.
    part(g, ball(0.4), INK, 0, 0.36, 0, undefined, [1, 1.05, 1]);
    part(g, ball(0.3), PAPER, 0, 0.3, -0.16, undefined, [1, 1, 0.8]);
    eyes(g, 0.46, -0.38, 0.11, 0.05);
    part(g, new THREE.ConeGeometry(0.08, 0.2, 10), ORANGE, 0, 0.34, -0.47, [-Math.PI / 2, 0, 0]);
  },
  whale(g) {
    // A round whale, side on, carrying a stack of crates on its back, a spout behind.
    part(g, ball(0.38), DARK, 0, 0.3, 0, undefined, [1.3, 0.8, 1]);
    part(g, new THREE.ConeGeometry(0.14, 0.3, 4), DARK, 0.6, 0.38, 0, [0, 0, -Math.PI / 2]);
    eyes(g, 0.32, -0.34, 0.16, 0.04, PAPER);
    const box = new THREE.BoxGeometry(0.16, 0.13, 0.16);
    [[-0.2, 0.62], [0, 0.62], [0.2, 0.62], [-0.1, 0.76], [0.1, 0.76]].forEach(([x, y], i) => part(g, box, i % 2 ? ORANGE : PAPER, x!, y!, 0));
  },
  cloud(g) {
    // A puffy orange cloud.
    [[0, 0.38, 0, 0.32], [-0.3, 0.28, 0, 0.24], [0.3, 0.28, 0, 0.26], [0.12, 0.56, 0, 0.22], [-0.16, 0.5, 0.05, 0.2]].forEach(([x, y, z, r]) => part(g, ball(r!), ORANGE, x!, y!, z!));
    eyes(g, 0.38, -0.3, 0.12, 0.045);
  },
  pyramid(g) {
    // A sharp black pyramid with one orange eye.
    part(g, new THREE.ConeGeometry(0.46, 0.8, 3), INK, 0, 0.4, 0, [0, Math.PI, 0]);
    part(g, ball(0.07), ORANGE, 0, 0.32, -0.22);
  },
  cat(g) {
    // A round cat head, pointed ears, and a fringe of little arms hanging below like an octopus.
    part(g, ball(0.36), INK, 0, 0.42, 0);
    for (const s of [-1, 1]) part(g, new THREE.ConeGeometry(0.12, 0.24, 4), INK, s * 0.22, 0.76, 0, [0, 0, -s * 0.35]);
    part(g, ball(0.24), PAPER, 0, 0.38, -0.18, undefined, [1.1, 0.8, 0.6]);
    eyes(g, 0.42, -0.36, 0.09, 0.04);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(g, new THREE.CapsuleGeometry(0.045, 0.14, 4, 8), INK, Math.cos(a) * 0.24, 0.1, Math.sin(a) * 0.24, [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
    }
  },
  gopher(g) {
    // A pale round critter, big eyes, two buck teeth, little ears.
    part(g, ball(0.4), GREY, 0, 0.36, 0, undefined, [1, 1.05, 0.95]);
    for (const s of [-1, 1]) {
      part(g, ball(0.12), PAPER, s * 0.15, 0.48, -0.32);
      part(g, ball(0.05), INK, s * 0.15, 0.48, -0.42);
      part(g, ball(0.08), GREY, s * 0.32, 0.72, 0);
    }
    part(g, ball(0.08), ORANGE, 0, 0.32, -0.4, undefined, [1.2, 0.7, 0.8]);
    part(g, new THREE.BoxGeometry(0.1, 0.1, 0.04), PAPER, 0, 0.22, -0.38);
  },
  elephant(g) {
    // A grey elephant head: big flat ears and a trunk curling down.
    part(g, ball(0.34), GREY, 0, 0.4, 0);
    for (const s of [-1, 1]) part(g, new THREE.CylinderGeometry(0.26, 0.26, 0.05, 20), GREY, s * 0.38, 0.42, 0.04, [Math.PI / 2, 0, s * 0.3]);
    eyes(g, 0.48, -0.3, 0.13, 0.04);
    const trunk = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.36, -0.3), new THREE.Vector3(0, 0.2, -0.46), new THREE.Vector3(0, 0.02, -0.44), new THREE.Vector3(0, 0, -0.32)]), 16, 0.07, 10);
    part(g, trunk, GREY, 0, 0, 0);
  },
  helm(g) {
    // A ship's wheel, stood upright, with an orange hub.
    part(g, new THREE.TorusGeometry(0.3, 0.05, 10, 28), INK, 0, 0.4, 0);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      part(g, new THREE.CylinderGeometry(0.025, 0.025, 0.74), INK, 0, 0.4, 0, [0, 0, a]);
      part(g, ball(0.05), INK, Math.sin(a) * 0.4, 0.4 + Math.cos(a) * 0.4, 0);
    }
    part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.1, 16), ORANGE, 0, 0.4, 0, [Math.PI / 2, 0, 0]);
  },
  snakes(g) {
    // Two snakes coiled round each other, one ink, one orange.
    for (const [color, phase] of [[INK, 0], [ORANGE, Math.PI]] as const) {
      const pts = Array.from({ length: 24 }, (_, i) => {
        const t = i / 23, a = phase + t * Math.PI * 3;
        return new THREE.Vector3(Math.cos(a) * 0.18, 0.06 + t * 0.62, Math.sin(a) * 0.18);
      });
      part(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.07, 10), color, 0, 0, 0);
      const top = pts[23]!;
      part(g, ball(0.1), color, top.x, top.y + 0.04, top.z - 0.04);
      part(g, ball(0.03), PAPER, top.x, top.y + 0.08, top.z - 0.13);
    }
  },
  balloon(g) {
    // A striped hot-air balloon with a little basket, held above the neck on cords.
    const env = part(g, ball(0.36), PAPER, 0, 0.62, 0, undefined, [1, 1.15, 1]);
    // Orange gores, children of the envelope so they stretch with it.
    for (let i = 0; i < 4; i++) env.add(new THREE.Mesh(new THREE.SphereGeometry(0.362, 20, 14, (i / 4) * Math.PI * 2, Math.PI / 8), mat(ORANGE)));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, new THREE.CylinderGeometry(0.01, 0.01, 0.28), INK, x! * 0.1, 0.22, z! * 0.1);
    part(g, new THREE.BoxGeometry(0.24, 0.12, 0.24), DARK, 0, 0.06, 0);
  },
};

/** A head, ready to sit on top of the body; null for no toy head. */
export function headModel(id: string | null): THREE.Group | null {
  const build = id ? BUILD[id] : undefined;
  if (!build) return null;
  const g = new THREE.Group();
  g.name = "head";
  build(g);
  return g;
}

/** Each head's thumbnail, as an image URL, for the menu; drawn once with its own small renderer. */
export function headThumbs(ids: string[], size = 96): Map<string, string> {
  const out = new Map<string, string>();
  const canvas = document.createElement("canvas");
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(2);
  r.setSize(size, size, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-2, 3, -3);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  cam.position.set(0.9, 0.9, -2.2);
  cam.lookAt(0, 0.4, 0);
  for (const id of ids) {
    const h = headModel(id);
    if (!h) continue;
    scene.add(h);
    r.render(scene, cam);
    out.set(id, canvas.toDataURL());
    scene.remove(h);
  }
  r.dispose();
  return out;
}
