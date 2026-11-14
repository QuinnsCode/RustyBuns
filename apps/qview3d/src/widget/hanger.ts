// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// A top on a hanger (a spike, #4563): the top's own print meshes become cloth, pinned along the shoulders where the
// hanger holds them, and settle under gravity for about a second and a half, then freeze, so the frame budget is the
// same as the form's once it has hung. Position-based: each step moves the points, then pulls every mesh edge (and,
// more softly, the edge across each pair of triangles, for bending) back toward its length. With no form inside,
// the cloth starts laid flat (front on back, as folded in its box: `flat`), is hung by its shoulders, and drops.
// A thin board between the halves keeps them from passing through each other. Everything else on the top (bands, stitches, the hood, cords) rides along with its nearest cloth point.
import * as THREE from "three";

/** One cloth mesh: +1 the front half (stays in front of the board), -1 the back, 0 a sleeve (its front layer lies on the body's front, its back on the back). */
export type ClothPart = { mesh: THREE.Mesh; side: 1 | -1 | 0; pinned: (i: number, p: THREE.Vector3) => boolean; flat: (i: number, p: THREE.Vector3) => THREE.Vector3 };

const STEPS_PER_FRAME = 2, ITERATIONS = 12, FRAMES = 70;
const GRAVITY = -21; // about 9.8 m/s² in the viewer's units (45 cm each)
const DT = 1 / 60 / STEPS_PER_FRAME;

export function hang(parts: ClothPart[], followers: THREE.Mesh[]) {
  // Weld points that sit on top of each other (the side and shoulder seams) into one particle.
  const key = (p: THREE.Vector3) => `${Math.round(p.x / 0.004)},${Math.round(p.y / 0.004)},${Math.round(p.z / 0.004)}`;
  const index = new Map<string, number>();
  const start: number[] = [], form: number[] = [], side: number[] = [], inv: number[] = [];
  const map = parts.map((part) => {
    const pos = part.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const out = new Int32Array(pos.count), p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const k = key(p);
      let n = index.get(k);
      if (n === undefined) {
        n = start.length / 3;
        index.set(k, n);
        form.push(p.x, p.y, p.z);
        const f = part.flat(i, p);
        start.push(f.x, f.y, f.z);
        side.push(part.side || (p.z >= 0 ? 2 : -2));
        inv.push(1);
      }
      if (part.pinned(i, p)) inv[n] = 0;
      out[i] = n;
    }
    return out;
  });
  const count = start.length / 3;
  const x = Float32Array.from(start), prev = Float32Array.from(start), w = Float32Array.from(inv);

  // Constraints: each mesh edge, and the far corners of each pair of triangles (bending, softer).
  const a: number[] = [], b: number[] = [], rest: number[] = [], stiff: number[] = [];
  const seen = new Set<string>();
  const link = (i: number, j: number, k: number, length?: number) => {
    if (i === j) return;
    const id = i < j ? `${i}:${j}` : `${j}:${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    a.push(i); b.push(j); stiff.push(k);
    rest.push(length ?? Math.hypot(x[i * 3]! - x[j * 3]!, x[i * 3 + 1]! - x[j * 3 + 1]!, x[i * 3 + 2]! - x[j * 3 + 2]!));
  };
  parts.forEach((part, m) => {
    const ix = part.mesh.geometry.getIndex()!, to = map[m]!, across = new Map<string, number>();
    for (let t = 0; t < ix.count; t += 3) {
      const tri = [to[ix.getX(t)]!, to[ix.getX(t + 1)]!, to[ix.getX(t + 2)]!];
      for (let e = 0; e < 3; e++) {
        const i = tri[e]!, j = tri[(e + 1) % 3]!, o = tri[(e + 2) % 3]!;
        link(i, j, 1);
        const id = i < j ? `${i}:${j}` : `${j}:${i}`, other = across.get(id);
        if (other === undefined) across.set(id, o);
        else link(o, other, 0.25);
      }
    }
  });
  // A sleeve is lofted out of the body's side, not welded to it: tie its first ring to the body points nearest it.
  const near = (i: number, among: (j: number) => boolean) => {
    let best = -1, d = 0.05;
    for (let j = 0; j < count; j++) {
      if (!among(j)) continue;
      const e = Math.hypot(form[i * 3]! - form[j * 3]!, form[i * 3 + 1]! - form[j * 3 + 1]!, form[i * 3 + 2]! - form[j * 3 + 2]!);
      if (e < d) { d = e; best = j; }
    }
    return best;
  };
  parts.forEach((part, m) => {
    if (part.side) return;
    // (A sleeve's particles are side +-2: their own layer, outside the body's.)
    const ring = part.mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
    map[m]!.forEach((n, v) => { if (ring.getY(v) > 0.97) { const j = near(n, (q) => Math.abs(side[q]!) === 1); if (j >= 0) link(n, j, 1); } });
  });

  // Tethers: no point may end up further from its nearest pin than it started, so the cloth hangs without stretching
  // (a few edge passes alone let a long panel sag like elastic).
  const pins: number[] = [];
  for (let i = 0; i < count; i++) if (!w[i]) pins.push(i);
  const tether = new Int32Array(count).fill(-1), reach = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (!w[i]) continue;
    let d = Infinity;
    for (const p of pins) {
      const e = (x[i * 3]! - x[p * 3]!) ** 2 + (x[i * 3 + 1]! - x[p * 3 + 1]!) ** 2 + (x[i * 3 + 2]! - x[p * 3 + 2]!) ** 2;
      if (e < d) { d = e; tether[i] = p; }
    }
    reach[i] = Math.sqrt(d) * 1.01;
  }

  // Each follower vertex keeps its offset from its nearest cloth point.
  const grid = new Map<string, number[]>();
  const cell = (px: number, py: number, pz: number) => `${Math.floor(px / 0.06)},${Math.floor(py / 0.06)},${Math.floor(pz / 0.06)}`;
  for (let i = 0; i < count; i++) { const k = cell(form[i * 3]!, form[i * 3 + 1]!, form[i * 3 + 2]!); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }
  const ride = followers.map((f) => {
    const pos = f.geometry.getAttribute("position") as THREE.BufferAttribute, anchor = new Int32Array(pos.count), off = new Float32Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      let best = 0, d = Infinity;
      for (let r = 0; r < 4 && d === Infinity; r++) {
        const cx = Math.floor(px / 0.06), cy = Math.floor(py / 0.06), cz = Math.floor(pz / 0.06);
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
          for (const n of grid.get(`${cx + i},${cy + j},${cz + k}`) ?? []) {
            const e = (form[n * 3]! - px) ** 2 + (form[n * 3 + 1]! - py) ** 2 + (form[n * 3 + 2]! - pz) ** 2;
            if (e < d) { d = e; best = n; }
          }
        }
      }
      anchor[v] = best;
      off.set([px - form[best * 3]!, py - form[best * 3 + 1]!, pz - form[best * 3 + 2]!], v * 3);
    }
    return { pos, anchor, off };
  });

  let frame = 0;
  const step = () => {
    for (let i = 0; i < count; i++) {
      if (!w[i]) continue;
      const o = i * 3;
      for (let k = 0; k < 3; k++) {
        const v = (x[o + k]! - prev[o + k]!) * 0.96;
        prev[o + k] = x[o + k]!;
        x[o + k] = x[o + k]! + v;
      }
      x[o + 1] = x[o + 1]! + GRAVITY * DT * DT;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let c = 0; c < a.length; c++) {
        const i = a[c]!, j = b[c]!, wi = w[i]!, wj = w[j]!, ws = wi + wj;
        if (!ws) continue;
        const dx = x[j * 3]! - x[i * 3]!, dy = x[j * 3 + 1]! - x[i * 3 + 1]!, dz = x[j * 3 + 2]! - x[i * 3 + 2]!;
        const len = Math.hypot(dx, dy, dz) || 1e-9, k = ((len - rest[c]!) / len / ws) * stiff[c]!;
        x[i * 3] = x[i * 3]! + dx * k * wi; x[i * 3 + 1] = x[i * 3 + 1]! + dy * k * wi; x[i * 3 + 2] = x[i * 3 + 2]! + dz * k * wi;
        x[j * 3] = x[j * 3]! - dx * k * wj; x[j * 3 + 1] = x[j * 3 + 1]! - dy * k * wj; x[j * 3 + 2] = x[j * 3 + 2]! - dz * k * wj;
      }
      for (let i = 0; i < count; i++) {
        const p = tether[i]!;
        if (p >= 0) {
          const dx = x[i * 3]! - x[p * 3]!, dy = x[i * 3 + 1]! - x[p * 3 + 1]!, dz = x[i * 3 + 2]! - x[p * 3 + 2]!, len = Math.hypot(dx, dy, dz);
          if (len > reach[i]!) { const k = reach[i]! / len; x[i * 3] = x[p * 3]! + dx * k; x[i * 3 + 1] = x[p * 3 + 1]! + dy * k; x[i * 3 + 2] = x[p * 3 + 2]! + dz * k; }
        }
        const s = Math.sign(side[i]!), floor = Math.abs(side[i]!) === 1 ? 0.006 : 0.024, z = x[i * 3 + 2]!;
        if (s * z < floor) x[i * 3 + 2] = s * floor;
      }
    }
  };
  const write = (normals: boolean) => {
    parts.forEach((part, m) => {
      const pos = part.mesh.geometry.getAttribute("position") as THREE.BufferAttribute, to = map[m]!;
      for (let v = 0; v < pos.count; v++) pos.setXYZ(v, x[to[v]! * 3]!, x[to[v]! * 3 + 1]!, x[to[v]! * 3 + 2]!);
      pos.needsUpdate = true;
      if (normals) part.mesh.geometry.computeVertexNormals();
      part.mesh.geometry.computeBoundingSphere();
    });
    ride.forEach(({ pos, anchor, off }, f) => {
      for (let v = 0; v < pos.count; v++) { const n = anchor[v]! * 3; pos.setXYZ(v, x[n]! + off[v * 3]!, x[n + 1]! + off[v * 3 + 1]!, x[n + 2]! + off[v * 3 + 2]!); }
      pos.needsUpdate = true;
      if (normals) followers[f]!.geometry.computeVertexNormals();
      followers[f]!.geometry.computeBoundingSphere();
    });
  };
  return {
    /** One frame of settling; false once it has hung (and frozen). */
    tick(): boolean {
      if (frame >= FRAMES) return false;
      for (let s = 0; s < STEPS_PER_FRAME; s++) step();
      frame++;
      write(frame % 3 === 0 || frame === FRAMES);
      return true;
    },
    /** Hang it again from flat (a new colour, a fresh look). */
    restart() { x.set(start); prev.set(start); frame = 0; },
  };
}

/** A wooden hanger with a metal hook, its bar following the shoulder line `shoulderAt(x)` just under the cloth. */
export function hangerModel(width: number, shoulderAt: (x: number) => number) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#a16207", roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: "#d6d3d1", roughness: 0.3, metalness: 0.9 });
  const bar = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => { const x = (i / 8 - 0.5) * 2 * width; return new THREE.Vector3(x, shoulderAt(x) - 0.035, 0); }));
  const barMesh = new THREE.Mesh(new THREE.TubeGeometry(bar, 48, 0.022, 10, false), wood);
  barMesh.scale.z = 0.55;
  const top = shoulderAt(0) - 0.035;
  const hook = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, top, 0), new THREE.Vector3(0, top + 0.16, 0), new THREE.Vector3(0.02, top + 0.24, 0),
    new THREE.Vector3(0.08, top + 0.28, 0), new THREE.Vector3(0.13, top + 0.24, 0), new THREE.Vector3(0.12, top + 0.19, 0),
  ]);
  g.add(barMesh, new THREE.Mesh(new THREE.TubeGeometry(hook, 40, 0.008, 8, false), metal));
  return g;
}
