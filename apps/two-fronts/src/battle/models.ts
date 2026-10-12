// Everything on the forest moon is built from three.js primitives: no assets to load or license.
// Models stand on y = 0 and face -z, the way yaw 0 faces in the sim.
import * as THREE from "three";
import type { Faction } from "./contract.ts";
import type { Tree, Trooper } from "./sim.ts";

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const ball = (r: number, m: THREE.Material, x = 0, y = 0, z = 0, detail = 12) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, detail, Math.max(6, detail - 4)), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const rod = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 6), m);
  mesh.position.set(x, y, z);
  return mesh;
};

// --- Thunder Marines: black armour, white trim, a full-face helmet with a snorkel mask on the
// front, and a backpack far too big for anyone, bristling with antennas that wobble. ---
const M = {
  armour: lambert(0x16181c),
  trim: lambert(0xf2f4f7),
  gold: lambert(0xe2b13c, { emissive: 0x6b4a00 }),
  pack: lambert(0x2b2e34),
  glass: new THREE.MeshPhongMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.75, shininess: 120 }),
  snorkel: lambert(0xff7a1a),
  gun: lambert(0x3c4048),
  tip: lambert(0xff3b3b, { emissive: 0x801010 }),
};

// Each class carries its kit: the heavy a rocket tube on the shoulder, the sniper a long rifle,
// the engineer an orange toolbox on the pack. Assault troopers and the hero carry the standard gun.
export function marine(hero = false, kit: Trooper = "assault") {
  const g = new THREE.Group(), trim = hero ? M.gold : M.trim;
  g.add(
    box(0.22, 0.85, 0.26, M.armour, -0.15, 0.43, 0), box(0.22, 0.85, 0.26, M.armour, 0.15, 0.43, 0),
    box(0.24, 0.16, 0.06, trim, -0.15, 0.5, -0.15), box(0.24, 0.16, 0.06, trim, 0.15, 0.5, -0.15), // knee pads
    box(0.62, 0.72, 0.4, M.armour, 0, 1.2, 0),
    box(0.5, 0.28, 0.05, trim, 0, 1.33, -0.21), // chest plate
    box(0.64, 0.08, 0.42, trim, 0, 0.88, 0),    // belt
    box(0.16, 0.62, 0.2, M.armour, -0.4, 1.2, 0), box(0.16, 0.62, 0.2, M.armour, 0.4, 1.2, -0.1),
    box(0.1, 0.12, 0.7, M.gun, 0.4, 1.0, -0.45),
  );
  // The helmet, and its snorkel mask.
  g.add(ball(0.24, M.armour, 0, 1.76, 0));
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.03, 6, 20), trim);
  band.rotation.x = Math.PI / 2;
  band.position.y = 1.86;
  const mask = ball(0.16, M.glass, 0, 1.74, -0.17);
  mask.scale.set(1.15, 0.8, 0.45);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 6, 20), trim);
  rim.scale.set(1.1, 0.8, 1);
  rim.position.set(0, 1.74, -0.22);
  g.add(band, mask, rim, rod(0.035, 0.6, M.snorkel, 0.2, 1.98, -0.12), rod(0.04, 0.12, M.snorkel, 0.2, 2.3, -0.12));
  // The backpack. Nobody knows why it's this big.
  g.add(box(0.95, 1.35, 0.75, M.pack, 0, 1.45, 0.58), box(0.97, 0.1, 0.77, trim, 0, 1.75, 0.58), box(0.6, 0.35, 0.08, M.armour, 0, 1.15, 0.97));
  const antennas: THREE.Group[] = [];
  for (const [x, h, z] of [[-0.35, 2.6, 0.4], [0.05, 3.4, 0.75], [0.36, 1.9, 0.5]] as const) {
    const a = new THREE.Group();
    a.position.set(x, 2.12, z);
    a.add(rod(0.02, h, M.armour, 0, h / 2, 0), ball(0.06, M.tip, 0, h, 0, 8));
    antennas.push(a);
    g.add(a);
  }
  if (kit === "heavy") {
    const tube = rod(0.14, 1.5, M.gun, 0.45, 1.75, -0.1);
    tube.rotation.x = Math.PI / 2;
    g.add(tube, rod(0.16, 0.08, M.snorkel, 0.45, 1.75, -0.86).rotateX(Math.PI / 2));
  } else if (kit === "sniper") {
    g.add(box(0.06, 0.06, 1.3, M.gun, 0.4, 1.05, -1.05), box(0.08, 0.1, 0.3, M.glass, 0.4, 1.15, -0.5));
  } else if (kit === "engineer") {
    g.add(box(0.7, 0.4, 0.3, M.snorkel, 0, 1.0, 1.0), box(0.06, 0.06, 0.5, M.trim, -0.42, 0.95, -0.3));
  }
  g.userData = { antennas };
  return g;
}

// --- The Wooka: round, fluffy, knee-high to a Marine, with big black eyes that have nothing
// behind them and a club with a nail in it. On purpose. ---
const W = {
  fur: lambert(0x7a5230, { flatShading: true }),
  belly: lambert(0xb38658, { flatShading: true }),
  eye: new THREE.MeshPhongMaterial({ color: 0x050505, shininess: 160, specular: 0x888888 }),
  glint: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  mouth: lambert(0x2a0c0c),
  tooth: lambert(0xf3eedc),
  wood: lambert(0x5b3a1e),
  nail: lambert(0x9aa0a6),
  bone: lambert(0xeee6cf),
};

export function wooka(hero = false) {
  const g = new THREE.Group(), body = new THREE.Group();
  const fuzz = (r: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const torso = fuzz(0.45, W.fur, 0, 0.55, 0);
  torso.scale.set(1, 1.1, 0.95);
  const belly = fuzz(0.3, W.belly, 0, 0.5, -0.22);
  belly.scale.set(1, 1.1, 0.5);
  const snout = fuzz(0.13, W.belly, 0, 0.98, -0.32);
  const mouth = box(0.16, 0.04, 0.04, W.mouth, 0, 0.9, -0.38);
  body.add(
    torso, belly,
    fuzz(0.36, W.fur, 0, 1.08, 0),
    fuzz(0.12, W.fur, -0.27, 1.38, 0.02), fuzz(0.12, W.fur, 0.27, 1.38, 0.02), // ears
    ball(0.11, W.eye, -0.14, 1.14, -0.28), ball(0.11, W.eye, 0.14, 1.14, -0.28),
    ball(0.02, W.glint, -0.12, 1.17, -0.38, 6), ball(0.02, W.glint, 0.16, 1.17, -0.38, 6),
    snout, mouth,
  );
  for (const x of [-0.05, 0.05]) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 4), W.tooth);
    t.rotation.x = Math.PI;
    t.position.set(x, 0.86, -0.39);
    body.add(t);
  }
  // The club.
  const club = new THREE.Group();
  club.position.set(0.42, 0.6, -0.1);
  club.rotation.x = -0.6;
  club.add(rod(0.04, 0.7, W.wood, 0, 0.35, 0), rod(0.09, 0.22, W.wood, 0, 0.75, 0));
  for (let i = 0; i < 4; i++) {
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.14, 4), W.nail);
    const a = (i / 4) * Math.PI * 2;
    n.position.set(Math.cos(a) * 0.12, 0.75, Math.sin(a) * 0.12);
    n.rotation.z = -Math.cos(a) * Math.PI / 2;
    n.rotation.x = Math.sin(a) * Math.PI / 2;
    club.add(n);
  }
  body.add(club, fuzz(0.13, W.fur, -0.2, 0.08, -0.05), fuzz(0.13, W.fur, 0.2, 0.08, -0.05));
  if (hero) {
    // The chieftain: bigger, and wearing something's bones.
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + (i / 6) * 2.4;
      const bone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.32, 5), W.bone);
      bone.position.set(Math.sin(a) * 0.3, 1.42, -Math.cos(a) * 0.12);
      bone.rotation.z = -Math.sin(a) * 0.5;
      body.add(bone);
    }
    body.scale.setScalar(1.45);
  }
  g.add(body);
  g.userData = { bob: body, club };
  return g;
}

// --- Vehicles and fortifications ---
export function tank() {
  const g = new THREE.Group();
  g.add(
    box(3.4, 1.3, 5, M.armour, 0, 0.9, 0), box(3.5, 0.15, 5.05, M.trim, 0, 1.3, 0),
    box(1.9, 0.9, 2, M.armour, 0, 2, 0.2), box(0.5, 0.5, 0.06, M.trim, 0.5, 2, -0.82),
  );
  const barrel = rod(0.18, 3.2, M.gun, 0, 2, -2);
  barrel.rotation.x = Math.PI / 2;
  g.add(barrel);
  return g;
}

// A two-legged walker: a cockpit box high on long legs that swing as it strides.
export function walker() {
  const g = new THREE.Group(), legs: THREE.Group[] = [];
  for (const x of [-1.1, 1.1]) {
    const leg = new THREE.Group();
    leg.position.set(x, 5, 0);
    leg.add(box(0.5, 2.6, 0.5, M.armour, 0, -1.3, 0), box(0.45, 2.6, 0.45, M.armour, 0, -3.5, 0.4), box(1.1, 0.3, 1.6, M.trim, 0, -4.85, 0.2));
    legs.push(leg);
    g.add(leg);
  }
  g.add(box(3, 2, 4, M.armour, 0, 6, 0), box(3.05, 0.15, 4.05, M.trim, 0, 6.6, 0), box(2.2, 0.5, 0.06, M.glass, 0, 6.3, -2.02));
  for (const x of [-1.7, 1.7]) {
    const gun = rod(0.16, 2.4, M.gun, x, 5.6, -1.6);
    gun.rotation.x = Math.PI / 2;
    g.add(gun);
  }
  g.userData = { legs };
  return g;
}

// A speeder: a long, low bike that floats a metre up.
export function speeder() {
  const g = new THREE.Group();
  g.add(
    box(0.8, 0.5, 3.6, M.armour, 0, 1, 0.2), box(0.82, 0.08, 3.62, M.trim, 0, 1.25, 0.2),
    box(1.6, 0.1, 0.6, M.armour, 0, 1.1, -1.9), box(0.5, 0.5, 0.8, M.pack, 0, 1.4, 1),
    box(0.3, 0.15, 0.2, M.tip, 0, 1, 2.05),
  );
  return g;
}

// A gunship: a fat hull, stub wings with an engine pod each, a chin gun. The view flies it.
export function gunship() {
  const g = new THREE.Group();
  g.add(
    box(2.6, 2, 7, M.armour, 0, 0, 0), box(2.62, 0.15, 7.02, M.trim, 0, 0.7, 0),
    box(2.2, 0.8, 0.06, M.glass, 0, 0.3, -3.52), box(8, 0.3, 2, M.armour, 0, 0.3, 0.6),
    box(0.8, 1.5, 1.2, M.armour, 0, 1.4, 3.2),
  );
  for (const x of [-4, 4]) g.add(rod(0.6, 2.6, M.pack, x, 0.3, 0.6).rotateX(Math.PI / 2), ball(0.4, M.tip, x, 0.3, 1.95, 8));
  const gun = rod(0.12, 1.6, M.gun, 0, -1.1, -2.8);
  gun.rotation.x = Math.PI / 2;
  g.add(gun);
  return g;
}

export function turret(f: Faction) {
  const g = new THREE.Group();
  if (f === "wooka") {
    // A rock-chucker: three poles, some rope, and a rock.
    for (let i = 0; i < 3; i++) {
      const leg = rod(0.1, 3.4, W.wood, 0, 1.6, 0);
      const a = (i / 3) * Math.PI * 2;
      leg.position.set(Math.cos(a) * 0.6, 1.6, Math.sin(a) * 0.6);
      leg.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(leg);
    }
    g.add(ball(0.5, lambert(0x77736a), 0, 3.3, 0, 6));
  } else {
    g.add(rod(1.4, 2.6, M.armour, 0, 1.3, 0), rod(1.42, 0.15, M.trim, 0, 2.2, 0), box(1.6, 0.9, 1.6, M.armour, 0, 3, 0));
    const barrel = rod(0.15, 2.4, M.gun, 0, 3, -1.4);
    barrel.rotation.x = Math.PI / 2;
    g.add(barrel);
  }
  return g;
}

// --- The forest: redwood trunks you can't walk through, their crowns lost in the fog, ferns
// and fallen logs underfoot. The jungle is the same idea, lower, greener and thicker. The canyon
// floor has neither. ---
export type Woods = "redwood" | "jungle" | "none";
export function forest(scene: THREE.Scene, trees: Tree[], seed: number, half: number, woods: Woods = "redwood") {
  if (woods === "none") return;
  const jungle = woods === "jungle";
  let s = seed >>> 0;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), k = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1, 1, 12), lambert(jungle ? 0x4d4630 : 0x6e3220), trees.length);
  const crowns = new THREE.InstancedMesh(jungle ? new THREE.SphereGeometry(1, 8, 6) : new THREE.ConeGeometry(1, 1, 8), lambert(jungle ? 0x1f4a1a : 0x22361c), trees.length * 3);
  trees.forEach((t, i) => {
    const h = jungle ? 22 + r() * 18 : 70 + r() * 50;
    trunks.setMatrixAt(i, m.compose(p.set(t.x, h / 2, t.z), q.identity(), k.set(t.r, h, t.r)));
    for (let j = 0; j < 3; j++) {
      const y = h * (0.55 + j * 0.15);
      crowns.setMatrixAt(i * 3 + j, m.compose(p.set(t.x, y, t.z), q.setFromAxisAngle(up, r() * 6), jungle ? k.set(t.r * 5, 4, t.r * 5) : k.set(t.r * 4 - j, 14, t.r * 4 - j)));
    }
  });
  const nFerns = jungle ? 900 : 420;
  const ferns = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 0.6, 7), lambert(jungle ? 0x2f7a2a : 0x3f6b2a), nFerns);
  for (let i = 0; i < nFerns; i++) {
    const sz = 0.6 + r() * 1.4;
    ferns.setMatrixAt(i, m.compose(p.set((r() - 0.5) * half * 2.2, 0.25 * sz, (r() - 0.5) * half * 2.2), q.setFromAxisAngle(up, r() * 6), k.set(sz * 1.4, sz, sz * 1.4)));
  }
  const logs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), lambert(0x5a3b26), 14);
  for (let i = 0; i < 14; i++) {
    const len = 10 + r() * 14, rad = 0.6 + r() * 0.6;
    q.setFromEuler(new THREE.Euler(0, r() * Math.PI, Math.PI / 2, "YXZ"));
    logs.setMatrixAt(i, m.compose(p.set((r() - 0.5) * half * 1.8, rad, (r() - 0.5) * half * 1.8), q, k.set(rad, len, rad)));
  }
  scene.add(trunks, crowns, ferns, logs);
}

// --- In orbit. Models are centred on the craft and face -z, like yaw 0 and pitch 0 in the sim. ---
const glow = (color: number) => new THREE.MeshBasicMaterial({ color });
const along = (mesh: THREE.Mesh) => { mesh.rotation.x = Math.PI / 2; return mesh; };

// A Marine fighter: a black dart with white trim, its canopy glass, two engines burning orange.
// The hero's has gold trim.
function marineFighter(hero: boolean) {
  const g = new THREE.Group(), trim = hero ? M.gold : M.trim;
  const nose = along(new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 6), M.armour));
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -2.4;
  g.add(
    box(1.4, 0.8, 2.6, M.armour), nose,
    box(1.42, 0.12, 2.62, trim, 0, 0.2, 0),
    box(5, 0.12, 1.3, M.armour, 0, -0.1, 0.5), box(5.02, 0.13, 0.25, trim, 0, -0.1, 0.05),
    box(0.12, 1.2, 1, trim, -2.5, 0.35, 0.7), box(0.12, 1.2, 1, trim, 2.5, 0.35, 0.7), // wingtip fins
    ball(0.45, M.glass, 0, 0.45, -0.7),
  );
  for (const x of [-0.45, 0.45]) g.add(along(rod(0.28, 0.6, glow(0xff9a3c), x, 0, 1.5)));
  return g;
}

// A Wooka fighter: a hollowed-out log with hide sails for wings and one Wooka sitting in it,
// steering by leaning. A bonfire in the back end does the rest.
function wookaFighter(hero: boolean) {
  const g = new THREE.Group();
  const log = along(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 4.4, 8), W.wood));
  const hide = new THREE.MeshLambertMaterial({ color: 0xb59a6a, side: THREE.DoubleSide });
  const sail = (x: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), hide);
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.position.set(x, 0.1, 0.3);
    return m;
  };
  const spar = rod(0.06, 5.2, W.wood, 0, 0.12, 0.3);
  spar.rotation.z = Math.PI / 2;
  g.add(log, sail(-1.9), sail(1.9), spar, ball(0.5, W.fur, 0, 0.75, -0.4), ball(0.12, W.eye, -0.18, 0.82, -0.82), ball(0.12, W.eye, 0.18, 0.82, -0.82));
  g.add(ball(0.5, glow(0xff6a1a), 0, 0, 2.3, 8));
  if (hero) for (let i = 0; i < 5; i++) {
    const bone = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.5, 5), W.bone);
    bone.position.set(-0.4 + i * 0.2, 1.25, -0.4);
    g.add(bone);
  }
  return g;
}

export const fighter = (f: Faction, hero = false) => (f === "wooka" ? wookaFighter(hero) : marineFighter(hero));

// A Marine cruiser: a long black hull with a white stripe, a bridge tower and a row of engines.
// A Wooka cruiser: a hollowed asteroid with logs lashed round it and a sail of patched hides.
export function cruiser(f: Faction) {
  const g = new THREE.Group();
  if (f === "wooka") {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(14, 1), lambert(0x6f6559, { flatShading: true }));
    rock.scale.set(1, 0.7, 1.8);
    const sailMat = new THREE.MeshLambertMaterial({ color: 0xb59a6a, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(26, 22), sailMat);
    sail.position.set(0, 22, 4);
    g.add(rock, sail, rod(0.8, 34, W.wood, 0, 16, 4));
    for (const x of [-12, 12]) g.add(along(rod(1.4, 46, W.wood, x, -2, 0)));
    g.add(ball(5, glow(0xff6a1a), 0, 0, 25, 8));
  } else {
    g.add(
      box(12, 7, 60, M.armour), box(12.1, 1, 60.1, M.trim, 0, 2, 0),
      box(5, 8, 10, M.armour, 0, 7, 14), box(5.1, 1, 2, M.glass, 0, 9, 8.9),
    );
    const prow = along(new THREE.Mesh(new THREE.ConeGeometry(6, 14, 4), M.armour));
    prow.rotation.x = -Math.PI / 2;
    prow.position.z = -37;
    g.add(prow);
    for (const x of [-3.5, 0, 3.5]) g.add(along(rod(1.4, 1, glow(0xff9a3c), x, 0, 30.5)));
  }
  return g;
}
