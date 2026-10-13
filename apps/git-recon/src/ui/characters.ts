// The heads from src/sim/heads.ts, drawn: cartoony toy takes on the tools' marks, a handful of
// primitives each in their brand colours, for the figure's neck slot
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

/** Glyph strokes as [x, y, w, h] boxes on a grid, centred on (cx, cy), drawn on the front (-z) of a plate. */
function glyph(g: THREE.Group, strokes: number[][], color: number, cx: number, cy: number, unit: number, z: number) {
  for (const [x, y, w, h] of strokes as [number, number, number, number][]) part(g, new THREE.BoxGeometry(w * unit, h * unit, 0.04), color, cx + (x + w / 2) * unit, cy + (y + h / 2) * unit, z);
}
// Letters and digits on a 3 x 5 grid, y up.
const J = [[2, 1, 1, 4], [0, 0, 3, 1], [0, 1, 1, 1]];
const S = [[0, 4, 3, 1], [0, 2, 3, 1], [0, 0, 3, 1], [0, 3, 1, 1], [2, 1, 1, 1]];
const T = [[0, 4, 3, 1], [1, 0, 1, 4]];
const THREE_ = [[0, 4, 3, 1], [0, 2, 3, 1], [0, 0, 3, 1], [2, 1, 1, 3]];

/** A chunky plate with an extruded outline; faces -z, stands on y = 0. */
function plate(g: THREE.Group, pts: [number, number][], color: number, depth = 0.16, z = 0) {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  geo.translate(0, 0, -depth / 2 + z);
  return part(g, geo, color, 0, 0, 0);
}
const SHIELD: [number, number][] = [[-0.38, 0.8], [0.38, 0.8], [0.32, 0.24], [0, 0.06], [-0.32, 0.24]];
const tube = (pts: THREE.Vector3[], r: number) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 8);

const BUILD: Record<string, (g: THREE.Group) => void> = {
  // Starters
  html5(g) {
    plate(g, SHIELD, 0xe34f26);
    glyph(g, S, PAPER, -0.15, 0.26, 0.1, -0.12);
  },
  css3(g) {
    plate(g, SHIELD, 0x264de4);
    glyph(g, THREE_, PAPER, -0.15, 0.26, 0.1, -0.12);
  },
  js(g) {
    part(g, new THREE.BoxGeometry(0.72, 0.72, 0.2), 0xf7df1e, 0, 0.38, 0);
    glyph(g, J, INK, -0.3, 0.2, 0.065, -0.11);
    glyph(g, S, INK, 0.1, 0.2, 0.065, -0.11);
  },
  ts(g) {
    part(g, new THREE.BoxGeometry(0.72, 0.72, 0.2), 0x3178c6, 0, 0.38, 0);
    glyph(g, T, PAPER, -0.3, 0.2, 0.065, -0.11);
    glyph(g, S, PAPER, 0.1, 0.2, 0.065, -0.11);
  },
  cloud(g) {
    // Cloudflare: a puffy orange cloud with a paler underside.
    [[0, 0.38, 0, 0.32], [-0.3, 0.28, 0, 0.24], [0.3, 0.28, 0, 0.26], [0.12, 0.56, 0, 0.22], [-0.16, 0.5, 0.05, 0.2]].forEach(([x, y, z, r]) => part(g, ball(r!), 0xf6821f, x!, y!, z!));
    part(g, ball(0.2), 0xfbad41, 0.34, 0.2, -0.08, undefined, [1.2, 0.8, 0.8]);
    eyes(g, 0.38, -0.3, 0.12, 0.045);
  },
  // Unlockable
  bun(g) {
    // Bun: a round steamed bun, pleated to a pinch on top, with a sleepy face.
    part(g, ball(0.42), 0xfbf0df, 0, 0.32, 0, undefined, [1, 0.78, 1]);
    for (let i = 0; i < 6; i++) part(g, new THREE.ConeGeometry(0.05, 0.22, 6), 0xe8d3b0, Math.cos(i) * 0.06, 0.62, Math.sin(i) * 0.06, [Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5]);
    eyes(g, 0.36, -0.38, 0.14, 0.04);
    part(g, ball(0.06), 0xf4a3a3, -0.25, 0.28, -0.32, undefined, [1, 0.6, 0.4]);
    part(g, ball(0.06), 0xf4a3a3, 0.25, 0.28, -0.32, undefined, [1, 0.6, 0.4]);
  },
  gear(g) {
    // Rust, kept generic: a rusty orange cog with a hole and a couple of patches.
    const RUST = 0xb7410e;
    part(g, new THREE.CylinderGeometry(0.3, 0.3, 0.2, 24), RUST, 0, 0.42, 0, [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      part(g, new THREE.BoxGeometry(0.14, 0.14, 0.2), RUST, Math.cos(a) * 0.34, 0.42 + Math.sin(a) * 0.34, 0, [0, 0, a]);
    }
    part(g, new THREE.CylinderGeometry(0.11, 0.11, 0.22, 16), 0x2a1408, 0, 0.42, 0, [Math.PI / 2, 0, 0]);
    part(g, ball(0.07), 0xd9822b, -0.16, 0.56, -0.1, undefined, [1, 1, 0.3]);
    part(g, ball(0.05), 0xd9822b, 0.2, 0.3, -0.1, undefined, [1, 1, 0.3]);
  },
  cube(g) {
    // Three.js: a paper cube balanced on its corner with ink edges, and a little triangle on top.
    const cube = part(g, new THREE.BoxGeometry(0.46, 0.46, 0.46), PAPER, 0, 0.5, 0, [0.6, 0.78, 0]);
    cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: INK })));
    part(g, new THREE.ConeGeometry(0.12, 0.2, 3), INK, 0, 0.98, 0);
  },
  atom(g) {
    // React: a cyan atom, three orbits around a nucleus.
    const CYAN = 0x61dafb;
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Group();
      part(o, new THREE.TorusGeometry(0.4, 0.03, 8, 40), CYAN, 0, 0, 0, undefined, [1, 0.4, 1]);
      o.rotation.z = (i * Math.PI) / 3;
      o.position.y = 0.48;
      g.add(o);
    }
    part(g, ball(0.09), CYAN, 0, 0.48, 0);
  },
  flask(g) {
    // Alchemy: a round-bottomed flask of bubbling purple potion, corked.
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xe9e4f5, roughness: 0.05, transparent: true, opacity: 0.45 });
    part(g, ball(0.34), PAPER, 0, 0.36, 0).material = glassMat;
    part(g, ball(0.3), 0x8b5cf6, 0, 0.3, 0, undefined, [1, 0.8, 1]);
    part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 16), PAPER, 0, 0.72, 0).material = glassMat;
    part(g, new THREE.CylinderGeometry(0.11, 0.09, 0.1, 16), 0x9a6b3f, 0, 0.92, 0);
    [[-0.1, 0.5, 0.06], [0.12, 0.58, 0.05], [0.02, 0.42, 0.04]].forEach(([x, y, r]) => part(g, ball(r!), 0xd8c8ff, x!, y!, -0.2));
  },
  effect(g) {
    // Effect: a chunky ink E on a paper tile, with an orange spark.
    part(g, new THREE.BoxGeometry(0.72, 0.72, 0.14), PAPER, 0, 0.38, 0);
    glyph(g, [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1.6, 1], [1, 0, 2, 1]], INK, -0.12, 0.2, 0.09, -0.09);
    part(g, new THREE.ConeGeometry(0.06, 0.2, 4), ORANGE, 0.26, 0.58, -0.09, [Math.PI / 2, 0, 0.4]);
  },
  wave(g) {
    // Tailwind: two sky-blue swooshes.
    const SKY = 0x38bdf8;
    for (const y of [0.52, 0.28]) {
      const pts = [-0.36, -0.18, 0, 0.18, 0.36].map((x, i) => new THREE.Vector3(x, y + (i % 2 ? -0.1 : 0.1), 0));
      part(g, tube(pts, 0.07), SKY, 0, 0, 0);
    }
    part(g, ball(0.07), SKY, -0.37, 0.62, 0);
    part(g, ball(0.07), SKY, 0.37, 0.18, 0);
  },
  b(g) {
    // Better Auth: a black tile with a blocky white B.
    part(g, new THREE.BoxGeometry(0.72, 0.72, 0.2), INK, 0, 0.38, 0);
    glyph(g, [[0, 0, 1, 5], [1, 4, 1.5, 1], [1, 2, 1.5, 1], [1, 0, 1.5, 1], [2.5, 3, 1, 1], [2.5, 1, 1, 1]], PAPER, -0.17, 0.2, 0.068, -0.11);
  },
  bolt(g) {
    // Vite: a yellow lightning bolt on a purple tile.
    plate(g, [[-0.36, 0.1], [0.36, 0.1], [0.36, 0.78], [-0.36, 0.78]], 0x646cff, 0.18);
    plate(g, [[0.06, 0.74], [-0.2, 0.4], [-0.02, 0.4], [-0.1, 0.14], [0.2, 0.5], [0.02, 0.5], [0.12, 0.74]], 0xffd62e, 0.1, -0.1);
  },
  island(g) {
    // TanStack: a sandy island with a palm tree.
    part(g, new THREE.CylinderGeometry(0.4, 0.46, 0.14, 24), 0xf2d49b, 0, 0.07, 0);
    part(g, new THREE.CylinderGeometry(0.43, 0.43, 0.04, 24), 0x38bdf8, 0, 0.02, 0);
    part(g, new THREE.CylinderGeometry(0.035, 0.05, 0.5, 8), 0x9a6b3f, 0, 0.4, 0, [0, 0, 0.15]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      part(g, new THREE.ConeGeometry(0.06, 0.34, 4), 0x2f9e44, 0.07 + Math.cos(a) * 0.15, 0.68, Math.sin(a) * 0.15, [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2]);
    }
    part(g, ball(0.05), ORANGE, 0.06, 0.62, -0.04);
  },
  svelte(g) {
    // Svelte: an orange-red rounded block with a white swooping S.
    part(g, ball(0.4), 0xff3e00, 0, 0.4, 0, undefined, [1, 1, 0.6]);
    const pts = [[0.18, 0.62], [-0.05, 0.6], [-0.14, 0.5], [0.12, 0.38], [0.14, 0.26], [-0.1, 0.2], [-0.2, 0.28]].map(([x, y]) => new THREE.Vector3(x, y, -0.2));
    part(g, tube(pts, 0.04), PAPER, 0, 0, 0);
  },
  vue(g) {
    // Vue: nested green and navy V triangles.
    plate(g, [[-0.44, 0.8], [0.44, 0.8], [0, 0.04]], 0x42b883, 0.12);
    plate(g, [[-0.28, 0.8], [0.28, 0.8], [0, 0.32]], 0x35495e, 0.1, -0.06);
  },
  peaks(g) {
    // Nuxt: two green mountain peaks, the small one in front.
    part(g, new THREE.ConeGeometry(0.46, 0.8, 4), 0x00dc82, -0.1, 0.4, 0.06, [0, Math.PI / 4, 0]);
    part(g, new THREE.ConeGeometry(0.3, 0.52, 4), 0x003543, 0.26, 0.26, -0.1, [0, Math.PI / 4, 0]);
    part(g, new THREE.ConeGeometry(0.12, 0.18, 4), PAPER, -0.1, 0.7, 0.06, [0, Math.PI / 4, 0]);
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
