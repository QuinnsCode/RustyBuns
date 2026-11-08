// Pockets: the dense places that load on their own (docs/WORLD-EXPANSION.md, step 4 of #3161). A pocket is a layout,
// walls round the ring, a roof, its own fog and its own lights, laid over a region's arena look, so a lair can be
// dark and lit by lanterns without costing the open world anything. Each playable region's mythic fights in one:
// a ring to fight in, rooms opening off it past the walls, and the small things that live there. On the open world
// a lair is a cave mouth over the region's arena ring (`caveMouth`), so you walk into it.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

/** A lantern, a fire or a glow: where (metres, the ring's centre at 0), its colour, power and `flicker` 0 (steady) to 1. */
export interface Lamp { at: [number, number, number]; color: number; power: number; flicker: number }
/** A room past the ring's wall: `at` degrees round the ring (0 is +z, 90 is +x, the lake's side), `r` metres across
 * its middle, with a heap of fallen rock and, if it has one, its own light. */
export interface Room { at: number; r: number; light?: Omit<Lamp, "at"> }
/** The small things that live there; `n` of them. */
export type Critter = keyof typeof CRITTERS;

export interface Pocket {
  name: string;
  /** The region whose arena look it borrows (floor, lake, colours) and whose mythic it holds. */
  region: string;
  /** Rock all round: metres out past the ring, how tall, how rough (metres the face juts in and out), and its colour. */
  walls: { out: number; height: number; jag: number; color: number };
  /** A low dome over the ring, metres above the floor at its crown. */
  roof: { height: number; color: number };
  /** Fog from `near` to `far` metres, in `color`; the sky behind it is the same colour. */
  fog: { near: number; far: number; color: number };
  /** Where the light comes from: lanterns and fires. */
  lights: Lamp[];
  rooms: Room[];
  critters: { kind: Critter; n: number }[];
}

/** How each small creature looks and moves: flying under the roof, a glow drifting (or clinging, `speed` 0), or
 * scuttling round the floor between the ring and the wall. */
export const CRITTERS = {
  bats: { move: "fly", color: 0x1a1614, size: 0.32, speed: 4.5 },
  moths: { move: "fly", color: 0xd8ccb0, size: 0.12, speed: 1.6 },
  fireflies: { move: "glow", color: 0xd8f070, size: 0.05, speed: 0.4 },
  glowworms: { move: "glow", color: 0x7ad8ff, size: 0.04, speed: 0 },
  rats: { move: "scuttle", color: 0x3a3028, size: 0.22, speed: 2.2 },
  crayfish: { move: "scuttle", color: 0x8a3a24, size: 0.16, speed: 0.9 },
  scorpions: { move: "scuttle", color: 0x6a4a1c, size: 0.14, speed: 1.4 },
} as const satisfies Record<string, { move: "fly" | "glow" | "scuttle"; color: number; size: number; speed: number }>;

const lantern = 0xffa04a;
export const POCKETS: Record<string, Pocket> = {
  "pine-barrens-lair": {
    name: "The hollow under Leeds Point",
    region: "pine-barrens",
    walls: { out: 5, height: 12, jag: 1.4, color: 0x5a4a3a },
    roof: { height: 15, color: 0x3e3328 },
    fog: { near: 14, far: 48, color: 0x1c1a16 },
    lights: [
      { at: [-10, 4, 9], color: lantern, power: 90, flicker: 0.5 }, // a hunter's lantern left on a ledge
      { at: [-6, 3, -12], color: lantern, power: 70, flicker: 0.6 },
      { at: [12, 2.5, -4], color: 0x9fe07a, power: 60, flicker: 0.25 }, // bog-light over the black water
    ],
    rooms: [{ at: 215, r: 6, light: { color: 0x9fe07a, power: 30, flicker: 0.3 } }, { at: 330, r: 4.5 }], // the roost, and a dry hole
    critters: [{ kind: "bats", n: 24 }, { kind: "fireflies", n: 30 }],
  },
  "appalachian-hollows-lair": {
    name: "The bunkers in the TNT area",
    region: "appalachian-hollows",
    walls: { out: 4, height: 9, jag: 0.4, color: 0x6a6a62 }, // poured concrete, gone green
    roof: { height: 12, color: 0x4a4a44 },
    fog: { near: 12, far: 44, color: 0x14161a },
    lights: [
      { at: [-11, 5, 6], color: 0xffc070, power: 80, flicker: 0.15 }, // a sodium work lamp still on its cable
      { at: [4, 6, -13], color: 0xff2a1a, power: 45, flicker: 0.1 }, // two red lights high up that never blink together
      { at: [5.4, 6, -13], color: 0xff2a1a, power: 45, flicker: 0.1 },
    ],
    rooms: [{ at: 160, r: 5, light: { color: 0xffc070, power: 25, flicker: 0.2 } }, { at: 250, r: 5 }, { at: 340, r: 5 }],
    critters: [{ kind: "moths", n: 36 }, { kind: "rats", n: 8 }],
  },
  "great-north-woods-lair": {
    name: "The windfall under the logging camp",
    region: "great-north-woods",
    walls: { out: 5, height: 10, jag: 1.6, color: 0x4a3a2a }, // root and peat
    roof: { height: 13, color: 0x2e2418 },
    fog: { near: 12, far: 42, color: 0x161812 },
    lights: [
      { at: [-9, 3, 10], color: lantern, power: 80, flicker: 0.55 }, // a sawyer's lantern hung on a root
      { at: [10, 2, -9], color: lantern, power: 50, flicker: 0.7 },
    ],
    rooms: [{ at: 200, r: 5.5 }, { at: 300, r: 4, light: { color: lantern, power: 20, flicker: 0.6 } }],
    critters: [{ kind: "moths", n: 20 }, { kind: "rats", n: 10 }],
  },
  "pacific-northwest-rainforest-lair": {
    name: "A lava tube under the mountain",
    region: "pacific-northwest-rainforest",
    walls: { out: 4, height: 8, jag: 0.9, color: 0x2e2a28 }, // black basalt
    roof: { height: 11, color: 0x24201e },
    fog: { near: 12, far: 46, color: 0x101414 },
    lights: [
      { at: [0, 10, 4], color: 0xb8d8e0, power: 120, flicker: 0 }, // daylight down a skylight where the roof fell in
      { at: [-12, 1.5, -5], color: 0xfff0c0, power: 40, flicker: 0.3 }, // a dropped headlamp
    ],
    rooms: [{ at: 0, r: 4.5 }, { at: 180, r: 5.5 }],
    critters: [{ kind: "bats", n: 16 }, { kind: "glowworms", n: 60 }],
  },
  "great-lakes-and-lake-champlain-lair": {
    name: "The sea cave under the cliffs",
    region: "great-lakes-and-lake-champlain",
    walls: { out: 5, height: 11, jag: 1.1, color: 0x6e7478 }, // wet limestone
    roof: { height: 14, color: 0x4a5058 },
    fog: { near: 14, far: 50, color: 0x141c22 },
    lights: [
      { at: [13, 1, 2], color: 0x6ad0e0, power: 90, flicker: 0.4 }, // the lake's light thrown up off the water
      { at: [-10, 3, -8], color: lantern, power: 60, flicker: 0.4 }, // a fisherman's lantern
    ],
    rooms: [{ at: 230, r: 6 }],
    critters: [{ kind: "crayfish", n: 14 }, { kind: "bats", n: 10 }],
  },
  "southwest-desert-lair": {
    name: "The played-out mine at the end of the ranch road",
    region: "southwest-desert",
    walls: { out: 4, height: 8, jag: 1.0, color: 0x9a5a34 },
    roof: { height: 10, color: 0x6a3a22 },
    fog: { near: 14, far: 46, color: 0x1e140e },
    lights: [
      { at: [-10, 4, 8], color: 0xffd090, power: 70, flicker: 0.1 }, // a miner's work light on the timbers
      { at: [-8, 4, -10], color: 0xffd090, power: 50, flicker: 0.8 }, // its twin, on a failing wire
    ],
    rooms: [{ at: 190, r: 4 }, { at: 270, r: 4, light: { color: 0xffd090, power: 18, flicker: 0.3 } }, { at: 350, r: 4 }], // drifts off the stope
    critters: [{ kind: "scorpions", n: 12 }, { kind: "bats", n: 12 }],
  },
  "bayou-and-everglades-lair": {
    name: "The sunken hollow under the cypress",
    region: "bayou-and-everglades",
    walls: { out: 5, height: 9, jag: 1.5, color: 0x3a3424 }, // mud and knees of root
    roof: { height: 12, color: 0x262418 },
    fog: { near: 10, far: 40, color: 0x161a10 },
    lights: [
      { at: [11, 2, 6], color: 0x9fe07a, power: 60, flicker: 0.3 },
      { at: [-9, 3, 9], color: lantern, power: 70, flicker: 0.5 }, // a trapper's lantern
    ],
    rooms: [{ at: 210, r: 5 }, { at: 320, r: 5.5, light: { color: 0x9fe07a, power: 20, flicker: 0.4 } }],
    critters: [{ kind: "fireflies", n: 50 }, { kind: "crayfish", n: 12 }],
  },
  "ozarks-and-the-southern-plains-lair": {
    name: "The bluff shelter over the river",
    region: "ozarks-and-the-southern-plains",
    walls: { out: 5, height: 10, jag: 1.2, color: 0x8a7a64 }, // dolomite
    roof: { height: 13, color: 0x5a5040 },
    fog: { near: 14, far: 48, color: 0x1a1612 },
    lights: [
      { at: [-8, 0.6, 8], color: 0xff8a3a, power: 90, flicker: 0.7 }, // somebody's campfire, left burning
      { at: [9, 4, -10], color: lantern, power: 50, flicker: 0.4 },
    ],
    rooms: [{ at: 180, r: 5 }, { at: 290, r: 4.5 }],
    critters: [{ kind: "bats", n: 30 }, { kind: "moths", n: 12 }],
  },
};

/** A seeded bump for the rock: the same pocket always has the same walls. */
const bump = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/** Rough rock: the faces drawn from within (BackSide) by default, so a camera outside the walls still sees in. */
function rock(geo: THREE.BufferGeometry, jag: number, color: number, side: THREE.Side = THREE.BackSide) {
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), k = r > 1e-3 ? 1 + (bump(Math.atan2(z, x) * 7, y * 0.6) * jag) / r : 1;
    p.setXYZ(i, x * k, y + bump(x, z) * jag * 0.3, z * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, side }));
  m.receiveShadow = true;
  return m;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
/** A cylinder's wall with gaps (centred at `gaps`, each `gap` radians wide), as one geometry of the arcs between. */
function walled(r: number, h: number, gaps: number[], gap: number) {
  if (!gaps.length) return new THREE.CylinderGeometry(r, r + 2, h, 48, 6, true);
  const sorted = [...gaps].sort((a, b) => a - b), parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i]! + gap / 2, to = (sorted[i + 1] ?? sorted[0]! + Math.PI * 2) - gap / 2;
    if (to > from) parts.push(new THREE.CylinderGeometry(r, r + 2, h, Math.max(4, Math.round(((to - from) / (Math.PI * 2)) * 48)), 6, true, from, to - from));
  }
  return merge(parts);
}
function merge(parts: THREE.BufferGeometry[]) {
  const pos: number[] = [], idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3, p = g.attributes.position!, ix = g.index!;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}
/** A dome of radius r over height h. */
const dome = (r: number, rise: number, h: number) => new THREE.SphereGeometry(r, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, rise / r, 1).translate(0, h, 0);

/** Where the middle of room `room` is, round a wall of radius `wall`: its rim cuts the wall, so the two open into each other. */
export function roomAt(room: Room, wall: number) {
  const d = wall + room.r * 0.6, a = rad(room.at);
  return { x: Math.sin(a) * d, z: Math.cos(a) * d };
}

/** Walls, roof, rooms, lights and small creatures of pocket `p` round a ring of radius R, into `g`; the tick flickers
 * the lanterns and moves the creatures. */
export function buildPocket(g: THREE.Group, p: Pocket, R: number): (t: number) => void {
  const r = R + p.walls.out, h = p.walls.height, door = (room: Room) => room.r * 0.75;
  // the ring's wall, open where each room is, and the dome over it
  const wide = Math.max(0, ...p.rooms.map((m) => 2 * Math.asin(Math.min(1, door(m) / r))));
  g.add(rock(walled(r, h + 2, p.rooms.map((m) => rad(m.at)), wide).translate(0, h / 2 - 1, 0), p.walls.jag, p.walls.color));
  g.add(rock(dome(r, p.roof.height - h, h), p.walls.jag, p.roof.color));
  const lamps: Lamp[] = [...p.lights];
  const rng = mulberry32(p.name.length * 7919 + r * 31);
  for (const room of p.rooms) {
    const c = roomAt(room, r), facing = rad(room.at) + Math.PI, mouth = 2 * Math.asin(Math.min(1, door(room) / room.r));
    const walls = rock(walled(room.r, h + 2, [facing], mouth).translate(0, h / 2 - 1, 0), p.walls.jag * 0.7, p.walls.color);
    const roof = rock(dome(room.r, Math.max(1, (p.roof.height - h) * 0.6), h), p.walls.jag * 0.7, p.roof.color);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(room.r + 1, 24), new THREE.MeshStandardMaterial({ color: new THREE.Color(p.walls.color).multiplyScalar(0.6), roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.02; floor.receiveShadow = true;
    for (const o of [walls, roof, floor]) o.position.set(c.x, o.position.y, c.z);
    g.add(walls, roof, floor);
    // a heap of fallen rock at the back of the room
    const heap = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: p.walls.color, roughness: 1, flatShading: true }), 7);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), back = rad(room.at);
    for (let i = 0; i < heap.count; i++) {
      const s = 0.4 + rng() * 0.9, a = back + (rng() - 0.5) * 1.6, d = room.r * (0.3 + rng() * 0.4);
      q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      heap.setMatrixAt(i, m.compose(new THREE.Vector3(c.x + Math.sin(a) * d, s * 0.4, c.z + Math.cos(a) * d), q, new THREE.Vector3(s, s * 0.7, s)));
    }
    heap.castShadow = heap.receiveShadow = true;
    g.add(heap);
    if (room.light) lamps.push({ ...room.light, at: [c.x, 2.5, c.z] });
  }
  const lit = lamps.map((l) => {
    const light = new THREE.PointLight(l.color, l.power, r * 1.6, 1.6);
    light.position.set(...l.at);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: l.color }));
    glow.position.copy(light.position);
    g.add(light, glow);
    return { light, base: l.power, flicker: l.flicker, phase: l.at[0] * 1.7 + l.at[2] };
  });
  const crowd = p.critters.map((c) => critters(g, c.kind, c.n, R, r, h, p.roof.height, rng));
  return (t) => {
    for (const l of lit) l.light.intensity = l.base * (1 - l.flicker * 0.25 * (1 + Math.sin(t * 9 + l.phase) * Math.sin(t * 3.1 + l.phase * 2)));
    for (const move of crowd) move(t);
  };
}

/** `n` small creatures of one kind as one instanced mesh, and the tick that moves them: fliers loop under the roof
 * flapping, glows drift (or cling to the roof and twinkle), scuttlers dart round the floor outside the ring, stop, go. */
function critters(g: THREE.Group, kind: Critter, n: number, R: number, wall: number, h: number, crown: number, rng: () => number) {
  const c = CRITTERS[kind];
  const geo = c.move === "fly" ? wing() : c.move === "glow" ? new THREE.SphereGeometry(1, 6, 4) : new THREE.SphereGeometry(1, 8, 6).scale(1, 0.45, 1.7);
  const mat = c.move === "glow" ? new THREE.MeshBasicMaterial({ color: c.color }) : new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.8, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false;
  g.add(mesh);
  const each = Array.from({ length: n }, () => ({
    a: rng() * Math.PI * 2, d: c.move === "scuttle" ? R + 0.8 + rng() * (wall - R - 1.6) : rng() * (wall - 1),
    y: c.move === "fly" ? h * (0.55 + rng() * 0.4) : c.move === "glow" ? (c.speed ? 0.5 + rng() * 4 : h + rng() * (crown - h) * 0.8) : 0,
    s: (0.7 + rng() * 0.6) * c.size, spin: (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.8), ph: rng() * 100,
  }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return (t: number) => {
    for (let i = 0; i < n; i++) {
      const e = each[i]!;
      let x: number, y = e.y, z: number, yaw: number, s = e.s, flat = 1;
      if (c.move === "fly") {
        const a = e.a + (t * c.speed * e.spin) / Math.max(3, e.d), d = e.d + Math.sin(t * 0.7 + e.ph) * 2;
        x = Math.sin(a) * d; z = Math.cos(a) * d; y += Math.sin(t * 2 + e.ph) * 0.8;
        yaw = a + (e.spin > 0 ? Math.PI / 2 : -Math.PI / 2); flat = 0.25 + Math.abs(Math.sin(t * (c.speed * 4) + e.ph)); // the wingbeat
      } else if (c.move === "glow") {
        const a = e.a + Math.sin(t * c.speed * 0.3 + e.ph) * 0.4, d = e.d + Math.sin(t * c.speed + e.ph * 2) * 1.5;
        x = Math.sin(a) * d; z = Math.cos(a) * d; y += Math.sin(t * c.speed * 1.3 + e.ph) * 0.6; yaw = 0;
        s *= 0.5 + 0.5 * Math.max(0, Math.sin(t * (c.speed ? 2.2 : 0.8) + e.ph)); // blinks, or twinkles
      } else {
        // a dash, then a stop: progress along its arc goes in bursts
        const k = t * c.speed * 0.25 + e.ph, go = Math.floor(k) + Math.min(1, (k % 1) * 3);
        const a = e.a + (go * e.spin * 2.4) / e.d;
        x = Math.sin(a) * e.d; z = Math.cos(a) * e.d; yaw = a + (e.spin > 0 ? Math.PI / 2 : -Math.PI / 2);
      }
      q.setFromAxisAngle(up, yaw);
      mesh.setMatrixAt(i, m.compose(v.set(x, y + s * 0.4, z), q, sc.set(s, s * flat, s)));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
}
/** Two triangles: a bat or a moth seen from below, its wings out along x. */
function wing() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0.6, -1.4, 0.3, -0.2, 0, 0, -0.4, 0, 0, 0.6, 0, 0, -0.4, 1.4, 0.3, -0.2], 3));
  geo.computeVertexNormals();
  return geo;
}

/** A lair's cave mouth on the open world: a shell of the pocket's rock over the arena's ring, open toward the way you
 * come in (`toward`, radians in the ground plane: +x is 0), with a black throat at the back. */
export function caveMouth(p: Pocket, toward: number): THREE.Group {
  const g = new THREE.Group(), R = 6.5, gap = 2.4;
  const shell = rock(new THREE.SphereGeometry(R, 28, 10, gap / 2, Math.PI * 2 - gap, 0, Math.PI / 2).scale(1, 0.8, 1), 0.9, p.walls.color, THREE.DoubleSide);
  shell.castShadow = true;
  const throat = new THREE.Mesh(new THREE.CircleGeometry(R * 0.7, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide }));
  throat.position.x = R * 0.85; throat.rotation.y = -Math.PI / 2; throat.scale.y = 0.75; // the back wall, opposite the open side
  g.add(shell, throat);
  g.rotation.y = Math.PI - toward; // SphereGeometry's phi 0 (the gap's middle) points to -x: turn it to `toward`
  return g;
}

/** The region's lair id, if it has one. */
export const lairOf = (region: string) => Object.keys(POCKETS).find((id) => POCKETS[id]!.region === region);
