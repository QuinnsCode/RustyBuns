// gitpath's 3D models, built from three.js primitives (nothing downloaded, no model files): the orange
// cloud, one model per piece of the stack (the ids in gitpath.ts's STACK), the road's events and the unicyclist. The cloud is a
// stand-in made of spheres, not Cloudflare's mark, and the stack pieces are generic shapes (a cylinder for
// a database, a bucket, a crate), not Cloudflare's product icons. Each model is about one unit across and
// centred on its own origin; scene.ts scales and places them.
import {
  BoxGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  IcosahedronGeometry, OctahedronGeometry, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type Material, type Texture,
} from "three";

export const COLORS = { orange: 0xe8590c, orangeLight: 0xf8c9a1, paper: 0xfcfbf8, ink: 0x1b1b1b, grey: 0x9c9686, skin: 0xf2c9a0, hair: 0x3b2a20 };

const materials = new Map<number, MeshLambertMaterial>();
/** One shared material per colour. */
export const lambert = (color: number): MeshLambertMaterial => {
  let m = materials.get(color);
  if (!m) materials.set(color, (m = new MeshLambertMaterial({ color })));
  return m;
};

const mesh = (g: BufferGeometry, color: number | Material, at: [number, number, number] = [0, 0, 0]) => {
  const m = new Mesh(g, typeof color === "number" ? lambert(color) : color);
  m.position.set(...at);
  return m;
};

/** The orange cloud: three spheres on a rounded base, squashed front to back like a thick sticker. */
export function cloud(color: number = COLORS.orange): Group {
  const g = new Group();
  const base = mesh(new CapsuleGeometry(0.2, 0.55, 6, 14), color, [0, -0.12, 0]);
  base.rotation.z = Math.PI / 2;
  g.add(base, mesh(new SphereGeometry(0.27, 18, 14), color, [-0.2, 0.02, 0]), mesh(new SphereGeometry(0.34, 20, 16), color, [0.1, 0.1, 0]));
  g.scale.z = 0.5;
  return g;
}

const hexagon = () => { const m = mesh(new CylinderGeometry(0.5, 0.5, 0.3, 6), COLORS.orange); m.rotation.x = Math.PI / 2; return m; };

const MODELS: Record<string, () => Group> = {
  cloud,
  // Workers: a hexagon with a lighter one set in it.
  workers: () => {
    const g = new Group(), inner = mesh(new CylinderGeometry(0.28, 0.28, 0.34, 6), COLORS.paper);
    inner.rotation.x = Math.PI / 2;
    g.add(hexagon(), inner);
    return g;
  },
  // Durable Objects: a cube with a band round it, a thing that stays put.
  "durable-objects": () => {
    const g = new Group();
    g.add(mesh(new BoxGeometry(0.8, 0.8, 0.8), COLORS.orange), mesh(new BoxGeometry(0.84, 0.18, 0.84), COLORS.paper));
    g.rotation.set(0.35, 0.6, 0);
    return g;
  },
  // D1: the database stack, three discs.
  d1: () => {
    const g = new Group();
    for (const y of [-0.3, 0, 0.3]) g.add(mesh(new CylinderGeometry(0.42, 0.42, 0.24, 24), COLORS.orange, [0, y, 0]), mesh(new CylinderGeometry(0.43, 0.43, 0.04, 24), COLORS.paper, [0, y + 0.13, 0]));
    return g;
  },
  // R2: a bucket, wider at the rim.
  r2: () => {
    const g = new Group(), rim = mesh(new TorusGeometry(0.46, 0.04, 8, 28), COLORS.paper, [0, 0.4, 0]);
    rim.rotation.x = Math.PI / 2;
    g.add(mesh(new CylinderGeometry(0.46, 0.34, 0.8, 24, 1, true), new MeshLambertMaterial({ color: COLORS.orange, side: DoubleSide })), mesh(new CylinderGeometry(0.34, 0.34, 0.04, 24), COLORS.orange, [0, -0.4, 0]), rim);
    return g;
  },
  // Queues: slabs in a line, each a step along.
  queues: () => {
    const g = new Group();
    [0, 1, 2].forEach((k) => g.add(mesh(new BoxGeometry(0.34, 0.5 - k * 0.08, 0.7), k === 0 ? COLORS.orange : COLORS.orangeLight, [-0.38 + k * 0.38, 0, 0])));
    return g;
  },
  // Containers: a shipping box with ribs.
  containers: () => {
    const g = new Group();
    g.add(mesh(new BoxGeometry(1, 0.6, 0.6), COLORS.orange));
    for (const x of [-0.36, -0.12, 0.12, 0.36]) g.add(mesh(new BoxGeometry(0.05, 0.62, 0.62), COLORS.paper, [x, 0, 0]));
    g.rotation.y = 0.5;
    return g;
  },
  // Artifacts: a cut gem.
  artifacts: () => {
    const g = new Group();
    g.add(mesh(new OctahedronGeometry(0.55), COLORS.orange));
    g.scale.y = 1.25;
    return g;
  },
  // Rate limiting: a gauge ring with a needle.
  "rate-limit": () => {
    const g = new Group(), needle = mesh(new BoxGeometry(0.06, 0.36, 0.06), COLORS.ink, [0.08, 0.14, 0.04]);
    needle.rotation.z = -0.7;
    g.add(mesh(new TorusGeometry(0.42, 0.1, 12, 30), COLORS.orange), needle, mesh(new SphereGeometry(0.08, 10, 8), COLORS.ink, [0, 0, 0.04]));
    return g;
  },
  // Static assets: a tile of four.
  assets: () => {
    const g = new Group();
    for (const [x, y] of [[-0.26, 0.26], [0.26, 0.26], [-0.26, -0.26], [0.26, -0.26]] as const) g.add(mesh(new BoxGeometry(0.46, 0.46, 0.2), (x > 0) === (y > 0) ? COLORS.orange : COLORS.orangeLight, [x, y, 0]));
    return g;
  },
};

/** A fresh model of a stack piece (or `cloud`) by its id. */
export function model(id: string): Group {
  const make = MODELS[id];
  if (!make) throw new Error(`no model for ${id}`);
  return make();
}
export const modelIds = () => Object.keys(MODELS);

// -- the road's events -----------------------------------------------------------------------------
// What git throws at the rider (rideEvents in gitpath.ts): each a small model standing on the board.

const EVENTS: Record<string, () => Group> = {
  // A merge is a car, nose toward the viewer.
  merge: () => {
    const g = new Group();
    g.add(mesh(new BoxGeometry(1.5, 0.45, 0.85), COLORS.orange, [0, 0.45, 0]), mesh(new BoxGeometry(0.85, 0.4, 0.75), COLORS.paper, [0, 0.85, -0.02]));
    for (const x of [-0.6, 0.6]) for (const z of [-0.32, 0.32]) { const w = mesh(new CylinderGeometry(0.2, 0.2, 0.16, 14), COLORS.ink, [x, 0.2, z]); w.rotation.x = Math.PI / 2; w.rotation.z = Math.PI / 2; g.add(w); }
    for (const x of [-0.5, 0.5]) g.add(mesh(new SphereGeometry(0.09, 8, 6), 0xffe08a, [x, 0.5, 0.44]));
    return g;
  },
  // A fork in the road is a table fork stood on its handle.
  fork: () => {
    const g = new Group();
    g.add(mesh(new CylinderGeometry(0.05, 0.05, 0.9, 8), COLORS.ink, [0, 0.45, 0]), mesh(new BoxGeometry(0.5, 0.06, 0.06), COLORS.ink, [0, 0.9, 0]));
    for (const x of [-0.22, 0, 0.22]) g.add(mesh(new CylinderGeometry(0.035, 0.035, 0.5, 6), COLORS.ink, [x, 1.15, 0]));
    return g;
  },
  // The first commit on a branch is a fallen branch, twigs and leaves.
  branch: () => {
    const g = new Group(), bark = 0x8a5a3c;
    const log = mesh(new CylinderGeometry(0.09, 0.07, 2.2, 8), bark, [0, 0.12, 0]);
    log.rotation.z = Math.PI / 2;
    g.add(log);
    for (const x of [-0.7, 0, 0.6]) {
      const twig = mesh(new CylinderGeometry(0.03, 0.04, 0.5, 5), bark, [x + 0.1, 0.4, 0]);
      twig.rotation.z = -0.3;
      const leaf = mesh(new SphereGeometry(0.12, 8, 6), 0x5f9b4b, [x + 0.2, 0.68, 0]);
      leaf.scale.set(1.2, 0.7, 0.9);
      g.add(twig, leaf);
    }
    return g;
  },
  // A big squash merge is a boulder.
  squash: () => {
    const g = new Group(), rock = mesh(new IcosahedronGeometry(0.62, 1), 0xb7b3a8, [0, 0.62, 0]);
    g.add(rock);
    return g;
  },
};

/** A fresh model of a ride event by its kind. */
export function eventModel(kind: string): Group {
  const make = EVENTS[kind];
  if (!make) throw new Error(`no model for the ${kind} event`);
  return make();
}
export const eventKinds = () => Object.keys(EVENTS);

// -- the unicyclist --------------------------------------------------------------------------------

export interface Unicyclist {
  group: Group;
  /** What leans and tips: everything, hinged at the ground under the wheel. */
  tilt: Group;
  /** Turns as the wheel rolls. */
  wheel: Group;
  pedals: [Mesh, Mesh];
  legs: [Mesh, Mesh];
  arms: [Group, Group];
  /** The disc on the back of the shirt a picture is put on. */
  badge: Mesh;
}

const HUB = 0.9, HIP = 2.5, CRANK = 0.36;

/** Stretches a unit-height cylinder between two points. */
function link(m: Mesh, a: Vector3, b: Vector3) {
  const d = b.clone().sub(a), len = d.length() || 1e-3;
  m.position.copy(a.clone().add(b).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d.divideScalar(len));
  m.scale.y = len;
}

/**
 * A unicyclist in an orange shirt and black shorts with the orange cloud on them, seen from behind: it faces
 * -z, away from the viewer, riding up the board. About 4.5 units tall on a wheel 1.8 across, wheel on y = 0.
 */
export function unicyclist(): Unicyclist {
  const group = new Group(), tilt = new Group();
  group.add(tilt);
  // The wheel, with spokes, turning about x as it rolls along -z.
  const wheel = new Group();
  wheel.position.set(0, HUB, 0);
  const ring = mesh(new TorusGeometry(HUB - 0.06, 0.07, 10, 36), COLORS.ink);
  ring.rotation.y = Math.PI / 2;
  wheel.add(ring);
  for (let k = 0; k < 5; k++) { const spoke = mesh(new BoxGeometry(0.03, (HUB - 0.1) * 2, 0.03), COLORS.grey); spoke.rotation.x = (k * Math.PI) / 5; wheel.add(spoke); }
  tilt.add(wheel, mesh(new BoxGeometry(0.1, HIP - HUB - 0.2, 0.1), COLORS.ink, [0, (HIP + HUB) / 2 - 0.1, 0]), mesh(new BoxGeometry(0.75, 0.12, 0.42), COLORS.ink, [0, HIP - 0.05, 0]));
  // Pedals on the cranks, and legs from the hips down to them.
  const pedals = [-1, 1].map(() => { const p = mesh(new BoxGeometry(0.3, 0.07, 0.2), COLORS.paper); tilt.add(p); return p; }) as [Mesh, Mesh];
  const legs = [-1, 1].map(() => { const l = mesh(new CylinderGeometry(0.11, 0.1, 1, 8), COLORS.skin); tilt.add(l); return l; }) as [Mesh, Mesh];
  // Shorts, then the shirt, and the cloud on the shorts both sides.
  tilt.add(mesh(new BoxGeometry(0.8, 0.5, 0.5), COLORS.ink, [0, HIP + 0.2, 0]));
  for (const z of [0.26, -0.26]) { const c = cloud(); c.scale.multiplyScalar(0.34); c.position.set(0, HIP + 0.2, z); if (z < 0) c.rotation.y = Math.PI; tilt.add(c); }
  const shirt = mesh(new CapsuleGeometry(0.4, 0.5, 6, 14), COLORS.orange, [0, HIP + 0.95, 0]);
  shirt.scale.z = 0.62;
  tilt.add(shirt);
  const badge = new Mesh(new CircleGeometry(0.27, 24), new MeshBasicMaterial({ color: 0xffffff }));
  badge.position.set(0, HIP + 0.95, 0.27); badge.visible = false;
  tilt.add(badge);
  // Arms out for balance, hinged at the shoulders.
  const arms = [-1, 1].map((side) => {
    const arm = new Group();
    arm.position.set(side * 0.52, HIP + 1.3, 0);
    arm.add(mesh(new CapsuleGeometry(0.09, 0.5, 4, 10), COLORS.skin, [0, -0.33, 0]), mesh(new SphereGeometry(0.15, 10, 8), COLORS.orange));
    tilt.add(arm);
    return arm;
  }) as [Group, Group];
  // The head from behind: hair over most of it, ears either side. (The face is on the other side, for when it turns.)
  const head = new Group();
  head.position.set(0, HIP + 1.75, 0);
  head.add(mesh(new SphereGeometry(0.38, 22, 16), COLORS.skin), mesh(new SphereGeometry(0.4, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.68), COLORS.hair, [0, 0.02, 0.04]));
  for (const x of [-0.38, 0.38]) head.add(mesh(new SphereGeometry(0.07, 8, 6), COLORS.skin, [x, 0, 0]));
  for (const x of [-0.13, 0.13]) head.add(mesh(new SphereGeometry(0.04, 8, 6), COLORS.ink, [x, 0.02, -0.35]));
  tilt.add(head);
  const u = { group, tilt, wheel, pedals, legs, arms, badge };
  pose(u, { lean: 0, crank: 0, wheel: 0, tip: 0 });
  return u;
}

/** Puts a picture on the back of the shirt, or the plain shirt back again. */
export function setBadge(u: Unicyclist, texture: Texture | null) {
  const m = u.badge.material as MeshBasicMaterial;
  m.map = texture; m.needsUpdate = true;
  u.badge.visible = !!texture;
}

export interface Pose {
  /** -1..1, how far it leans, which tips the body and brings the arm on that side down. */
  lean: number;
  /** Turns of the crank, a half turn a stroke, and of the wheel. */
  crank: number; wheel: number;
  /** Radians the whole thing is tipped over by: the lean's share, or a spill's. */
  tip: number;
}

/** Sets the unicyclist's joints: the wheel, cranks, legs and arms. */
export function pose(u: Unicyclist, p: Pose) {
  u.tilt.rotation.z = -p.tip;
  u.wheel.rotation.x = -p.wheel;
  [-1, 1].forEach((side, k) => {
    const a = p.crank * 2 * Math.PI + (side > 0 ? 0 : Math.PI);
    const foot = new Vector3(side * 0.4, HUB + Math.sin(a) * CRANK, Math.cos(a) * CRANK);
    u.pedals[k]!.position.copy(foot);
    link(u.legs[k]!, new Vector3(side * 0.25, HIP + 0.1, 0), foot.clone().add(new Vector3(0, 0.05, 0)));
    u.arms[k]!.rotation.z = side * (1.7 - side * p.lean * 0.7);
  });
}
