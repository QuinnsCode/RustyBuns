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
  hedgehog(g) {
    // A round hedgehog: a spiky grey back, a paper face and a little ink nose.
    part(g, ball(0.36), PAPER, 0, 0.34, -0.06, undefined, [1, 0.95, 1]);
    // Quills over the top, sides and back, leaving the face clear.
    for (let row = 0; row < 4; row++) {
      const up = 0.15 + row * 0.38, n = 14 - row * 3;
      for (let k = 0; k < n; k++) {
        const az = (k / n) * Math.PI * 2 + row * 0.4, dx = Math.cos(up) * Math.sin(az), dy = Math.sin(up), dz = Math.cos(up) * Math.cos(az);
        if (dz < -0.35 && dy < 0.75) continue;
        const spike = part(g, new THREE.ConeGeometry(0.055, 0.24, 6), DARK, dx * 0.36, 0.34 + dy * 0.36, -0.06 + dz * 0.36);
        spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz));
      }
    }
    eyes(g, 0.4, -0.38, 0.12, 0.04);
    part(g, ball(0.05), INK, 0, 0.3, -0.43);
    part(g, ball(0.06), ORANGE, -0.22, 0.28, -0.33, undefined, [1, 0.6, 0.4]);
    part(g, ball(0.06), ORANGE, 0.22, 0.28, -0.33, undefined, [1, 0.6, 0.4]);
  },
  watchtower(g) {
    // A lookout tower: four legs, a hut on top, and an orange lamp sweeping the yard.
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) part(g, new THREE.CylinderGeometry(0.03, 0.04, 0.4), INK, x! * 0.18, 0.2, z! * 0.18);
    part(g, new THREE.BoxGeometry(0.5, 0.28, 0.5), PAPER, 0, 0.54, 0);
    part(g, new THREE.ConeGeometry(0.42, 0.24, 4), INK, 0, 0.8, 0, [0, Math.PI / 4, 0]);
    part(g, new THREE.CylinderGeometry(0.07, 0.1, 0.16, 12), ORANGE, 0, 0.56, -0.28, [Math.PI / 2, 0, 0]);
  },
  bucket(g) {
    // An orange storage bucket with a handle, a nod to the biggest bucket of them all.
    part(g, new THREE.CylinderGeometry(0.36, 0.26, 0.56, 24, 1, true), ORANGE, 0, 0.3, 0);
    part(g, new THREE.CylinderGeometry(0.26, 0.26, 0.02, 24), DARK, 0, 0.03, 0);
    part(g, new THREE.TorusGeometry(0.36, 0.025, 8, 32), INK, 0, 0.58, 0, [Math.PI / 2, 0, 0]);
    part(g, new THREE.TorusGeometry(0.36, 0.02, 8, 24, Math.PI), INK, 0, 0.58, 0);
    eyes(g, 0.36, -0.33, 0.12, 0.045);
  },
  magnifier(g) {
    // A magnifying glass held up like a monocle: an ink ring, a glassy lens, the handle down.
    part(g, new THREE.TorusGeometry(0.28, 0.06, 12, 32), INK, 0, 0.5, 0);
    const lens = part(g, new THREE.CylinderGeometry(0.27, 0.27, 0.03, 32), PAPER, 0, 0.5, 0, [Math.PI / 2, 0, 0]);
    lens.material = new THREE.MeshStandardMaterial({ color: 0xdfe8ef, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.6 });
    part(g, new THREE.CylinderGeometry(0.05, 0.06, 0.36), ORANGE, 0.26, 0.12, 0, [0, 0, 0.75]);
    part(g, ball(0.05), INK, -0.06, 0.52, -0.05);
  },
  terminal(g) {
    // A little terminal: an ink screen in a paper case, an orange prompt and cursor on it.
    part(g, new THREE.BoxGeometry(0.66, 0.5, 0.42), PAPER, 0, 0.32, 0);
    part(g, new THREE.BoxGeometry(0.56, 0.38, 0.02), INK, 0, 0.34, -0.21);
    part(g, new THREE.BoxGeometry(0.1, 0.03, 0.02), ORANGE, -0.17, 0.4, -0.225, [0, 0, -0.6]);
    part(g, new THREE.BoxGeometry(0.1, 0.03, 0.02), ORANGE, -0.17, 0.35, -0.225, [0, 0, 0.6]);
    part(g, new THREE.BoxGeometry(0.12, 0.03, 0.02), ORANGE, 0.0, 0.28, -0.225);
  },
  pi(g) {
    // The letter pi as a chunky toy: a lintel on two legs, the right one kicking out.
    part(g, new THREE.BoxGeometry(0.7, 0.12, 0.16), INK, 0, 0.66, 0);
    part(g, new THREE.BoxGeometry(0.12, 0.6, 0.16), INK, -0.16, 0.32, 0);
    part(g, new THREE.BoxGeometry(0.12, 0.56, 0.16), INK, 0.16, 0.32, 0, [0, 0, 0.12]);
    part(g, new THREE.BoxGeometry(0.16, 0.1, 0.16), ORANGE, 0.24, 0.06, 0);
    eyes(g, 0.66, -0.09, 0.14, 0.035, PAPER);
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
