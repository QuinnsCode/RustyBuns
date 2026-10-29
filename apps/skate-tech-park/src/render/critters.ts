// Life in the background: birds that sit on the ground and burst into the air, rabbits and squirrels that
// bolt, and a few gliders wheeling overhead. Everything runs from whoever comes near (the rider, the camera)
// and is never caught: a runner outpaces them for the first stretch, then they settle again somewhere farther off.
// Like the scenery they are only for looking at, so they pass through pieces and take no part in the sim.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Species = "bird" | "rabbit" | "squirrel";
type Ground = { R: number; height(x: number, z: number): number };
type Point = { x: number; z: number };

export const ALERT = { bird: 11, rabbit: 14, squirrel: 12 } as const satisfies Record<Species, number>; // metres a threat gets before they go
export const SPEED = { bird: 11, rabbit: 9, squirrel: 8 } as const satisfies Record<Species, number>; // flight or sprint, m/s
const SETTLE = 38; // a runner stops running once every threat is this far off
const NEAR = 18, FAR = 40; // metres from the viewer within which a settled critter is placed
const CLIMB = 4; // m/s a flushed bird gains, up to CEILING
const CEILING = 14;

export type Critter = {
  species: Species;
  x: number; y: number; z: number; yaw: number;
  state: "sit" | "flee" | "wheel";
  t: number; // seconds in the state (drives hops, flaps and idle shuffles)
  size: number;
  batch: THREE.InstancedMesh; // the shared mesh for this species and tint
  slot: number; // this critter's instance in it
  wing: number; // its first wing instance (a bird has two), -1 for none
};

const FUSED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const WING = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
const blob = (r: number, color: number, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0) => {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz)));
  const c = new THREE.Color(color), n = g.getAttribute("position").count;
  g.setAttribute("color", new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [c.r, c.g, c.b]).flat(), 3));
  return g;
};

/** Each critter body is its lumps merged into one geometry (about 1 m long at size 1, facing local +z), each lump keeping its colour. */
function body(species: Species, tint: number): THREE.BufferGeometry {
  const parts = species === "bird"
    ? [blob(0.1, tint, 0.8, 0.8, 1.3), blob(0.06, tint, 1, 1, 1, 0, 0.07, 0.14), blob(0.025, 0xe8a33a, 0.6, 0.6, 1.6, 0, 0.07, 0.22)]
    : species === "rabbit"
      ? [blob(0.12, tint, 0.9, 0.9, 1.3), blob(0.07, tint, 1, 1, 1, 0, 0.09, 0.15), blob(0.04, 0xf4f0e6, 1, 1, 1, 0, 0.03, -0.17), ...[-1, 1].map((s) => blob(0.025, tint, 0.6, 3, 0.6, s * 0.035, 0.2, 0.14))]
      : [blob(0.07, tint, 0.9, 0.9, 1.4), blob(0.05, tint, 1, 1, 1, 0, 0.08, 0.11), blob(0.07, 0xe6ddd0, 0.6, 1.8, 0.8, 0, 0.12, -0.12)];
  return mergeGeometries(parts)!;
}

const TINTS: Record<Species, number[]> = { bird: [0x4a5f8a, 0xb8473a, 0x6e6a62, 0x3d3d46], rabbit: [0xa89578, 0x8a7a64, 0xc2b49a], squirrel: [0x9a5a30, 0x7d4a28, 0x8c8f93] };
const SIZE: Record<Species, [number, number]> = { bird: [0.9, 1.3], rabbit: [0.9, 1.2], squirrel: [0.9, 1.1] };

export class Critters {
  readonly group = new THREE.Group();
  readonly all: Critter[] = [];
  private rng: () => number;
  private tints = new Map<Critter, number>();
  private meshes: THREE.InstancedMesh[] = [];
  private wings: THREE.InstancedMesh | null = null;

  /** `birds` and `ground` critters (split between rabbits and squirrels) sit about, and `gliders` fly circles overhead. */
  constructor(private ground: Ground, around: Point = { x: 0, z: 0 }, counts = { birds: 10, ground: 8, gliders: 3 }, seed = 11) {
    this.rng = mulberry32(seed);
    const add = (species: Species, state: Critter["state"]) => {
      const rng = this.rng, tints = TINTS[species], [lo, hi] = SIZE[species], size = lo + rng() * (hi - lo), tint = tints[Math.floor(rng() * tints.length)]!;
      const c: Critter = { species, x: 0, y: 0, z: 0, yaw: rng() * Math.PI * 2, state, t: rng() * 5, size, batch: null!, slot: 0, wing: -1 };
      this.all.push(c); this.tints.set(c, tint);
      this.settle(c, [around]);
      if (state === "wheel") c.y = this.ground.height(c.x, c.z) + 8 + rng() * 8;
    };
    for (let i = 0; i < counts.birds; i++) add("bird", "sit");
    for (let i = 0; i < counts.ground; i++) add(i % 2 ? "squirrel" : "rabbit", "sit");
    for (let i = 0; i < counts.gliders; i++) add("bird", "wheel");
    this.batchUp();
    this.update(0, []);
  }

  /** One InstancedMesh per species and tint for the bodies, and one for every bird's wings: a handful of draws however many critters. */
  private batchUp() {
    const groups = new Map<string, Critter[]>(), birds = this.all.filter((c) => c.species === "bird");
    for (const c of this.all) { const k = c.species + this.tints.get(c)!; groups.set(k, [...(groups.get(k) ?? []), c]); }
    for (const list of groups.values()) {
      const m = new THREE.InstancedMesh(body(list[0]!.species, this.tints.get(list[0]!)!), FUSED, list.length);
      m.castShadow = true; m.frustumCulled = false;
      list.forEach((c, i) => { c.batch = m; c.slot = i; });
      this.group.add(m); this.meshes.push(m);
    }
    if (!birds.length) return;
    const wing = new THREE.BoxGeometry(0.22, 0.01, 0.1);
    this.wings = new THREE.InstancedMesh(wing, WING, birds.length * 2);
    this.wings.castShadow = true; this.wings.frustumCulled = false;
    birds.forEach((c, i) => { c.wing = i * 2; for (let k = 0; k < 2; k++) this.wings!.setColorAt(c.wing + k, new THREE.Color(this.tints.get(c)!)); });
    this.group.add(this.wings);
  }

  /** Put a critter down on open ground a fair way from every viewer (never inside the near ring). */
  private settle(c: Critter, viewers: Point[]) {
    const rng = this.rng, lim = this.ground.R - 8, v = viewers[Math.floor(rng() * viewers.length)] ?? { x: 0, z: 0 };
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2, d = NEAR + rng() * (FAR - NEAR), x = v.x + Math.sin(a) * d, z = v.z + Math.cos(a) * d;
      if (Math.hypot(x, z) > lim) continue;
      if (viewers.some((p) => Math.hypot(p.x - x, p.z - z) < NEAR)) continue;
      c.x = x; c.z = z; break;
    }
    c.y = this.ground.height(c.x, c.z);
    c.yaw = rng() * Math.PI * 2;
    if (c.state !== "wheel") { c.state = "sit"; c.t = rng() * 5; }
  }

  /** Advance everyone `dt` seconds; `threats` are the points they run from (the rider and the camera). */
  update(dt: number, threats: Point[]) {
    const lim = this.ground.R - 6;
    for (const c of this.all) {
      c.t += dt;
      let nearest: Point | null = null, nd = Infinity;
      for (const p of threats) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < nd) { nd = d; nearest = p; } }
      const ground = this.ground.height(c.x, c.z);
      if (c.state === "wheel") { // gliders circle around the viewer's side of the park, drifting off if one gets close
        c.yaw += dt * 0.5;
        c.x += Math.sin(c.yaw) * 6 * dt; c.z += Math.cos(c.yaw) * 6 * dt;
        const r = Math.hypot(c.x, c.z);
        if (r > lim) { c.x *= lim / r; c.z *= lim / r; c.yaw += Math.PI * 0.5; }
        c.y = Math.max(c.y, ground + 6);
      } else if (c.state === "sit") {
        if (nearest && nd < ALERT[c.species]) { c.state = "flee"; c.t = 0; }
        else if (c.species !== "bird" && Math.sin(c.t * 0.7 + c.size * 40) > 0.97) { // now and then a little shuffle
          c.x += Math.sin(c.yaw) * 1.5 * dt; c.z += Math.cos(c.yaw) * 1.5 * dt;
        }
        c.y = ground;
      } else {
        // Run (or fly) straight away from the nearest threat, sliding along the park's edge rather than out of it.
        let dx = nearest ? c.x - nearest.x : Math.sin(c.yaw), dz = nearest ? c.z - nearest.z : Math.cos(c.yaw);
        const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
        const step = SPEED[c.species] * dt, nx = c.x + dx * step, nz = c.z + dz * step, nr = Math.hypot(nx, nz);
        if (nr > lim) { const rx = nx / nr, rz = nz / nr, out = dx * rx + dz * rz; dx -= out * rx; dz -= out * rz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
        c.x += dx * step; c.z += dz * step;
        c.yaw += Math.atan2(Math.sin(Math.atan2(dx, dz) - c.yaw), Math.cos(Math.atan2(dx, dz) - c.yaw)) * Math.min(1, dt * 12);
        const g = this.ground.height(c.x, c.z);
        if (c.species === "bird") c.y = Math.min(Math.max(c.y, g) + CLIMB * dt, g + CEILING);
        else c.y = g + Math.abs(Math.sin(c.t * 11)) * 0.25 * c.size; // hop, hop, hop
        if (nd > SETTLE || c.t > 12) this.settle(c, threats.length ? threats : [{ x: c.x, z: c.z }]);
      }
      this.pose(c);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
    if (this.wings) this.wings.instanceMatrix.needsUpdate = true;
  }

  private pose(c: Critter) {
    const flying = c.species === "bird" && c.state !== "sit";
    const base = M.compose(P.set(c.x, c.y, c.z), Q.setFromEuler(E.set(flying ? -0.15 : 0, c.yaw, 0)), S.setScalar(c.size));
    c.batch.setMatrixAt(c.slot, base);
    if (c.wing < 0) return;
    for (let i = 0; i < 2; i++) { // each wing hinges at the shoulder and swings about the body's z axis
      const side = i ? 1 : -1, ang = (i ? -1 : 1) * (flying ? Math.sin(c.t * 22 + (c.state === "wheel" ? 0 : 1)) * 0.9 : 0.15);
      this.wings!.setMatrixAt(c.wing + i, W.multiplyMatrices(base, W.compose(P.set(side * 0.05 + Math.cos(ang) * side * 0.11, 0.04 + Math.sin(ang) * side * 0.11, 0), Q.setFromEuler(E.set(0, 0, ang)), S.set(1, 1, 1))));
    }
  }
}

const M = new THREE.Matrix4(), W = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
