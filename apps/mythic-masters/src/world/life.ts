// The living things of src/world/nature.ts drawn: flocks of birds on the ground that lift when you walk into them,
// wheel away and settle further on, and patches of wild food, a low bush with its fruit showing until you pick it.
// One instanced mesh for all the birds and two for every patch, laid out each frame for what is near you.
// worldView (view.ts) owns the camera and the toast; this is handed the ground and gives back what happened.
import * as THREE from "three";
import { bare, BIRDS, birdAt, FLUSH_R, flocksNear, flushHeading, forageNear, landing, PICK_R, pick, type Flock, type Patch } from "./nature.ts";
import type { World } from "./world.ts";

const SEE_R = 320;      // metres: flocks and patches further off aren't laid out
const BIRD_CAP = 400, PATCH_CAP = 160;
const FRUIT: Record<Patch["kind"], number> = { berries: 0x3a3fa8, mushrooms: 0xe8c070, fruit: 0xe05a30, herbs: 0xd8d8f0 };
const BUSH: Record<Patch["kind"], number> = { berries: 0x3f6a2e, mushrooms: 0x5a4a30, fruit: 0x4a7a38, herbs: 0x6a8a40 };

/** A bird: two wings off a short body, a flat shape the size of its span. */
function birdShape(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Body along +x (the way it flies), wings out along z, swept back and lifted at the tips.
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    0.18, 0, 0, -0.14, 0, 0.05, -0.4, 0.12, 0.5, // right wing
    0.18, 0, 0, -0.4, 0.12, -0.5, -0.14, 0, -0.05, // left wing
    0.2, 0, 0.04, -0.2, 0, 0, 0.2, 0, -0.04, // body
  ], 3));
  g.computeVertexNormals();
  return g;
}

export function lifeView(group: THREE.Group, w: World) {
  const birds = new THREE.InstancedMesh(birdShape(), new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), BIRD_CAP);
  const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), PATCH_CAP);
  const fruit = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.4 }), PATCH_CAP * 7);
  for (const m of [birds, bushes, fruit]) { m.count = 0; m.frustumCulled = false; m.castShadow = m === bushes; group.add(m); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), at = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
  /** Where every flock you've flushed has gone: when it took off, which way, and where it roosts now. */
  const flown = new Map<string, { at: number; heading: number }>(), roost = new Map<string, { x: number; z: number }>();
  const picked = new Map<string, number>();
  let clock = 0, lastFlocks: Flock[] = [], lastPatches: Patch[] = [];

  return {
    /**
     * One frame. Lays out the birds and the patches near `me` on `open` ground (`yAt` is the drawn ground), flushes
     * any flock you've walked into, and returns the patches you've just picked. `still` holds everything in place.
     */
    update(dt: number, me: { x: number; z: number }, open: ReadonlySet<number>, yAt: (x: number, z: number) => number, still = false): Patch[] {
      clock += dt;
      const got: Patch[] = [];
      // Birds.
      lastFlocks = flocksNear(w, me.x, me.z, SEE_R, open, roost);
      birds.count = 0;
      for (const f of lastFlocks) {
        let fl = flown.get(f.id);
        if (fl && clock - fl.at > BIRDS[f.kind].air) { roost.set(f.id, landing(f, fl.heading)); flown.delete(f.id); fl = undefined; continue; } // seen again next frame, at the new roost
        if (!fl && !still && Math.hypot(f.x - me.x, f.z - me.z) < FLUSH_R) { fl = { at: clock, heading: flushHeading(f, me) }; flown.set(f.id, fl); }
        const spec = BIRDS[f.kind];
        c.setHex(spec.colour);
        for (let i = 0; i < f.n && birds.count < BIRD_CAP; i++) {
          const b = birdAt(f, i, fl ? clock - fl.at : null, fl?.heading ?? 0, clock), x = f.x + b.dx, z = f.z + b.dz;
          const y = Math.max(0, yAt(x, z)) + b.h + (b.down ? 0.05 : 0);
          // Flying: wings beat as a roll of the whole shape; roosting: folded, so a narrow body.
          e.set(b.down ? 0 : b.flap * 0.5, -b.yaw, 0);
          q.setFromEuler(e);
          birds.setMatrixAt(birds.count, m4.compose(at.set(x, y, z), q, sc.set(spec.span, spec.span, b.down ? spec.span * 0.35 : spec.span)));
          birds.setColorAt(birds.count++, c);
        }
      }
      birds.instanceMatrix.needsUpdate = true;
      if (birds.instanceColor) birds.instanceColor.needsUpdate = true;
      // Patches.
      lastPatches = forageNear(w, me.x, me.z, SEE_R, open);
      bushes.count = fruit.count = 0;
      for (const p of lastPatches) {
        if (bushes.count >= PATCH_CAP) break;
        const y = yAt(p.x, p.z), empty = bare(p, picked, clock);
        if (!still && !empty && Math.hypot(p.x - me.x, p.z - me.z) < PICK_R && pick(p, picked, clock)) got.push(p);
        e.set(0, (p.x * 7 + p.z * 3) % 6.28, 0); q.setFromEuler(e);
        c.setHex(BUSH[p.kind]).multiplyScalar(empty ? 0.75 : 1);
        bushes.setMatrixAt(bushes.count, m4.compose(at.set(p.x, y + 0.35, p.z), q, sc.set(1.3, 0.9, 1.3)));
        bushes.setColorAt(bushes.count++, c);
        if (empty) continue;
        c.setHex(FRUIT[p.kind]);
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9 + p.x, r = 0.55 + 0.25 * Math.sin(i * 2.1 + p.z);
          fruit.setMatrixAt(fruit.count, m4.compose(at.set(p.x + Math.cos(a) * r, y + 0.55 + 0.3 * Math.sin(i * 1.3), p.z + Math.sin(a) * r), q, sc.set(1, 1, 1)));
          fruit.setColorAt(fruit.count++, c);
        }
      }
      for (const m of [bushes, fruit]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
      return got;
    },
    /** What lives near you now, for an agent: each flock (up or down) and each patch (bare or ripe). */
    state() {
      return {
        flocks: lastFlocks.map((f) => ({ id: f.id, kind: f.kind, n: f.n, x: +f.x.toFixed(1), z: +f.z.toFixed(1), up: flown.has(f.id) })),
        forage: lastPatches.map((p) => ({ id: p.id, name: p.name, kind: p.kind, x: +p.x.toFixed(1), z: +p.z.toFixed(1), bare: bare(p, picked, clock) })),
      };
    },
    reset() { flown.clear(); roost.clear(); picked.clear(); },
  };
}
export type LifeView = ReturnType<typeof lifeView>;
