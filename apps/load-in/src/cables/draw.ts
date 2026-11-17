// The cables on screen: a tube along each laid-out rope's points, coloured by kind, rebuilt each frame it moved.
import * as THREE from "three";
import type { Cables } from "./cables.ts";

export const COLOR: Record<string, number> = { power: 0x1b1b1b, speaker: 0x2a3f8f, xlr: 0x3a3a3a, instrument: 0x8f2a2a };

export function cableView(scene: THREE.Scene) {
  const tubes = new Map<string, THREE.Mesh<THREE.TubeGeometry, THREE.MeshStandardMaterial>>();
  const sums = new Map<string, number>();
  return {
    update(c: Cables) {
      for (const run of c.runs) {
        let m = tubes.get(run.key);
        if (!run.rope) { if (m) m.visible = false; continue; }
        const pts = run.rope.pts, sum = pts.reduce((s, p, i) => s + (p.x + p.y * 3 + p.z * 7) * (i + 1), 0);
        if (m && m.visible && sums.get(run.key) === sum) continue;
        sums.set(run.key, sum);
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        const geo = new THREE.TubeGeometry(curve, pts.length * 3, run.kind === "power" ? 0.009 : 0.006, 6, false);
        if (!m) {
          m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLOR[run.kind] ?? 0x222222, roughness: 0.6 }));
          tubes.set(run.key, m);
          scene.add(m);
        } else { m.geometry.dispose(); m.geometry = geo; }
        m.visible = true;
      }
    },
    clear() { for (const m of tubes.values()) { scene.remove(m); m.geometry.dispose(); } tubes.clear(); sums.clear(); },
  };
}
