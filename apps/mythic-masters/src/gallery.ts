// The gallery: sixteen of the roster at a time, standing in a 4 × 4 grid at their fight size, each in its own
// beast, facing the camera. For judging the art as a set: does each read from
// its silhouette, and do the sizes make sense next to each other? `?gallery=<page>` opens it (pages 0-3).
import * as THREE from "three";
import { loadBeast, Puppet, reloadBeast, type Beast } from "./beasts.ts";
import type { Creature } from "./roster.ts";
import { newMatch, type Fighter } from "./sim.ts";

export const PAGE = 16;
const SPACING = 4.2;

export function gallery(scene: THREE.Scene, camera: THREE.PerspectiveCamera, roster: Creature[], page: number) {
  const group = new THREE.Group(), stands: Stand[] = [];
  let dark = false;
  const FOV = camera.fov;
  scene.add(group);
  const shown = roster.slice(page * PAGE, page * PAGE + PAGE);
  shown.forEach((c, i) => {
    const f = newMatch(c, c).f[0];
    f.pos = { x: ((i % 4) - 1.5) * SPACING, y: 0, z: (Math.floor(i / 4) - 1.5) * SPACING };
    f.yaw = Math.PI / 4; // three-quarter: half profile, half toward the camera
    const stand: Stand = { id: c.id, f, p: null, beast: null, hidden: false };
    stands.push(stand);
    void loadBeast(c.id).then((beast) => put(stand, beast, c.archetype));
  });
  function put(stand: Stand, beast: Beast | null, archetype: Creature["archetype"]) {
    if (!beast || !group.parent) return;
    if (stand.p) group.remove(stand.p.group);
    stand.beast = beast;
    stand.p = new Puppet(beast, stand.f.b, archetype);
    stand.p.group.visible = !stand.hidden;
    group.add(stand.p.group);
    paint(stand.p.group, dark);
  }
  const home = () => { camera.position.set(0, 13, 17); camera.lookAt(0, 0.6, 0.5); };
  home();
  let tick = 0;
  return {
    names: shown.map((c) => c.name),
    /** Each beast on the page: what its files say (null until they load). */
    stands: stands as readonly Stand[],
    /** One beast filling the frame from `view` (the rest hidden); "grid" puts them all back. */
    focus(id: string, view: View) {
      const s = stands.find((x) => x.id === id);
      if (!s || !s.beast) return false;
      if (view === "grid") { for (const o of stands) { o.hidden = false; if (o.p) o.p.group.visible = true; } home(); return true; }
      for (const o of stands) { o.hidden = o !== s; if (o.p) o.p.group.visible = o === s; }
      s.f.yaw = YAW[view];
      const { height, extent } = s.beast.sheet, size = Math.max(height, extent);
      const d = (size * 1.0) / Math.tan((FOV * Math.PI) / 360) * Math.max(1, camera.aspect < 1 ? 1 / camera.aspect : 1) + extent / 2;
      camera.position.set(s.f.pos.x, s.f.pos.y + height * 0.55, s.f.pos.z + d);
      camera.lookAt(s.f.pos.x, s.f.pos.y + height * 0.45, s.f.pos.z);
      return true;
    },
    /** Every beast flat black against the sky, to read each from its outline alone. */
    silhouette(on: boolean) { dark = on; for (const s of stands) if (s.p) paint(s.p.group, on); },
    /** Fetch one beast's files again and stand the new puppet where the old one was. */
    async reload(id: string) {
      const s = stands.find((x) => x.id === id), c = roster.find((x) => x.id === id);
      if (s && c) put(s, await reloadBeast(id), c.archetype);
    },
    update(dt: number) {
      tick++;
      for (const s of stands) s.p?.update(s.f, dt, tick, { x: s.f.pos.x, y: 1, z: s.f.pos.z + 10 });
    },
    dispose() { scene.remove(group); },
  };
}

export type View = "side" | "front" | "three-quarter" | "grid";
// A beast faces +x at yaw 0 (side-on to the camera) and +z, toward it, at a quarter turn.
const YAW: Record<Exclude<View, "grid">, number> = { side: 0, front: Math.PI / 2, "three-quarter": Math.PI / 4 };
interface Stand { id: string; f: Fighter; p: Puppet | null; beast: Beast | null; hidden: boolean }

const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const was = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
/** Swap every mesh under `o` to flat black, or back to what it was. */
function paint(o: THREE.Object3D, black: boolean) {
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    if (black) { if (!was.has(m)) was.set(m, m.material); m.material = BLACK; }
    else { const w = was.get(m); if (w) { m.material = w; was.delete(m); } }
  });
}
