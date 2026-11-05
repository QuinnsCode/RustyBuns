// An instanced mesh that hands the GPU only the instances in view. The open world plants a few thousand trees, shrubs and
// rocks all round you as one instanced mesh a kind, and three can only cull a mesh whole, so every plant behind the
// camera was drawn too (#3664: 3.5 M of a frame's 4 M triangles). `keep` takes what was just planted as the full set;
// `show` writes the ones whose bounding sphere touches the view back into the mesh, in the order they were planted.
import * as THREE from "three";

export class Culled {
  private mat = new Float32Array(0);
  private col: Float32Array | null = null;
  /** Each kept instance's bounding sphere: centre x, y, z and radius. */
  private sph = new Float32Array(0);
  private n = 0;
  private readonly local: THREE.Sphere;

  constructor(readonly mesh: THREE.InstancedMesh) {
    mesh.geometry.computeBoundingSphere();
    this.local = mesh.geometry.boundingSphere!.clone();
  }

  /** How many are planted, in view or not. */
  get planted() { return this.n; }

  /** Takes the mesh's first `n` instances (just written with setMatrixAt / setColorAt) as everything planted. */
  keep(n: number) {
    const m = this.mesh.instanceMatrix.array as Float32Array, c = this.mesh.instanceColor?.array as Float32Array | undefined;
    this.n = n;
    this.mat = m.slice(0, n * 16);
    this.col = c ? c.slice(0, n * 3) : null;
    this.sph = new Float32Array(n * 4);
    const { center: lc, radius: lr } = this.local;
    for (let i = 0; i < n; i++) {
      const e = this.mat, o = i * 16;
      const sx = Math.hypot(e[o]!, e[o + 1]!, e[o + 2]!), sy = Math.hypot(e[o + 4]!, e[o + 5]!, e[o + 6]!), sz = Math.hypot(e[o + 8]!, e[o + 9]!, e[o + 10]!);
      this.sph[i * 4] = e[o]! * lc.x + e[o + 4]! * lc.y + e[o + 8]! * lc.z + e[o + 12]!;
      this.sph[i * 4 + 1] = e[o + 1]! * lc.x + e[o + 5]! * lc.y + e[o + 9]! * lc.z + e[o + 13]!;
      this.sph[i * 4 + 2] = e[o + 2]! * lc.x + e[o + 6]! * lc.y + e[o + 10]! * lc.z + e[o + 14]!;
      this.sph[i * 4 + 3] = lr * Math.max(sx, sy, sz);
    }
  }

  /** Writes the kept instances inside `frustum` (each sphere grown by `margin` metres) into the mesh; returns how many. */
  show(frustum: THREE.Frustum, margin: number): number {
    const out = this.mesh.instanceMatrix.array as Float32Array, oc = this.mesh.instanceColor?.array as Float32Array | undefined, planes = frustum.planes;
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      const x = this.sph[i * 4]!, y = this.sph[i * 4 + 1]!, z = this.sph[i * 4 + 2]!, r = this.sph[i * 4 + 3]! + margin;
      let inside = true;
      for (let p = 0; p < 6; p++) { const pl = planes[p]!, nv = pl.normal; if (nv.x * x + nv.y * y + nv.z * z + pl.constant < -r) { inside = false; break; } }
      if (!inside) continue;
      out.set(this.mat.subarray(i * 16, i * 16 + 16), k * 16);
      if (oc && this.col) oc.set(this.col.subarray(i * 3, i * 3 + 3), k * 3);
      k++;
    }
    this.mesh.count = k;
    this.mesh.visible = k > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return k;
  }
}
