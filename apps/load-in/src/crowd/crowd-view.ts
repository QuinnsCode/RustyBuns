// The crowd on the page: one instanced figure (a turned body, neck and head, 1.75 m) per person, one draw call. They
// come in after the doors and take the floor from the stage back, and where a region is dancing they bob on the beat.
// Positions are set once when the crowd comes in; each frame only the dancers' heights change. A big floor (an arena, a
// festival field) draws one figure for every few heads, with fewer sides, so thousands of people stay one cheap draw call.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { HEADS, densityAt } from "@rustybuns/gear";
import type { World } from "../sim.ts";
import { type Crowd, type Mood, arrived, drawn } from "./crowd.ts";

/** The house loop's tempo (audio/play.ts), beats a minute: the bob. */
const TEMPO = 120;
/** The most figures a small room draws: one per person. */
const MAX = 400;
/** The most a big floor draws; past this each figure stands for several people. */
export const MAX_BIG = 1500;

const CLOTHES = [0x22252b, 0x3b2f2a, 0x1f2e3d, 0x4a1f24, 0x2f3a2a, 0x575757, 0x6b4b2a, 0x14161a];

/** A standing person, turned round its height: feet, body, shoulders, neck and head. */
function figure(sides = 7): THREE.BufferGeometry {
  const pts = [[0, 0], [0.15, 0.02], [0.17, 0.85], [0.21, 1.3], [0.13, 1.44], [0.06, 1.48], [0.09, 1.53], [0.105, 1.62], [0.08, 1.72], [0, HEADS]];
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), sides);
}

export type CrowdView = {
  /** Each frame: who has come in so far, and the dancers' bob. */
  update(w: World, crowd: Crowd | null): void;
  /** How each region takes the sound, for who dances. */
  moods(m: readonly Mood[]): void;
  /** People drawn now. */
  shown(): number;
  dispose(): void;
};

/** `max`: the most figures (MAX_BIG for a big floor); `ground`: the height people stand at, where the floor isn't flat. */
export function crowdView(scene: THREE.Scene, { max = MAX, ground }: { max?: number; ground?: (x: number, z: number) => number } = {}): CrowdView {
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9 }), mesh = new THREE.InstancedMesh(figure(max > MAX ? 5 : 7), cloth, max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);
  let people: { x: number; y: number; z: number; rot: number; phase: number; dance: boolean }[] = [];
  let built: Crowd | null = null, moods: readonly Mood[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);

  /** Scatter the field's people over its cells (seeded, so a reload stands them the same), front rows first. */
  function place(c: Crowd) {
    const f = c.field, rnd = mulberry32(5029), dx = (f.x1 - f.x0) / f.nx, dz = (f.z1 - f.z0) / f.nz;
    const heads = drawn(c.people, max).heads;
    people = [];
    let carry = 0;
    for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) {
      carry += densityAt(f, f.x0 + (ix + 0.5) * dx, f.z0 + (iz + 0.5) * dz) * dx * dz;
      for (; carry >= heads && people.length < max; carry -= heads) {
        const x = f.x0 + (ix + rnd()) * dx, z = f.z0 + (iz + rnd()) * dz;
        people.push({ x, y: ground?.(x, z) ?? 0, z, rot: Math.PI + (rnd() - 0.5) * 0.8, phase: rnd() * 0.3, dance: false });
      }
    }
    people.sort((a, b) => Math.abs(a.z - c.spot.stageZ) - Math.abs(b.z - c.spot.stageZ));
    const col = new THREE.Color();
    people.forEach((_, k) => mesh.setColorAt(k, col.setHex(CLOTHES[Math.floor(rnd() * CLOTHES.length)]!)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    built = c;
    tagDancers();
  }

  function tagDancers() {
    if (!built) return;
    for (const person of people) {
      const r = built.spot.regions.findIndex(({ zone }) => person.x >= zone.x0 && person.x <= zone.x1 && person.z >= zone.z0 && person.z <= zone.z1);
      // Outside the scored regions (the back by the door), they follow the back's mood.
      person.dance = (moods[r >= 0 ? r : moods.length - 1]?.doing ?? "dancing") === "dancing";
    }
  }

  return {
    update(w, c) {
      if (!c) { mesh.count = 0; built = null; return; }
      if (c !== built) place(c);
      const n = Math.round(people.length * arrived(w, c));
      const beat = (w.t * TEMPO) / 60;
      for (let k = 0; k < n; k++) {
        const person = people[k]!;
        const bob = person.dance ? 0.05 * Math.abs(Math.sin(Math.PI * (beat + person.phase))) : 0;
        m.compose(p.set(person.x, person.y + bob, person.z), q.setFromAxisAngle(up, person.rot), one);
        mesh.setMatrixAt(k, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
    moods(next) { moods = next; tagDancers(); },
    shown: () => mesh.count,
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); cloth.dispose(); mesh.dispose(); },
  };
}
