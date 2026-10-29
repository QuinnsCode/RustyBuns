// The gallery: sixteen of the roster at a time, standing in a 4 × 4 grid at their fight size, each in its own
// beast, facing the camera. For judging the art as a set: does each read from
// its silhouette, and do the sizes make sense next to each other? `?gallery=<page>` opens it (pages 0-3).
import * as THREE from "three";
import { loadBeast, Puppet } from "./beasts.ts";
import type { Creature } from "./roster.ts";
import { newMatch, type Fighter } from "./sim.ts";

export const PAGE = 16;
const SPACING = 4.2;

export function gallery(scene: THREE.Scene, camera: THREE.PerspectiveCamera, roster: Creature[], page: number) {
  const group = new THREE.Group(), stands: { f: Fighter; p: Puppet | null }[] = [];
  scene.add(group);
  const shown = roster.slice(page * PAGE, page * PAGE + PAGE);
  shown.forEach((c, i) => {
    const f = newMatch(c, c).f[0];
    f.pos = { x: ((i % 4) - 1.5) * SPACING, y: 0, z: (Math.floor(i / 4) - 1.5) * SPACING };
    f.yaw = Math.PI / 4; // three-quarter: half profile, half toward the camera
    const stand = { f, p: null as Puppet | null };
    stands.push(stand);
    void loadBeast(c.id).then((beast) => {
      if (!beast || !group.parent) return;
      stand.p = new Puppet(beast, f.b, c.archetype);
      group.add(stand.p.group);
    });
  });
  camera.position.set(0, 13, 17); camera.lookAt(0, 0.6, 0.5);
  let tick = 0;
  return {
    names: shown.map((c) => c.name),
    update(dt: number) {
      tick++;
      for (const s of stands) s.p?.update(s.f, dt, tick, { x: s.f.pos.x, y: 1, z: s.f.pos.z + 10 });
    },
    dispose() { scene.remove(group); },
  };
}
