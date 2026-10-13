// gitwiz's 3D models, built from three.js primitives (nothing downloaded, no model files): the orange
// cloud, one model per piece of the stack (the ids in gitwiz.ts's STACK), and the runner. The cloud is a
// stand-in made of spheres, not Cloudflare's mark, and the stack pieces are generic shapes (a cylinder for
// a database, a bucket, a crate), not Cloudflare's product icons. Each model is about one unit across and
// centred on its own origin; scene.ts scales and places them.
import {
  BoxGeometry, CapsuleGeometry, CircleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  OctahedronGeometry, SphereGeometry, TorusGeometry, type BufferGeometry, type Material, type Texture,
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

// -- the runner ------------------------------------------------------------------------------------

export interface Runner {
  group: Group;
  /** Limbs that swing, hinged at the hip and the shoulder. */
  legs: [Group, Group];
  arms: [Group, Group];
  /** The body, which bobs. */
  body: Group;
  /** The disc a picture is put on, in front of the face. */
  face: Mesh;
}

/**
 * An orange shirt, black shorts with the cloud on them, a Mii-style round head. About 2.4 units tall, facing +z
 * (toward the viewer), feet on y = 0.
 */
export function runner(): Runner {
  const group = new Group(), body = new Group();
  group.add(body);
  const limb = (x: number, y: number, len: number, color: number, r = 0.13) => {
    const hinge = new Group();
    hinge.position.set(x, y, 0);
    hinge.add(mesh(new CapsuleGeometry(r, len, 4, 10), color, [0, -len / 2 - r * 0.4, 0]));
    return hinge;
  };
  // Legs, with shoes.
  const legs = [-0.2, 0.2].map((x) => {
    const leg = limb(x, 0.92, 0.45, COLORS.skin, 0.11);
    const shoe = mesh(new SphereGeometry(0.17, 12, 10), COLORS.paper, [0, -0.78, 0.07]);
    shoe.scale.set(1, 0.6, 1.5);
    leg.add(shoe);
    body.add(leg);
    return leg;
  }) as [Group, Group];
  // Shorts and the shirt.
  body.add(mesh(new BoxGeometry(0.72, 0.5, 0.42), COLORS.ink, [0, 1.0, 0]));
  const logo = cloud();
  logo.scale.multiplyScalar(0.34); logo.position.set(0, 0.98, 0.23);
  body.add(logo);
  const shirt = mesh(new CapsuleGeometry(0.4, 0.42, 6, 14), COLORS.orange, [0, 1.58, 0]);
  shirt.scale.z = 0.62;
  body.add(shirt);
  // Arms, short orange sleeves over skin.
  const arms = [-0.55, 0.55].map((x) => {
    const arm = limb(x, 1.85, 0.42, COLORS.skin, 0.09);
    arm.add(mesh(new SphereGeometry(0.16, 12, 10), COLORS.orange, [0, 0, 0]));
    body.add(arm);
    return arm;
  }) as [Group, Group];
  // The head: skin, a cap of hair, two eyes and a smile.
  const head = new Group();
  head.position.set(0, 2.1, 0);
  head.add(mesh(new SphereGeometry(0.4, 24, 18), COLORS.skin));
  const hair = mesh(new SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), COLORS.hair, [0, 0.03, -0.02]);
  head.add(hair);
  for (const x of [-0.14, 0.14]) head.add(mesh(new SphereGeometry(0.045, 8, 6), COLORS.ink, [x, 0.02, 0.37]));
  const smile = mesh(new TorusGeometry(0.1, 0.018, 6, 14, Math.PI), 0x8a4b3a, [0, -0.1, 0.37]);
  smile.rotation.z = Math.PI;
  head.add(smile);
  for (const x of [-0.4, 0.4]) head.add(mesh(new SphereGeometry(0.07, 8, 6), COLORS.skin, [x, 0, 0]));
  const face = new Mesh(new CircleGeometry(0.4, 28), new MeshBasicMaterial({ color: 0xffffff }));
  face.position.z = 0.405; face.visible = false;
  head.add(face);
  body.add(head);
  return { group, legs, arms, body, face };
}

/** Puts a picture on the runner's face, or the default face back. */
export function setFace(r: Runner, texture: Texture | null) {
  const m = r.face.material as MeshBasicMaterial;
  m.map = texture; m.needsUpdate = true;
  r.face.visible = !!texture;
  // The default features hide behind the picture.
  const head = r.face.parent!;
  head.children.forEach((c: Mesh) => { if (c !== r.face && c.position.z > 0.3) c.visible = !texture; });
}

/** Swings the limbs through a stride: `phase` in radians, `playing` false for standing. */
export function pose(r: Runner, phase: number, playing: boolean) {
  const sw = playing ? Math.sin(phase) : 0;
  r.legs[0].rotation.x = sw * 0.9; r.legs[1].rotation.x = -sw * 0.9;
  r.arms[0].rotation.x = -sw * 0.9; r.arms[1].rotation.x = sw * 0.9;
  r.body.position.y = playing ? Math.abs(Math.cos(phase)) * 0.12 : 0;
}
